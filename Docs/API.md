# API Reference

All three protocols — A2A, MCP, and REST — call a single shared `createSurface()` function. The surface lifecycle is identical regardless of which protocol an agent uses.

---

## Authentication

All protocol endpoints require an API key. Pass it in the `X-Ido-Api-Key` header:

```bash
-H "X-Ido-Api-Key: ido_k_..."
```

API keys are created and managed in the web UI under **Settings → API Keys**. Key scoping depends on deployment mode:
- `dev`: one default tenant key
- `personal`: user-scoped
- `saas`: key-scoped to tenant
- `corporate`: org-scoped, `user_id` required on every surface

---

## A2A (Agent-to-Agent JSON-RPC)

Endpoint: `POST /api/v1/a2a`

Standard JSON-RPC 2.0. Agents send a `message/send` with surface parameters.

```bash
curl -X POST http://localhost:8645/api/v1/a2a \
  -H "Content-Type: application/json" \
  -H "X-Ido-Api-Key: ido_k_..." \
  -d '{
    "jsonrpc": "2.0",
    "method": "message/send",
    "params": {
      "surface_type": "approval",
      "surface_title": "Approve deployment to production?",
      "context": "PR #142 ready to merge",
      "configuration": {
        "pushNotificationConfig": {
          "url": "https://my-agent.example.com/callback"
        }
      }
    },
    "id": 1
  }'
```

---

## MCP (Model Context Protocol)

Endpoint: `POST /api/v1/mcp`

Standard JSON-RPC 2.0 with MCP tool semantics. Call `tools/list` to discover available tools and their schemas.

### Available Tools

| Tool | Description |
|---|---|
| `ido_get_skills_guide` | Full component catalog, templates, and validation rules |
| `ido_send_task` | Create a surface (form, approval, or notification) |
| `ido_check_task` | Poll task status and get the result |
| `ido_list_tasks` | List all tasks for this API key |
| `ido_read_task` | Read full surface details including components and data |
| `ido_answer_task` | Submit a response as an agent acting on behalf of a human |
| `ido_cancel_task` | Cancel a pending task — works on any surface type, no fields required |

### Example: Create a surface

```bash
curl -X POST http://localhost:8645/api/v1/mcp \
  -H "Content-Type: application/json" \
  -H "X-Ido-Api-Key: ido_k_..." \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "ido_send_task",
      "arguments": {
        "surface_type": "form",
        "surface_title": "Bug Report",
        "components": [...],
        "schema": {...}
      }
    },
    "id": 1
  }'
```

---

## REST

Endpoint: `POST /api/v1/surfaces`

Standard REST with JSON body.

```bash
curl -X POST http://localhost:8645/api/v1/surfaces \
  -H "Content-Type: application/json" \
  -H "X-Ido-Api-Key: ido_k_..." \
  -d '{
    "surface_type": "form",
    "surface_title": "Feature Request",
    "components": [...],
    "schema": {...}
  }'
```

### Other REST endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/surfaces` | List surface summaries. `?state=INPUT_REQUIRED` to filter. `?exclude_expired=true` to omit past-expiry. |
| `GET` | `/api/v1/surfaces/:id` | Get full surface record (components, schema, data) |
| `POST` | `/api/v1/surfaces/:id/submit` | Submit form data and/or approval decision |
| `POST` | `/api/v1/surfaces/:id/dismiss` | Dismiss a notification |
| `POST` | `/api/v1/surfaces/:id/decline` | Decline/cancel a surface |
| `POST` | `/api/v1/surfaces/:id/archive` | Archive a completed surface |

---

## Agent Discovery

Ido exposes a standard agent card for discovery:

```bash
curl http://localhost:8645/.well-known/agent-card.json
```

This returns the agent's capabilities, endpoints, and authentication requirements — compatible with A2A agent discovery.

---

## Skills Guide

The full API reference is served at runtime — component catalog, templates, validation rules:

```
GET /api/v1/skills-guide    # Human-readable guide for agents
GET /api/v1/schema          # Machine-readable JSON Schema
GET /api/v1/templates       # Available surface templates
```

Point your AI agent at the Skills Guide before sending its first task. It describes every component, template, and validation rule the system enforces.

---

## Surface Types

### Form

A structured form with fields defined by the A2UI component schema. Supports text inputs, selects, checkboxes, radio groups, date pickers, and more. Responses are validated against the schema.

### Approval

A yes/no decision with an optional reason. Can include additional form fields for context (e.g., deployment parameters alongside the approval).

### Notification

A read-only message delivered to the user. Can be dismissed. Supports Markdown content and optional action links.

---

## Callbacks

When an agent provides a `pushNotificationConfig.url`, Ido dispatches the human's response back to that URL after the surface is resolved. Dispatch uses exponential backoff with jitter for reliability.

---

## Web Push

When a user has granted push permission and is not connected via SSE, Ido sends a browser notification via Web Push (VAPID). Clicking the notification opens the PWA directly to the surface. Push subscriptions are managed per-device and respect quiet hours.
