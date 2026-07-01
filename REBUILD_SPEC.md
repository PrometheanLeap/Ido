# IDO — Rebuild Specification v1.2

*Drafted: 2026-07-02. Based on code review + design interview.*

---

## Contents

1. [Purpose & Vision](#1-purpose--vision)
2. [Deployment Modes](#2-deployment-modes)
3. [Architecture](#3-architecture)
4. [Protocol Layer](#4-protocol-layer)
5. [Skills Guide — Teaching Agents](#5-skills-guide--teaching-agents)
6. [Surface Engine](#6-surface-engine)
7. [A2UI Component System](#7-a2ui-component-system)
8. [Data Layer](#8-data-layer)
9. [Authentication & Authorisation](#9-authentication--authorisation)
10. [Real-Time Delivery](#10-real-time-delivery)
11. [Dashboard & PWA](#11-dashboard--pwa)
12. [Multi-Tenancy & Team Routing](#12-multi-tenancy--team-routing-v2-design-note)
13. [Visual Design & UX](#13-visual-design--ux)
14. [Folder Structure](#14-folder-structure)
15. [Key Technical Decisions vs Current Code](#15-key-technical-decisions-vs-current-code)
16. [Testing Requirements](#16-testing-requirements)
17. [What Is Explicitly Out of Scope](#17-what-is-explicitly-out-of-scope-for-the-rebuild)
18. [Migration Path](#18-migration-path)

---

---

## 1. Purpose & Vision

Ido is an **AI-to-Human interaction gateway**. Its job is to let AI agents send structured requests to humans — forms, approvals, notifications — and reliably receive the response. It is not a chat platform. It is not an agent builder. It is the human-in-the-loop terminal that sits between any AI system and any human.

### Core promise
> Any AI agent, any protocol, can request a human decision and get a typed, validated response back — on any device, in any deployment model.

### Secondary roadmap (v2+)
- Dynamic UI / live data sources
- Delegation (human-to-human forward, agent-to-agent handoff)
- Workflow chains (multi-step surfaces)
- Smart defaults (AI-assisted pre-fill from context)
- SDK / client libraries

These are **out of scope for the rebuild** but the architecture must not block them.

---

## 2. Deployment Modes

One binary, one env var (`IDO_MODE`), four behaviours:

| Mode | Auth | Tenancy | API Keys | Typical use |
|---|---|---|---|---|
| `dev` | Bearer `dev` / passphrase tokens | Token = tenant | Default tenant | Local development |
| `personal` | Username+password or OIDC | User = tenant | User-scoped | Self-hosted solo |
| `saas` | OIDC (Google / Microsoft) | Email = tenant | Key-scoped to tenant | Multi-tenant cloud |
| `corporate` | OIDC (Google / Microsoft) | Org = tenant, users scoped | Org-scoped, user_id required | Enterprise |

All four modes must be first-class. Behaviour divergence is controlled by a single `ModePolicy` object derived at startup — not scattered if/else checks throughout the codebase.

---

## 3. Architecture

### 3.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agent (any)                                             │
│  A2A JSON-RPC · MCP Tools · REST (legacy, deprecated)      │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼─────────────────────────────────┐
│  IDO Gateway  (Node.js / TypeScript)                        │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Protocol │  │ Surface  │  │  Auth    │  │   Push    │  │
│  │ Layer    │  │ Engine   │  │  Layer   │  │   Layer   │  │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └───────────┘  │
│       │             │                                       │
│  ┌────▼─────────────▼──────────────────────────────────┐   │
│  │  Core Domain  (surfaces · tasks · tenants · keys)   │   │
│  └────────────────────────┬────────────────────────────┘   │
│                           │                                 │
│  ┌────────────────────────▼────────────────────────────┐   │
│  │  Database Adapter  (SQLite dev · PostgreSQL prod)    │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │ SSE · Web Push
┌───────────────────────────▼─────────────────────────────────┐
│  Human  (PWA — React · Vite · Tailwind)                     │
│  Mobile primary · Desktop supported · Installable           │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Backend Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 22 LTS | Stable, async-native, broad ecosystem |
| Framework | **Hono** (replaces Express) | 10× faster, typed routing, native Cloudflare/Bun/Node support, zero footguns on route collisions |
| Language | TypeScript 5 strict | No compromise |
| Validation | **Zod** | Schema-first, derive types from schemas, no manual TS interfaces for API shapes |
| ORM/Query | **Kysely** | Type-safe query builder, works with SQLite + PG, no magic, no migrations framework needed |
| Auth | JWT (HS256 sessions) + OIDC (RS256) | Same as today, keep HttpOnly cookies |

### 3.3 Frontend Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | React 19 + Vite 6 | Keep — well understood, stable ecosystem |
| Styling | Tailwind CSS v4 | Keep — consolidate from single CSS monolith |
| State | Zustand | Keep — already in use, works well |
| Component types | **Zod schemas shared with backend** | Single source of truth for component props |
| PWA | Vite PWA plugin | Keep |

### 3.4 Deployment

- **Container-first**: Single Docker image, `docker compose up -d` works on any host
- Cloud Run / Fly.io / Railway / Render as first-class targets
- No cloud vendor lock-in beyond optional managed Postgres
- Health check: `GET /api/v1/health` always responds, no auth required

### 3.5 Cloud Run Cost Management

Cloud Run charges per request when instances scale to zero between uses. Ido's push notification model creates a specific challenge: Web Push keeps browsers woken but the Cloud Run instance may have gone cold.

**Strategy:**

| Concern | Solution |
|---|---|
| Cold start latency on first push | Minimum 1 instance (`--min-instances=1`) in prod config. Cost ~$5/month — acceptable for notification reliability. |
| SSE connections keep instances alive | Each connected browser holds an open SSE connection. Cloud Run does not scale to zero while any SSE client is connected. Scale-to-zero only happens when no users are online. |
| VAPID keys across instances | Store VAPID keys in Secret Manager / env vars — never in the DB. Keys must be stable across cold starts. |
| Push delivery when scaled to zero | If no instance is running when push fires (no users online), the push is queued in `a2a_tasks` with `dispatch_state=PENDING`. When the next request arrives and boots the instance, the dispatch worker picks it up within 60s. |
| Push subscription cleanup | Dead subscriptions (410/404 from push provider) are immediately removed. Stale endpoints don't accumulate. |
| Database connections | Use `max: 5` PG pool size on Cloud Run. Each instance gets its own pool. Set `idleTimeoutMillis: 10000` to release idle connections when instance is idle. |

**Recommended Cloud Run configuration (prod):**
```yaml
--min-instances=1
--max-instances=10
--concurrency=80
--memory=512Mi
--cpu=1
--timeout=300
```

The `--timeout=300` covers long-lived SSE connections without premature termination.

---

## 4. Protocol Layer

### 4.1 Entry Points

All three entry points are supported. REST legacy is kept but marked deprecated.

| Path | Protocol | Status |
|---|---|---|
| `POST /api/v1/a2a` | JSON-RPC 2.0 | **Primary** |
| `POST /api/v1/mcp` | MCP (Model Context Protocol) | Supported |
| `POST /api/v1/a2a/task` | REST legacy | Deprecated — removal in v3 |

**Key change:** All three call a single shared `createSurface()` function. No duplicate logic.

### 4.2 JSON-RPC Methods

| Method | Aliases | Action |
|---|---|---|
| `message/send` | `SendMessage` | Create surface, return task |
| `tasks/get` | `GetTask` | Poll task status + result |
| `tasks/list` | `ListTasks` | List tasks for tenant |
| `tasks/cancel` | `CancelTask` | Cancel pending task |
| `skills/guide` | — | Returns full component catalog + templates (no auth required) |
| `skills/list-templates` | — | List available surface templates by ID and description (no auth required) |

### 4.3 `message/send` — Canonical Payload

```typescript
// Defined as Zod schema — TypeScript types derived, not written by hand
const MessageSendSchema = z.object({
  surface_type: z.enum(['form', 'approval', 'notification']),
  surface_title: z.string().min(1).max(200),
  context: z.string().max(2000).optional(),
  user_id: z.string().email().optional(),            // required in corporate mode
  severity: z.enum(['info','success','warning','error','critical']).optional(), // notification only
  inputs_schema: JsonSchemaObject.optional(),
  a2ui_layout: z.array(A2UIComponentSchema).optional(),
  initial_data_model: z.record(z.unknown()).optional(), // pre-fills input fields by bind name
  expires_at: z.string().datetime().optional(),
  idempotency_key: z.string().max(128).optional(),
  configuration: z.object({
    pushNotificationConfig: z.object({
      url: z.string().url(),                         // agent callback endpoint
      token: z.string().optional(),                  // bearer token for the callback
    }).optional(),
  }).optional(),
});
```

**`initial_data_model`**: Key-value map where each key is a `bind` field name. Values are pre-loaded into the form's data model before the human sees it. Use this to show current values the agent already knows: `{ "department": "Engineering", "priority": "high" }`. The human can edit them. This is also how approval `reason` fields can have suggested text.

### 4.4 Polling vs Callbacks

Both patterns are fully supported. Agents choose at send time.

**Polling:**
```
POST /api/v1/a2a  →  { result: { task: { id, status: TASK_STATE_INPUT_REQUIRED } } }
...human acts...
POST /api/v1/a2a  →  tasks/get  →  { result: { status: TASK_STATE_COMPLETED, artifacts: [...] } }
```

**Callback (push):** Register via `configuration.pushNotificationConfig` in `message/send`:
```json
{
  "configuration": {
    "pushNotificationConfig": {
      "url": "https://your-agent.example.com/callback",
      "token": "optional-bearer-token"
    }
  }
}
```

Callback body on human submit:
```json
{
  "task_id": "uuid",
  "surface_id": "short-id",
  "status": "COMPLETED | REJECTED",
  "user_input": { "...typed, schema-coerced values..." },
  "submitted_at": "ISO 8601"
}
```

Callback retry: exponential backoff with jitter, up to 12 attempts over ~4 hours. Dispatch state tracked per task:

| `dispatch_state` | Meaning |
|---|---|
| `PENDING` | Not yet attempted |
| `DISPATCHING` | Attempt in progress |
| `DELIVERED` | HTTP 2xx received from callback URL |
| `DISPATCH_FAILED` | All retries exhausted |

Retry schedule: 30s, 2m, 5m, 15m, 30m, 1h, 2h, then every 2h until 12 attempts.

**No callback is fired on expiry.** Agent polling returns `TASK_STATE_FAILED` with `reason: "EXPIRED"`.

### 4.5 Full MCP Compliance

MCP transport: JSON-RPC 2.0 over HTTP (`POST /api/v1/mcp`). SSE transport also supported for streaming-capable clients (`GET /mcp` → SSE stream → `POST /mcp?sessionId=xxx`).

Protocol lifecycle:
1. `initialize` → server returns `protocolVersion`, `capabilities`, `serverInfo`
2. `ping` → health check, no auth required
3. `tools/list` → returns all tool definitions with JSON Schema `inputSchema`
4. `tools/call` → dispatches to named tool, returns `{ content: [...] }`

**MCP Tools:**

| Tool | Purpose |
|---|---|
| `ido_get_skills_guide` | **Call first.** Returns decision tree, templates, component catalog, pitfalls. No auth required. |
| `ido_send_task` | Create a surface (form/approval/notification) |
| `ido_check_task` | Poll task status and result |
| `ido_list_tasks` | List tasks for this API key |
| `ido_read_task` | Read full surface details (schema, pre-fills, components) |
| `ido_answer_task` | Submit a response to a pending surface (agent-as-human pattern) |

All tools return `{ content: [{ type: "text", text: "..." }] }` per MCP spec. Errors are returned as MCP error content, not HTTP 4xx.

### 4.6 Agent Connectors

The gateway must support outbound connections to AI agents for chat-style interaction (the Hermes use case). The architecture defines a **formal `AgentAdapter` interface** today — implementations are registered in the DB at runtime. This makes future connectors (Copilot, Gemini Business, Claude) a clean drop-in.

```typescript
interface AgentAdapter {
  type: string;                    // 'hermes-ito' | 'a2a-generic' | future
  sendMessage(msg: ChatMessage, ctx: AgentContext): Promise<AgentResponse>;
  healthCheck(): Promise<boolean>;
}
```

DB registration stays as-is (`agent_connections` table). Chat UI is out of scope for the rebuild — the interface is reserved, not implemented.

Future connector targets (not in v1): GitHub Copilot (OpenAI-compatible), Gemini Business (Google AI SDK), Claude (Anthropic SDK). All use standard HTTP+SSE — the adapter pattern means each is ~100 lines of new code with zero changes to the rest of the system.

---

## 5. Skills Guide — Teaching Agents

### 5.1 The Problem

Agents are LLMs. They don't know what components Ido supports, what props they need, or how approval surfaces differ from form surfaces. The skills guide is the solution: a single structured JSON document that **any LLM can consume and use to produce correct A2UI layouts on the first try**.

### 5.2 Access Methods

The skills guide is available via **three channels** — agents call whichever suits their integration:

| Channel | Endpoint | Auth required |
|---|---|---|
| HTTP GET | `GET /api/v1/skills-guide` | No — intentionally public |
| A2A JSON-RPC | `POST /api/v1/a2a` → method `skills/guide` | No |
| MCP tool | `tools/call` → `ido_get_skills_guide` | No |

All three return the same payload. The MCP and A2A versions are wrappers over the same function.

**Recommended agent bootstrap pattern:**
```
On first connection to a new Ido instance:
  1. Call ido_get_skills_guide (or GET /api/v1/skills-guide)
  2. Read the decision tree
  3. Read the template for the surface type you need
  4. Copy the template — fill in your data
  5. Send the task
```

### 5.3 Skills Guide Structure

```json
{
  "version": "2.4",
  "instructions": "Call ido_get_skills_guide before sending any task. ...",
  "decisionTree": {
    "question": "Does the human need to fill in fields?",
    "yes": "form",
    "no": { "question": "Simple yes/no?", "yes": "approval", "no": "notification" }
  },
  "templates": {
    "form": { "...copy-paste form template..." },
    "approval": { "...copy-paste approval template..." },
    "notification": { "...copy-paste notification template..." }
  },
  "schemaTypes": {
    "string": "text input, email, password, tel, url",
    "number": "numeric input with optional min/max/step",
    "boolean": "ChoicePicker with single boolean option or Checkbox",
    "enum": "ChoicePicker with provided options"
  },
  "componentCatalog": {
    "display": { "Badge": "{ text: s, color?: s }", "ProgressBar": "{ value: n, ... }", ... },
    "input":   { "InputField": "{ label: s, type?: s, bind: required }", ... },
    "layout":  { "Card": "{ title?: s }", "Row": "{ gap?: n }", ... }
  },
  "validationRules": [
    "Every component must have a unique id",
    "Input components need bind pointing to an inputs_schema property",
    "approval: no input components except reason",
    "notification: no input components",
    ...
  ],
  "pitfalls": [
    "Don't nest component object in component field — use string type name + separate props",
    "Don't set bind on display-only components",
    ...
  ]
}
```

### 5.4 Mode Awareness

The skills guide is mode-aware. In `corporate` mode it appends a note that `user_id` (an email address) is **REQUIRED** on every surface. In other modes it marks `user_id` as optional.

### 5.5 Skills Guide Versioning

- Version field embedded: `{ "version": "2.4" }`
- New components or props → minor version bump
- Breaking changes to template structure → major version bump
- Agents should cache but re-fetch after receiving a `412 Skills Guide Outdated` error (future feature)
- The guide is in `proxy/src/a2a/skills-guide.ts` — the single source of truth for agent capabilities

---

## 6. Surface Engine

### 6.1 Surface Types

| Type | Agent blocks | Human action | Schema rules | Callback fired |
|---|---|---|---|---|
| `form` | Yes | Fill fields + submit | Any `inputs_schema` properties | On submit |
| `approval` | Yes | Approve / Reject (chips) | Only `reason` in properties — other fields → 422 | On approve or reject |
| `notification` | No (fire-and-forget) | Read / acknowledge | `inputs_schema` ignored | Never |

**Decision tree (same as skills guide):**
1. Does the human need to fill in any fields? → `form`
2. Simple yes/no with zero business fields? → `approval`
3. Just sending info, no response needed? → `notification`
4. Default when unsure → `form`

### 6.2 Component Permission Matrix

Every component belongs to exactly one permission tier. The server enforces this at validation time — an invalid component in the wrong surface type returns HTTP 422.

| Component | Form | Approval | Notification |
|---|---|---|---|
| `Card` | ✅ | ✅ | ✅ |
| `Column` / `Row` | ✅ | ✅ | ✅ |
| `Accordion` / `Stepper` | ✅ | ✅ | ✅ |
| `Text` / `RichText` | ✅ | ✅ | ✅ |
| `Image` / `Link` | ✅ | ✅ | ✅ |
| `Divider` / `Badge` / `ProgressBar` | ✅ | ✅ | ✅ |
| `Table` / `DataGrid` | ✅ | ✅ | ✅ |
| `BarChart` / `LineChart` / `PieChart` / `DonutChart` | ✅ | ✅ | ✅ |
| `ProductGrid` / `ItemCard` | ✅ | ✅ | ✅ |
| `Map` | ✅ | ✅ | ✅ |
| `Form` | ✅ | ❌ server-owned | ❌ |
| `ChoicePicker` | ✅ | ❌ server-owned | ❌ |
| `InputField` / `TextField` | ✅ | ❌ | ❌ |
| `Select` / `Checkbox` | ✅ | ❌ | ❌ |
| `DatePicker` / `Rating` / `Slider` | ✅ | ❌ | ❌ |
| `FileInput` / `ImagePicker` / `ImageSelect` | ✅ | ❌ | ❌ |
| `Signature` | ✅ | ❌ | ❌ |
| `Button` | ❌ use built-in | ❌ | ❌ |

**Approval surface special rules:**
- Server always injects the Approve/Reject `ChoicePicker` — agent cannot override it
- `reason` field in `inputs_schema` → server injects an `InputField` above the chips
- `action_validation.reject.required_fields: ["reason"]` → Reject chip is disabled until reason is filled
- Any other property in `inputs_schema` on an approval → HTTP 422 with descriptive error
- Agent may include display-only components (Text, Badge, Table, charts) in `a2ui_layout`

**Notification surface special rules:**
- Completes immediately — task state is `TASK_STATE_COMPLETED` in the `message/send` response
- `severity` field: `info` (default) | `success` | `warning` | `error` | `critical`
- `severity` controls card accent colour and sort priority on the dashboard
- Body supports full Markdown via `RichText` component or plain `context` text

### 6.3 Surface Lifecycle

```
CREATED → INPUT_REQUIRED → COMPLETED
                        → REJECTED        (approval only)
                        → CANCELLED       (agent cancels)
                        → EXPIRED         (expires_at passed)
                        → ARCHIVED        (housekeeping)
```

Transitions are enforced at the domain layer. No handler bypasses the state machine.

### 6.4 Shared `createSurface()` Function

One function, called by all entry points (A2A, MCP, REST legacy):

```typescript
async function createSurface(params: CreateSurfaceParams): Promise<{ taskId: string; surfaceId: string }> {
  // 1. Validate layout + schema per surface type (Zod)
  // 2. Render A2UI component tree
  // 3. Insert surface + task in a single DB transaction
  // 4. Push SSE update to connected clients
  // 5. Enqueue push notification
  // 6. Return { taskId, surfaceId }
}
```

### 6.5 Expiry

- Set via `expires_at` (ISO 8601) on forms and approvals only
- Hourly server sweep archives expired surfaces, marks task as `TASK_STATE_FAILED`
- Frontend: expired items removed from active list immediately on expiry
- Display countdown when `< 48h`: red `< 2h`, orange `2h–48h`, hidden `> 48h`
- No callback is fired on expiry

### 6.6 Callbacks and Retry

When the human submits or dismisses a surface, the proxy POSTs the result to the agent's callback URL (registered in `configuration.pushNotificationConfig.url`):

```json
{
  "task_id": "uuid",
  "surface_id": "short-id",
  "status": "COMPLETED | REJECTED",
  "user_input": { "...schema-coerced values..." },
  "submitted_at": "ISO 8601"
}
```

If the callback URL returns a non-2xx response, or times out, the dispatcher retries with exponential backoff:

| Attempt | Delay |
|---|---|
| 1 | immediate |
| 2 | 30 seconds |
| 3 | 2 minutes |
| 4 | 5 minutes |
| 5 | 15 minutes |
| 6 | 30 minutes |
| 7–12 | 1 hour each |

After 12 failed attempts, `dispatch_state` is set to `DISPATCH_FAILED`. The task result remains available for polling — the agent can still call `tasks/get` to retrieve it.

Callback delivery is not guaranteed if the target agent is offline for >4 hours after submission. The polling fallback is always authoritative.

### 6.7 Idempotency

`idempotency_key` in the payload prevents duplicate surfaces on agent retry. The DB enforces a `UNIQUE` constraint on `a2a_tasks.idempotency_key`. On conflict, the server returns the existing task — not an error.

---

## 7. A2UI Component System

### 7.1 Design Principles

1. **Schema-first**: Every component has a Zod schema. Types are derived — never written manually.
2. **Single prop vocabulary**: Each component has ONE canonical set of props. No `label`/`text`/`content` ambiguity.
3. **LLM-friendly**: Schemas are simple enough for any LLM to emit correctly from the skills guide.
4. **Mobile-primary**: No component assumes a wide viewport. Everything must degrade gracefully to 320px.
5. **Fail-loud**: Invalid component IDs, missing children, unknown types — all produce a clear error. Silent render failures are banned.

### 7.2 Component Layout Protocol

Components are expressed as an adjacency list. Each entry has:

```typescript
const A2UIComponentSchema = z.object({
  id: z.string().min(1),
  component: z.string(),                           // single canonical string type name
  props: z.record(z.unknown()).optional(),         // flat props bag — no nested component objects
  bind: z.string().optional(),                     // for input fields only
  parent: z.string().optional(),
  children: z.array(z.string()).optional(),
  visible: VisibilityRuleSchema.optional(),
});
```

**Breaking change from current**: The legacy `{ "component": { "Card": { ...props } } }` object-style is removed. Props are always in `props`. The renderer no longer accepts dual format.

Tree wiring rules:
1. `parent` ref takes precedence for positioning
2. `children` array on a parent is used to establish child order
3. A node with both `parent` and `children` is valid — it is a child of its parent AND a parent of its children
4. Unresolvable refs produce a build-time warning (not a silent failure)

### 7.3 Component Catalog

#### Layout
| Component | Props | Notes |
|---|---|---|
| `Card` | `title?`, `subtitle?` | Surface container — one per surface recommended |
| `Column` | `gap?`, `align?` | Vertical stack |
| `Row` | `gap?`, `align?`, `wrap?` | Horizontal stack — children NOT force-wrapped in flex divs |
| `Accordion` | `title`, `defaultOpen?` | Collapsible section — **new** |
| `Stepper` | `steps[]`, `current` | Multi-step progress indicator — **new** |

#### Input
| Component | Props | Notes |
|---|---|---|
| `Form` | `submitLabel?`, `cancelLabel?` | One per surface |
| `InputField` | `label`, `type?`, `placeholder?`, `required?`, `multiline?` | bind required |
| `TextField` | `label`, `placeholder?`, `required?`, `rows?` | Long-form text |
| `Select` | `label`, `options[]`, `required?` | `options: [{label, value}]` |
| `ChoicePicker` | `label?`, `options[]`, `variant?`, `displayStyle?` | chips or checkbox |
| `Checkbox` | `label`, `required?` | Single boolean |
| `DatePicker` | `label`, `required?`, `min?`, `max?` | Date or datetime — **new** |
| `Rating` | `label`, `max?` | 1–N star/number rating — **new** |
| `Slider` | `label`, `min`, `max`, `step?` | Numeric range — **new** |
| `FileInput` | `label`, `accept?`, `multiple?` | File upload |
| `ImagePicker` | `label`, `accept?`, `multiple?` | Image upload with preview |
| `ImageSelect` | `items[]`, `mode?`, `columns?` | Pick from provided images |
| `Signature` | `label` | Draw or type signature — **new** |

#### Display
| Component | Props | Notes |
|---|---|---|
| `Text` | `text`, `usageHint?` | `usageHint`: heading/subheading/body/caption/label |
| `RichText` | `markdown` | Rendered Markdown block — **new** (replaces body: md in notifications) |
| `Badge` | `text`, `color?`, `variant?` | Pill status indicator |
| `ProgressBar` | `value`, `max?`, `label?`, `showValue?`, `variant?` | Linear progress |
| `Divider` | `label?` | Horizontal rule |
| `Image` | `src`, `alt?`, `fit?`, `radius?` | |
| `Link` | `text`, `href`, `target?` | |

#### Data
| Component | Props | Notes |
|---|---|---|
| `Table` | `headers[]`, `rows[][]`, `compact?`, `striped?` | Static data table |
| `DataGrid` | `columns[]`, `rows[]`, `editable?` | Interactive/editable table — **new** |
| `BarChart` | `data[]`, `height?`, `colors?` | |
| `LineChart` | `data[]`, `height?`, `colors?` | |
| `PieChart` | `data[]`, `height?`, `colors?` | |
| `DonutChart` | `data[]`, `colors?` | |
| `ProductGrid` | (container) | Grid of `ItemCard` children |
| `ItemCard` | `title`, `subtitle?`, `price?`, `badge?` | |
| `Map` | `lat`, `lng`, `zoom?`, `marker?` | Location display — **new** |

**Component count: 37** (up from 26). Additions are additive — existing layouts are unaffected if old component names are kept as aliases during migration.

> **LLM complexity note**: New components are only sent by agents that choose to use them. The skills guide groups them by category and provides copy-paste templates. Agents unaware of new components continue working exactly as before.

### 7.4 Conditional Visibility

Field/component visibility is controlled by declarative rules evaluated on the live form data model. No JavaScript, no code in the layout. The renderer evaluates rules in real time as field values change.

**Single condition:**
```json
{
  "visible": {
    "when": "field_name",
    "operator": "equals | notEquals | exists | notExists | greaterThan | lessThan | in",
    "value": "expected_value"
  }
}
```

**Multiple conditions (AND):**
```json
{
  "visible": {
    "all": [
      { "when": "tier", "operator": "equals", "value": "pro" },
      { "when": "seats", "operator": "greaterThan", "value": 5 }
    ]
  }
}
```

**Multiple conditions (OR):**
```json
{
  "visible": {
    "any": [
      { "when": "channel", "operator": "equals", "value": "email" },
      { "when": "channel", "operator": "equals", "value": "sms" }
    ]
  }
}
```

**Rules:**
- Visibility rules apply to ANY component, not just inputs (a whole `Card` can be hidden)
- Hidden components do NOT submit their bound field values
- `notExists` matches null, undefined, and empty string
- The `in` operator takes an array value: `{ "operator": "in", "value": ["a", "b", "c"] }`
- Conditions are re-evaluated on every keystroke — no stale state
- Server-side: visibility state is also evaluated on submit — hidden fields are stripped from `user_input`

### 7.5 Responsive Layout

A2UI layouts must work on screens from 320px to 2560px. The row/column system must not create broken layouts on mobile.

**Row auto-collapse rules (implemented in the `Row` component):**

| Children count | Default behaviour |
|---|---|
| 1–2 | Always horizontal |
| 3 | Horizontal above 480px, vertical below |
| 4+ | Wraps (flex-wrap) above 600px, vertical below |

The `wrap` prop on `Row` can override: `"wrap": "always"` | `"wrap": "never"` | `"wrap": "auto"` (default).

**Max items per row**: `maxColumns` prop on `Row`. Agent-specified — the renderer does not enforce a global limit but the skills guide recommends ≤ 4 for usable layouts.

**Badge overflow**: All pill/badge components clamp to their container width with `text-overflow: ellipsis`. Long text is never allowed to overflow the card frame.

**ProgressBar in rows**: When multiple `ProgressBar` components are siblings in a `Row`, the row height is unified — all bars align. `flexShrink: 0` on the percentage label prevents compression.

**Responsive component hiding (v2):** Components may specify `hideOn: "mobile" | "desktop"` — not implemented in rebuild but prop is reserved.

### 7.6 Canonical Prop Vocabulary

Every component has exactly **one** canonical prop name per concept. Aliases from the legacy API are **not** supported in the rebuild. The skills guide is the definitive source. Key prop conventions:

| Concept | Canonical prop | Banned aliases |
|---|---|---|
| Display text on a badge/chip | `text` | `label`, `title`, `content` |
| Colour (hex) | `color` | `colour`, `variant` (variant remains for predefined sets) |
| Hyperlink target | `href` | `url`, `link`, `to` |
| Bound field name | `bind` | `field`, `name`, `key` |
| Human-readable label | `label` | `title` (title is reserved for Card/Accordion headings) |
| Progress value | `value` | `progress`, `current` |
| Max progress | `max` | `total`, `maximum` |

Any component receiving an unknown prop logs a warning in dev mode and silently ignores it in prod. This allows forward compatibility (new props in newer guide versions, consumed by older clients) without breaking.

### 7.7 Surface Template Catalog

The template catalog lets agents fetch pre-built A2UI layouts by name rather than composing from scratch. Useful for standardised internal workflows.

**How it works:**
1. Admin creates a named template via the settings UI or `POST /api/v1/templates`
2. Template is stored as a full `a2ui_layout` array in the `surface_templates` DB table
3. Agent retrieves it: `GET /api/v1/templates?name=daily-standup` or via `skills/list-templates` method
4. Agent includes the template in `a2ui_layout` unchanged, or substitutes values before sending

**Template shape:**
```json
{
  "id": "daily-standup",
  "name": "Daily Standup",
  "description": "Standard standup form — yesterday, today, blockers",
  "surface_type": "form",
  "inputs_schema": { "...derived schema..." },
  "a2ui_layout": [ "...components..." ],
  "created_by": "admin",
  "created_at": "2026-01-01T00:00:00Z"
}
```

**Built-in templates (shipped with Ido, overridable):**

| Template ID | Description |
|---|---|
| `standup` | Daily standup: yesterday / today / blockers |
| `approval-simple` | Single-field approval with context block |
| `status-report` | Status badge row + rich text body |
| `incident` | Severity, affected system, description, steps |
| `travel-request` | Destination, dates, purpose, budget |

Templates are data — adding a new template is zero code. Agents can list available templates without auth via `GET /api/v1/templates`.

### 7.8 Dynamic Data Sources (v2 design note)

For dependent selects and large option lists (thousands of users), the current inline model breaks down. The v2 design should support:

```json
{
  "component": "Select",
  "props": {
    "label": "Assignee",
    "source": {
      "url": "/api/v1/data/users",
      "valueKey": "id",
      "labelKey": "name",
      "dependsOn": "department"
    }
  }
}
```

This is not implemented in the rebuild but the `props` schema must not block it — `source` is reserved.

---

## 8. Data Layer

### 8.1 Database Strategy

- SQLite for dev/personal (zero-config, file-based)
- PostgreSQL for production (Cloud SQL, Supabase, Railway, etc.)
- Same schema, same queries — Kysely handles dialect differences
- Schema migrations: plain SQL files in `migrations/` — applied in order on startup, tracked in `schema_migrations` table. No ORM-managed magic.

### 8.2 Schema (Core Tables)

```sql
tenants           -- tenant_id, display_name, created_at
users             -- username, password_hash, tenant_id, role
agent_keys        -- key_id, tenant_id, user_id, key_hash, key_name, scopes, expires_at, revoked_at
agent_connections -- id, tenant_id, agent_type, endpoint_url, auth_*, is_default, healthy
settings          -- key, value, updated_at

a2ui_surfaces     -- surface_id, tenant_id, task_id, type, state, title, components_json,
                  --   schema_json, data_json, context, user_id, session_id,
                  --   source, source_ip, expires_at, viewed_at, created_at, updated_at

a2a_tasks         -- task_id, tenant_id, surface_id, status, input_json, output_json,
                  --   callback_url, callback_token, dispatch_state, retry_count,
                  --   idempotency_key, created_at, completed_at

surface_events    -- id, surface_id, tenant_id, event_type, actor, detail_json, created_at
                  -- NEW: audit trail for every state change

push_subscriptions -- id, tenant_id, user_id, endpoint, p256dh_key, auth_key, created_at

surface_templates  -- id, tenant_id, name, description, surface_type, inputs_schema_json,
                  --   a2ui_layout_json, created_by, created_at, updated_at
                  -- tenant_id = NULL for built-in templates visible to all tenants

notification_preferences -- id, tenant_id, user_id, quiet_hours_enabled, quiet_start, quiet_end,
                         --   quiet_timezone, quiet_days (JSON array: ["Mon","Tue",...]),
                         --   push_forms, push_approvals, push_notifications,
                         --   push_severity_min (info|success|warning|error|critical),
                         --   quiet_behaviour (queue|suppress),
                         --   created_at, updated_at
                         -- user_id = NULL means tenant default; user row overrides tenant default

sessions          -- session_id, tenant_id, title, source, status, agent_id, created_at
chat_history      -- id, session_id, tenant_id, role, content, created_at
```

### 8.3 Audit Trail

Every surface state transition writes a `surface_events` row:

| event_type | When |
|---|---|
| `created` | Surface inserted |
| `viewed` | First time human opens it |
| `submitted` | Human submits form |
| `approved` / `rejected` | Approval decision |
| `cancelled` | Agent or admin cancels |
| `expired` | Hourly sweep archives it |
| `callback_delivered` | Callback POST succeeded |
| `callback_failed` | Callback POST failed (retry logged) |

---

## 9. Authentication & Authorisation

### 9.1 Graduated Auth Model

Ido has four deployment modes. Auth complexity scales with deployment scale. A developer can be productive in under 2 minutes; an enterprise team gets full SSO.

| Mode | Who it's for | Auth mechanism | Setup effort |
|---|---|---|---|
| `dev` | Single developer, local testing | Passphrase bearer token (env var) | None — just set `IDO_DEV_TOKEN` |
| `personal` | Solo deployment, no SSO required | Username + bcrypt password via `/api/v1/login` | Create user in setup wizard |
| `saas` | Multi-tenant hosted product | API key per tenant, one user per key | API key management UI |
| `corporate` | Organisation with SSO | OIDC (Google / Microsoft) + API keys | Configure OIDC client_id + secret |

**Developer to production path:**
1. Start in `dev` mode: `IDO_MODE=dev IDO_DEV_TOKEN=mysecret docker compose up`
2. When sharing with a small team: switch to `personal`, create named users in the setup UI
3. When adding SSO: switch to `corporate`, add OIDC credentials — existing API keys continue working

**No mode is deprecated.** `dev` mode intentionally stays simple forever.

### 9.2 Auth Methods

| Method | Token | Used for |
|---|---|---|
| HttpOnly cookie | HS256 JWT session | PWA (primary — survives restarts) |
| Bearer header | HS256 JWT session | API backward compat |
| Bearer header | RS256 OIDC JWT | Google/Microsoft SSO |
| `X-Ido-Api-Key` header | `ido_k_<48 hex>` | Agent API access |
| Bearer `dev` | Dev passphrase | Dev mode only |

### 9.3 API Key Scopes

```
surfaces:write    -- create surfaces
surfaces:read     -- read own tenant's surfaces
tasks:read        -- poll task status
admin             -- tenant management (admin only)
```

### 9.4 Mode Policy

All mode-specific divergence is centralised in one object:

```typescript
interface ModePolicy {
  requireUserId: boolean;          // corporate: true
  validateUserIdMatchesKey: boolean; // saas: true
  allowLocalAuth: boolean;         // personal: true, saas: false
  defaultTenantStrategy: 'token' | 'email' | 'org';
}
```

No mode checks scattered in route handlers.

---

## 10. Real-Time Delivery

### 10.1 SSE (Server-Sent Events)

- Browser connects: `GET /sse?token=...`
- On connect: full replay of all non-archived surfaces for tenant
- Events:
  - `surface_update` — new surface or state change
  - `surface_resolved` — surface completed/cancelled/rejected
  - `notification` — informational push
  - `keepalive` — every 30s
- No cross-tenant broadcast
- Auto-reconnect with replay on reconnect

### 10.2 Web Push

- VAPID-based browser push
- Toggle in profile menu
- Clicking push notification deep-links to `/?surface=<id>`
- All Ido notifications auto-dismissed on app open

### 10.3 SSE Event Shape

All surface pushes use a single typed event factory — no handler builds its own shape:

```typescript
function buildSurfaceUpdateEvent(surface: A2UISurface): SurfaceUpdateEvent {
  // One canonical shape — expiresAt, source, dispatchState always present
}
```

### 10.4 Notification Delivery Policy

Before firing a push notification the delivery layer checks the user's `notification_preferences`. This is a pure server-side gate — surfaces always appear on the dashboard regardless of delivery policy. Policy only controls whether and when a push notification is sent.

**Policy evaluation order:**

```
1. Is push enabled for this user at all?                  No → suppress
2. Is this surface type enabled for push?                  No → suppress
3. Is this notification's severity ≥ user's minimum?       No → suppress
4. Is the user currently in quiet hours?
   - quiet_behaviour = "suppress" → suppress
   - quiet_behaviour = "queue"    → queue until quiet period ends
5. All checks passed → send immediately
```

**Surface type gate:**

| Preference | Controls |
|---|---|
| `push_forms` | Whether `form` surfaces trigger a push |
| `push_approvals` | Whether `approval` surfaces trigger a push |
| `push_notifications` | Whether `notification` surfaces trigger a push |

A typical personal deployment might disable `push_forms` (check them when you get to your desk) but keep `push_approvals` on (need to unblock a pipeline).

**Severity gate** (`push_severity_min`):

Only applies to `notification` surfaces (forms and approvals carry implicit urgency regardless of severity). The minimum severity acts as a floor — anything below it is suppressed:

| `push_severity_min` | Suppressed | Delivered |
|---|---|---|
| `info` | nothing | info, success, warning, error, critical |
| `warning` | info, success | warning, error, critical |
| `error` | info, success, warning | error, critical |
| `critical` | info, success, warning, error | critical only |

**Quiet hours:**

Quiet hours are configured as a time window + timezone + days of week. A common setup: `09:00–18:00, Mon–Fri, Europe/London`.

`quiet_behaviour` controls what happens to a push that arrives during quiet hours:

| Behaviour | Effect |
|---|---|
| `suppress` | Push is never sent. Surface sits on dashboard silently until the user checks it. Good for low-priority notifications. |
| `queue` | Push is held. At the moment quiet hours end, a single batched push is sent: *"3 items waiting for your attention."* Deep link opens the dashboard filtered to unacknowledged items. Good for approvals and forms. |

**Queue flush mechanics:**
- Queued pushes are stored in a new `push_queue` DB table: `(id, tenant_id, user_id, surface_id, queued_at)`
- A server-side cron fires at the start of each user's active window (calculated from `quiet_end` + timezone)
- The cron sends one consolidated push with count + most urgent item title
- If a queued surface is resolved before flush (e.g., human checks dashboard manually), it is removed from the queue — no stale push

**Critical override:**

`critical` severity notifications always push immediately, regardless of quiet hours or `push_severity_min`. A critical alert means something is on fire. Users cannot suppress critical — only disable push entirely.

**Precedence: user settings override tenant defaults.**

If no user row exists in `notification_preferences`, the tenant default is used. If no tenant row exists, the system default is used: all push enabled, no quiet hours, `push_severity_min = info`.

---

## 11. Dashboard & PWA

### 11.1 Surface Sort Order

1. **Expiry urgency** — closest deadline first; no expiry = bottom
2. **Effective recency** — newer first within same urgency tier
3. **Notification virtual expiry** — notifications sink after severity-based freshness window (error 60min, warning 30min, etc.)

### 11.2 Surface Card Design

Each card type (form / approval / notification) uses a shared `SurfaceCard` base component with differentiated:
- Icon (form = clipboard, approval = check/x, notification = bell)
- Accent colour (approval = primary, notification = severity-mapped, form = neutral)
- Action affordance (form = open form, approval = quick approve/reject inline, notification = dismiss)

### 11.3 Mobile Swipe Actions

All surface cards support touch swipe gestures on mobile (iOS and Android PWA). Swipe targets are 44px minimum per HIG/Material spec.

**Swipe left (destructive zone — red):**
- Form: Archive with confirmation bottom sheet ("Archive this request?")
- Approval: Archive with confirmation
- Notification: Dismiss immediately (no confirmation — low stakes)

**Swipe right (positive zone — green/blue):**
- Approval surfaces only: Quick approve
  - If no `reason` field required: approves immediately
  - If `reason` is required: opens a compact reason bottom sheet before confirming
- Form: Opens the form (same as tap)
- Notification: Not applicable — reverts

**Confirmation bottom sheet** (on destructive swipe):
- Slides up from bottom — native feel on mobile
- Destructive action button (red) + Cancel
- Auto-dismisses after 5 seconds with subtle countdown if no action
- Tap outside = cancel

**Implementation notes:**
- Use `useSwipe` custom hook wrapping touch events — no third-party swipe library
- Cards must not swipe when the user is scrolling vertically (distinguish horizontal vs vertical drag direction in the first 10px)
- Swipe is disabled when a surface is in a non-interactive state (e.g., already submitted)

### 11.4 Notification Bundling

When the same `source` sends more than 3 notifications within 5 minutes, they are grouped into a single expandable card: *"5 updates from Deploy Bot"*. Expanding shows individual items.

### 11.5 Bulk Actions

- Select multiple cards → Archive All / Dismiss All
- "Clear all notifications" shortcut

### 11.6 Design System

Design token source: `DESIGN.MD` (Ido Slate). All tokens expressed as CSS custom properties. Tailwind config derives from the same tokens.

Mobile-first: all components designed at 320px, scaled up. No component assumes `> 480px`.

---

## 12. Multi-Tenancy & Team Routing (v2 design note)

Currently surfaces route to a single `user_id` or the whole tenant. For corporate use:

**Team routing (v2):** A surface can target a `group_id` instead of `user_id`. Any member of the group can respond. First to respond closes the task.

**Escalation (v2):** If `response_deadline` passes without action, surface is escalated to `escalate_to` (another user or group).

**Delegation:** A human can forward a surface to another user. The system records the delegation chain in `surface_events`. An agent can re-delegate a task to another agent via `tasks/delegate` (v2 method).

These are not implemented in the rebuild but `surface_events` must exist and `a2ui_surfaces.user_id` should be nullable by design.

---

## 13. Visual Design & UX

### 13.1 Aesthetic Direction

Ido is a **terminal**, not a social app. The aesthetic is intentional: calm, high-density, trusted. The design language is **Ido Slate** — a dark-anchored neutral palette with sharp semantic colour signals. Nothing decorative that doesn't carry information.

**Key character words:** Precise. Legible. Calm under load. Trustworthy. Fast to scan.

Design source of truth: `DESIGN.MD`. Tailwind config derives from it. All CSS custom properties are named tokens — no magic numbers.

### 13.2 Colour Palette

| Role | Token | Light value | Dark value |
|---|---|---|---|
| Background | `--bg-base` | `#F8F9FA` | `#0F1117` |
| Surface card | `--bg-surface` | `#FFFFFF` | `#1A1D27` |
| Border | `--border` | `#E2E8F0` | `#2D3148` |
| Primary | `--primary` | `#3B5BDB` | `#4C6EF5` |
| Text primary | `--text-primary` | `#0F172A` | `#E2E8F0` |
| Text secondary | `--text-secondary` | `#64748B` | `#8892A4` |
| Form accent | `--accent-form` | `--border` | `--border` |
| Approval accent | `--accent-approval` | `#3B5BDB` | `#4C6EF5` |
| Notification info | `--accent-info` | `#3B82F6` | `#60A5FA` |
| Notification success | `--accent-success` | `#10B981` | `#34D399` |
| Notification warning | `--accent-warning` | `#F59E0B` | `#FBBF24` |
| Notification error | `--accent-error` | `#EF4444` | `#F87171` |
| Notification critical | `--accent-critical` | `#DC2626` | `#FCA5A5` |

### 13.3 Typography

One font family: **Inter** (variable). No decorative fonts.

| Scale | Token | Size | Weight | Usage |
|---|---|---|---|---|
| Display | `--text-display` | 20px | 600 | Surface card title |
| Heading | `--text-heading` | 16px | 600 | Card section headers |
| Body | `--text-body` | 14px | 400 | All body text |
| Caption | `--text-caption` | 12px | 400 | Timestamps, source labels |
| Label | `--text-label` | 11px | 500 | Field labels, badge text |

Line height: 1.5 for body, 1.2 for display/heading. Letter spacing: normal. No justified text.

### 13.4 Surface Card Anatomy

Each dashboard card has a strictly defined zones:

```
┌─────────────────────────────────────────────────────┐
│ [icon]  TITLE                        [source] [time] │  ← header
├─────────────────────────────────────────────────────┤
│  context paragraph (optional, max 3 lines, clipped)  │  ← context
│  [A2UI components — preview only on dashboard]       │  ← preview
├─────────────────────────────────────────────────────┤
│  [action buttons / status badge]      [expiry chip]  │  ← footer
└─────────────────────────────────────────────────────┘
```

- Card left border: 3px solid accent colour (type-differentiated)
- Shadow: `0 1px 3px rgba(0,0,0,0.08)` — subtle, not dramatic
- Radius: `--radius-md` (8px)
- No surface card shows the full form inline — tap/click opens it in a bottom sheet (mobile) or modal (desktop)
- Dashboard preview shows only the `context` text + up to 2 display components (Badge row, ProgressBar row)
- Input components are **never** rendered in the dashboard card preview

### 13.5 Dark Mode

Dark mode is **first-class**, not an afterthought. All tokens have dark variants. System preference is respected automatically via `prefers-color-scheme`. Manual toggle in the user menu persists to `localStorage`.

No component hardcodes a colour value. Every colour reference is a CSS custom property.

### 13.6 Motion & Animation

Motion is **minimal and purposeful** — it communicates state changes, not decoration.

| Event | Animation | Duration |
|---|---|---|
| New surface arrives (SSE) | Card slides in from top, subtle glow on border for 2s | 300ms |
| Surface resolved | Card fades + scales down to 0, gap closes | 250ms |
| Swipe gesture | Card follows finger linearly, action icon reveals proportionally | — |
| Bottom sheet open | Slides up from bottom | 280ms ease-out |
| Bottom sheet close | Slides down | 220ms ease-in |
| Form submit success | Sheet closes, card resolves animation | — |
| Loading skeleton | Pulse (opacity 0.4 ↔ 0.8) | 1.2s infinite |

Respect `prefers-reduced-motion`: all transitions reduce to instant state changes, no movement.

### 13.7 Empty States

Empty states are **informative and calm** — they explain what Ido does to new users, and confirm quiet periods for experienced users.

**Dashboard — no surfaces:**
```
[Ido logo, muted]
Nothing waiting for you right now.
Surfaces from your AI agents will appear here.
[Learn how to connect an agent →]
```

**Dashboard — all archived:**
```
[Checkmark icon, muted green]
All caught up.
```

**Notification-only empty (all closed):**
```
[Bell icon, muted]
No active notifications.
```

**Settings / API Keys — no keys:**
```
[Key icon]
No API keys yet.
Create one to connect your first agent.
[Create API key]
```

Empty state illustrations: SVG, monochrome, using `--text-secondary` colour. No colourful illustrations.

### 13.8 Loading States

Never show a blank page. Every data load shows a skeleton:

- Dashboard: 3 skeleton cards, card-shaped, pulse animation
- Surface form: Skeleton form fields matching the expected layout
- Settings: Skeleton rows

Minimum skeleton display time: **none** — show real content immediately when ready. Never delay content to show a skeleton.

SSE reconnection: soft banner at top: "Reconnecting…" (no spinner, no blocking overlay). Disappears automatically when SSE reconnects.

### 13.9 Form UX

- **Validation timing**: Validate on blur (when user leaves a field), not on change. Do not show errors while the user is actively typing.
- **Error display**: Inline below the field. Red text, `--accent-error` colour. Field border turns `--accent-error`.
- **Required indicator**: `*` in `--accent-error` after the label. Explained once at the top of the form: "* Required".
- **Submit state**: Submit button shows spinner + "Submitting…" while in-flight. Disabled during submission.
- **Success**: Bottom sheet closes with a brief ✓ transition on the dashboard card before it fades out.
- **Network error on submit**: Error toast at bottom of screen: "Couldn't submit. Check your connection and try again." Form data is preserved.
- **Expired surface**: If a surface has expired while the user has it open, the submit button becomes "This request has expired" and is disabled. The form data is preserved so the user can reference it.

### 13.10 Accessibility

WCAG 2.1 AA compliance is **required** for all interactive components. This is non-negotiable for enterprise deployment.

| Requirement | Implementation |
|---|---|
| Colour contrast | All text on background ≥ 4.5:1 (7:1 for small text). Verified with automated tests. |
| Keyboard navigation | All interactive elements reachable via Tab. Logical order. No keyboard traps. |
| Focus indicators | `:focus-visible` with 2px outline, `--primary` colour. Never hidden. |
| Screen reader | Semantic HTML (buttons are `<button>`, not `<div>`). ARIA roles only where HTML semantics are insufficient. |
| Dynamic content | Surface arrivals announced via `aria-live="polite"` region. Critical notifications via `aria-live="assertive"`. |
| Form errors | Linked to field via `aria-describedby`. Announced on focus. |
| Bottom sheets | Trap focus within sheet. `Escape` closes. `aria-modal="true"`. |
| Swipe actions | Swipe gestures have keyboard equivalents (context menu / long-press menu on mobile). |
| Images | All `<img>` elements have descriptive `alt` text. Decorative images use `alt=""`. |
| Reduced motion | All CSS transitions respect `prefers-reduced-motion: reduce`. |

---

## 14. Folder Structure

```
/
├── proxy/                    Backend (Hono + TypeScript)
│   ├── src/
│   │   ├── api/              Route handlers — thin, no business logic
│   │   │   ├── a2a.ts        JSON-RPC dispatcher
│   │   │   ├── mcp.ts        MCP tool handler
│   │   │   ├── surfaces.ts   REST surface CRUD
│   │   │   └── auth.ts       Login, logout, token
│   │   ├── domain/           Business logic — no HTTP, no DB
│   │   │   ├── surfaces.ts   createSurface(), submitSurface(), cancelSurface()
│   │   │   ├── tasks.ts      Task lifecycle
│   │   │   ├── dispatch.ts   Callback delivery + retry
│   │   │   └── expiry.ts     Expiry sweep
│   │   ├── a2ui/             Component system
│   │   │   ├── schema.ts     Zod schemas for all 37 components
│   │   │   ├── renderer.ts   JSON layout → validated component tree
│   │   │   └── auto.ts       Auto-layout from inputs_schema only
│   │   ├── db/               Data access
│   │   │   ├── adapter.ts    DBAdapter interface
│   │   │   ├── sqlite.ts     SQLite implementation
│   │   │   ├── pg.ts         PostgreSQL implementation
│   │   │   ├── queries.ts    All queries (Kysely)
│   │   │   └── migrations/   SQL migration files
│   │   ├── auth/             Auth helpers
│   │   │   ├── session.ts    JWT issue/verify
│   │   │   ├── oidc.ts       Google/MS JWT verify
│   │   │   ├── keys.ts       API key issue/verify
│   │   │   └── policy.ts     ModePolicy — centralised mode logic
│   │   ├── sse/              Real-time
│   │   │   ├── manager.ts    SSE connection manager
│   │   │   └── events.ts     Typed event factories (single source)
│   │   ├── push/             Web Push
│   │   ├── agents/           Agent adapter interface + implementations
│   │   │   ├── adapter.ts    AgentAdapter interface
│   │   │   └── hermes.ts     Hermes implementation
│   │   ├── types.ts          Domain types (derived from Zod where possible)
│   │   ├── config.ts         Config + ModePolicy
│   │   └── index.ts          Server bootstrap only — no routes, no logic
│
├── ido-web/                  PWA (React + Vite + Tailwind)
│   ├── src/
│   │   ├── components/
│   │   │   ├── catalog/      37 A2UI components
│   │   │   ├── surface/      Surface renderer + tree builder
│   │   │   ├── dashboard/    Dashboard + surface cards
│   │   │   ├── settings/     Settings pages
│   │   │   └── setup/        First-run setup wizard
│   │   ├── stores/           Zustand stores
│   │   ├── services/         API client
│   │   ├── hooks/            Custom hooks
│   │   └── styles/           Tailwind + design tokens
│
├── shared/                   Shared types (optional, if monorepo)
│   └── a2ui-schema.ts        A2UI Zod schemas — imported by both proxy and web
│
├── migrations/               SQL migration files (plain SQL, numbered)
├── demo_payloads/            Test payloads (keep + expand)
├── Docs/                     Documentation
└── docker-compose.yml
```

---

## 15. Key Technical Decisions vs Current Code

| Issue (current) | Decision (rebuild) |
|---|---|
| `index.ts` 1372 lines doing routing + auth + business logic | Thin `index.ts` for bootstrap only. Routes in `api/`. Logic in `domain/`. |
| `createSurface` duplicated in 3 handlers | Single `domain/surfaces.ts:createSurface()` called by all entry points |
| `validateLayout` defined in multiple files | Single `a2ui/schema.ts` using Zod — one definition, derived everywhere |
| `A2UIComponent.component: Record | string` ambiguity | `component` is always `string`. Props always in `props`. Zod-enforced. |
| `buildComponentTree !c.parent` silent child-drop bug | Rewritten, tested, fail-loud |
| `Row` force-wraps every child in `flex: 1 1 0` | `Row` is a pure flex container. Child sizing is the child's responsibility. |
| CSS 6000-line monolith | Tailwind utility classes. Component-scoped CSS only for truly global tokens. |
| Two CSS files (ergo-web legacy) | Removed. Single `ido-web` CSS source. |
| Three `VALID_COMPONENTS` sets in different files | One `a2ui/schema.ts` export |
| `as any` casts in renderer | Eliminated by Zod-derived types throughout |
| No CI | GitHub Actions: `tsc`, `vite build`, test payloads validation on every push |
| `ModePolicy` scattered across handlers | `config.ts:ModePolicy` object, one place |
| Surface events unaudited | `surface_events` table, every state transition logged |
| No rate limiting | Per-tenant rate limit middleware: 60 surface creates/minute; 600 reads/minute |
| No CORS policy | Explicit CORS whitelist in config. `*` only in `dev` mode. |

---

## 16. Testing Requirements

The rebuild ships with a complete test suite. Tests are shell scripts + JSON payloads — no test framework dependency, runnable against any live instance with one command.

### 16.1 Test Runner — `ido-test.sh`

Single entry point. Runs all suites in order, prints a summary, exits non-zero on any failure.

```
bash ido-test.sh                   # runs everything against localhost
IDO_BASE_URL=https://... bash ido-test.sh   # runs against a deployed instance
IDO_API_KEY=ido_k_... bash ido-test.sh      # with API key auth
--suite surfaces                   # run one suite only
--suite negative
--suite expiry
--suite mcp
--suite demo
```

Every test is labelled `✅ PASS` / `❌ FAIL` with a one-line reason. Final line: `N passed, N failed`. Exit code 0 = all passed.

### 16.2 Test Suites

#### Suite: surfaces (positive)

Full lifecycle for each surface type — create → verify pending → submit/approve/reject → verify completed → verify output shape.

| Test | Surface type | What it verifies |
|---|---|---|
| Form — single text field | `form` | Create, poll `input_required`, submit, poll `completed`, user_input preserved |
| Form — all schema types | `form` | `string`, `number`, `boolean`, `enum` fields all round-trip correctly |
| Form — initial_data_model | `form` | Pre-fill values appear in task read, overridable on submit |
| Form — required field enforcement | `form` | Submit without required field → 422, task stays `input_required` |
| Form — a2ui_layout present | `form` | Custom component tree accepted, surface_id returned |
| Approval — approve | `approval` | Create, approve, poll `completed`, decision = approved |
| Approval — reject | `approval` | Create, reject, poll `rejected` |
| Approval — reject with reason | `approval` | Reason captured in output |
| Notification — info | `notification` | Create → immediately `completed`, no submit needed |
| Notification — warning | `notification` | `severity=warning` stored and returned |
| Notification — error | `notification` | `severity=error` |
| Notification — critical | `notification` | `severity=critical` |
| Notification — no context | `notification` | Empty context → 422 |
| Cancel — pending form | `form` | Create → cancel → poll `cancelled` |
| Cancel — already completed | `form` | Create → submit → cancel → 409 (cannot cancel completed) |
| Idempotency | `form` | Same `idempotency_key` twice → second call returns first task unchanged |

#### Suite: negative (validation)

All payloads in `demo_payloads/test_negative/` must be **rejected** with an appropriate error code. Each rejection is a pass.

Current negative cases (21 payloads):

| File | Expected rejection reason |
|---|---|
| `01_approval_form.json` | `Form` component in `approval` layout |
| `02_approval_picker.json` | `ChoicePicker` in `approval` layout (server-owned) |
| `03_approval_checkbox.json` | `Checkbox` in `approval` layout |
| `04_approval_select.json` | `Select` in `approval` layout |
| `05_approval_input.json` | `InputField` in `approval` layout |
| `06_approval_button.json` | `Button` in any layout |
| `07_approval_extra_prop.json` | Extra `inputs_schema` property on approval |
| `08_approval_tri_enum.json` | Non-boolean decision enum on approval |
| `09_approval_no_decision.json` | Approval with no decision mechanism |
| `10_form_button.json` | `Button` component in form layout |
| `11_form_in_column.json` | `Form` nested inside `Column` |
| `12_form_in_row.json` | `Form` nested inside `Row` |
| `13_notif_form.json` | `Form` in notification layout |
| `14_notif_checkbox.json` | `Checkbox` in notification layout |
| `15_notif_input.json` | `InputField` in notification layout |
| `16_notif_button.json` | `Button` in notification layout |
| `17_missing_surface_type.json` | No `surface_type` field |
| `18_invalid_surface_type.json` | `surface_type = "chat"` |
| `19_bad_layout_entry.json` | Layout entry with no `id` |
| `20_missing_entry_id.json` | Component referencing non-existent parent id |
| `21_unknown_component.json` | Unknown component type name |

New negative cases to add for rebuild:

| File | Expected rejection |
|---|---|
| `22_form_no_schema.json` | `form` with empty `inputs_schema.properties` |
| `23_missing_title.json` | No `surface_title` |
| `24_expired_in_past.json` | `expires_at` is a past timestamp |
| `25_duplicate_bind.json` | Two components with same `bind` value |
| `26_bind_on_display.json` | `bind` on a `Text` component |
| `27_circular_parent.json` | Component A is parent of B, B is parent of A |
| `28_approval_with_severity.json` | `severity` on a non-notification surface |

#### Suite: expiry

Expiry is tested with short TTLs (5–10 seconds) to avoid slow tests.

| Test | What it verifies |
|---|---|
| Form expires — status | Create with `expires_at = now+5s`, wait 10s, poll → `TASK_STATE_FAILED`, reason `EXPIRED` |
| Form expires — no submit | Attempt submit after expiry → 410 Gone |
| Form expires — no callback | Callback URL provided, form expires → callback is NOT called |
| Approval expires | Same lifecycle as form expiry |
| Notification never expires | `notification` does not accept `expires_at` — should be silently ignored or rejected (define in impl) |
| Expiry countdown display | Surface with `expires_at = now+1h` → response includes `expires_at` field for frontend countdown |

#### Suite: mcp

Full MCP protocol lifecycle + all 6 tools.

| Test | What it verifies |
|---|---|
| `initialize` | Returns `protocolVersion: "2024-11-05"`, `capabilities`, `serverInfo` |
| `ping` | Returns `{}` result, no auth required |
| `tools/list` | Returns all 6 tools with `inputSchema` |
| `ido_get_skills_guide` | Returns `version`, `decisionTree`, `templates`, `componentCatalog` |
| `ido_send_task` — form | Creates form, returns task_id in content |
| `ido_send_task` — approval | Creates approval |
| `ido_send_task` — notification | Creates notification |
| `ido_check_task` | Returns task status for created task |
| `ido_list_tasks` | Returns array of tasks |
| `ido_read_task` | Returns full surface details including components_json |
| `ido_answer_task` | Submits answer to pending task, task moves to completed |
| MCP without auth | `tools/call` without `X-Ido-Api-Key` → `-32001` error |
| Unknown tool name | Returns `-32601` unknown tool error |

#### Suite: a2a

A2A JSON-RPC protocol compliance.

| Test | What it verifies |
|---|---|
| `message/send` → `tasks/get` | Full round-trip |
| `tasks/list` | Returns tasks for tenant |
| `tasks/cancel` | Cancels a pending task |
| `skills/guide` | Returns skills guide, no auth required |
| `skills/list-templates` | Returns built-in template list |
| Invalid JSON-RPC (no id) | Returns `-32600` |
| Unknown method | Returns `-32601` |
| Auth missing | Returns `-32001` |

#### Suite: demo (`ido-demo.sh`)

The demo suite creates one richly-laid-out surface of each type using real demo payloads from `demo_payloads/`. It does not assert on specifics — it asserts that every payload is accepted (no 4xx) and a `surface_id` is returned. This is the "does it look right" visual smoke test.

Demo payloads to include (all existing + new):
- `daily_standup.json`, `employee_onboarding.json`, `travel_request.json`, `budget.json`
- `speaker_approval.json`, `vendor_approval.json`, `change_management.json`
- `system_health.json`, `market_alert.json`, `order_shipped.json`, `stock_alert_config.json`
- `product_grid.json`, `conference_registration.json`, `it_incident.json`

The demo suite exits with a dashboard URL: *"Open http://localhost:8645 to see all 14 demo surfaces."*

### 16.3 New Demo Payloads Needed

The following surfaces should be added to `demo_payloads/` to exercise features specced in the rebuild but not yet represented:

| File | Purpose |
|---|---|
| `approval_with_reason.json` | Approval with `reason` field — tests server-injected reason input |
| `notification_severity_set.json` | One of each severity: info / success / warning / error / critical |
| `form_conditional.json` | Form with `visible` rules (show/hide a field based on another field) |
| `form_with_expiry.json` | Form with `expires_at` set to 30 minutes — shows countdown |
| `form_initial_data.json` | Form with `initial_data_model` pre-filling several fields |
| `form_all_input_types.json` | One of each input component: InputField, Select, Checkbox, DatePicker, Rating, Slider, Signature |
| `notification_rich_layout.json` | Notification with Badge row + ProgressBar + RichText markdown body |
| `template_standup.json` | Form using the built-in `standup` template |

### 16.4 CI Integration

GitHub Actions workflow runs on every push to `main` and every PR:

```yaml
# .github/workflows/test.yml
steps:
  - run: docker compose up -d
  - run: sleep 5  # wait for server
  - run: bash ido-test.sh --suite surfaces
  - run: bash ido-test.sh --suite negative
  - run: bash ido-test.sh --suite mcp
  - run: bash ido-test.sh --suite a2a
  - run: bash ido-test.sh --suite expiry
  - run: docker compose down
```

The demo suite is **not** run in CI — it is for human visual inspection only.

---

## 17. What Is Explicitly Out of Scope for the Rebuild

- **Chat UI** — reserved via `AgentAdapter` interface, not implemented
- **Dynamic data sources** — `source` prop reserved in component schema, not implemented
- **Multi-step workflow chains** — architecture doesn't block them, not implemented
- **Team routing / escalation** — DB schema supports nullable `user_id`, full routing in v2
- **SDK / client libraries** — spec only, not built
- **Scheduled / recurring surfaces** — v2
- **`hideOn` responsive visibility** — prop schema reserved, not implemented
- **`412 Skills Guide Outdated` response** — versioning signal reserved, not implemented

> Notification bundling (§11.4) and bulk actions (§11.5) are **in scope** for the rebuild — they are specced above.

---

## 18. Migration Path

The rebuild is a **clean repo** (not a branch). Reasons:
- Removing the legacy REST handler, ergo-web, and dual component prop format breaks backward compat
- Starting clean avoids carrying debt forward into the new structure
- Demo payloads and Docs are copied verbatim
- The A2A JSON-RPC protocol is preserved exactly — any agent using `message/send` today will work without changes

Migration checklist for existing deployments:
1. Export surface history from old DB (`GET /api/v1/surfaces?include_archived=true`)
2. Deploy new instance
3. Import via migration script (provided)
4. Update agent configs: remove legacy `POST /api/v1/a2a/task` usage, switch to `POST /api/v1/a2a`
