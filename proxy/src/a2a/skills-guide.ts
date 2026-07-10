import type { DeploymentMode } from '../types.js';
import { getComponentJsonSchema, type A2UISchemaDocument } from '../a2ui/schema.js';

export interface SkillsGuide {
  version: string;
  instructions: string;
  decisionTree: unknown;
  templates: Record<string, unknown>;
  schemaTypes: Record<string, string>;
  componentCatalog: Record<string, Record<string, string>>;
  componentSchema: A2UISchemaDocument;
  validationRules: string[];
  pitfalls: string[];
  modeNotes?: string;
}

export function getSkillsGuide(mode: DeploymentMode): SkillsGuide {
  const guide: SkillsGuide = {
    version: '2.5',
    instructions: `Call ido_get_skills_guide before sending any task to Ido.
This guide describes every component, template, and rule the system enforces.
Copy the template that matches your use case — fill in your data — send the task.
For programmatic validation, use the "componentSchema" field below (or GET /api/v1/schema):
it is machine-readable JSON Schema generated from the same rules the server enforces,
so a layout that validates against it will be accepted.`,

    decisionTree: {
      question: 'Does the human need to fill in fields?',
      yes: 'form',
      no: {
        question: 'Simple yes/no with no business fields?',
        yes: 'approval',
        no: 'notification',
      },
      default: 'form',
    },

    templates: {
      form: {
        surface_type: 'form',
        surface_title: 'Your Form Title',
        context: 'Brief plain-text description of the form purpose.',
        inputs_schema: {
          type: 'object',
          properties: {
            field_name: { type: 'string', title: 'Field Label', description: 'Help text' },
          },
          required: [],
        },
        a2ui_layout: [
          { id: 'card', component: 'Card', props: { title: 'Your Form Title' }, children: ['form-root'] },
          { id: 'form-root', component: 'Form', props: { submitLabel: 'Submit' }, parent: 'card', children: ['field-1'] },
          { id: 'field-1', component: 'InputField', props: { label: 'Field Label', type: 'text' }, bind: 'field_name', parent: 'form-root' },
        ],
        // Optional: receive a webhook callback when the human responds.
        // The callback URL must be reachable from the Ido server.
        // configuration: {
        //   pushNotificationConfig: {
        //     url: 'https://your-agent.example.com/callback',
        //     token: 'optional-bearer-token',
        //   },
        // },
      },
      approval: {
        surface_type: 'approval',
        surface_title: 'Approval Request',
        context: 'Brief plain-text summary of the decision needed.',
        inputs_schema: {
          type: 'object',
          properties: {
            reason: { type: 'string', title: 'Reason (optional)', description: 'Explain your decision' },
          },
        },
        a2ui_layout: [
          { id: 'card', component: 'Card', props: { title: 'Approval Request' }, children: ['detail'] },
          { id: 'detail', component: 'RichText', props: { markdown: 'Put **detailed** formatted information here — names, figures, links, bullet points.' }, parent: 'card' },
        ],
        action_validation: {
          approve: {},
          reject: { required_fields: [] },
        },
      },
      notification: {
        surface_type: 'notification',
        surface_title: 'Notification Title',
        context: 'Brief one-line summary. Keep it short — this shows in card previews.',
        severity: 'info',
        a2ui_layout: [
          { id: 'card', component: 'Card', props: { title: 'Notification Title' }, children: ['body'] },
          { id: 'body', component: 'RichText', props: { markdown: 'Detailed notification body with **markdown** formatting.' }, parent: 'card' },
        ],
      },
    },

    schemaTypes: {
      string: 'text input, email, password, tel, url, time, date, datetime-local',
      number: 'numeric input with optional min/max/step',
      boolean: 'ChoicePicker with single boolean option or Checkbox',
      enum: 'ChoicePicker with provided options',
    },

    componentCatalog: {
      layout: {
        Card: '{ title?: string, subtitle?: string }',
        Column: '{ gap?: number, align?: "start"|"center"|"end"|"stretch" }',
        Row: '{ gap?: number, align?: "start"|"center"|"end"|"stretch", wrap?: "always"|"never"|"auto", maxColumns?: number }',
        Accordion: '{ title: string, defaultOpen?: boolean }',
        Stepper: '{ steps: [{label, description?}], current: number }',
      },
      input: {
        Form: '{ submitLabel?: string, cancelLabel?: string }',
        InputField: '{ label: string, type?: "text"|"email"|"password"|"number"|"tel"|"url"|"date"|"time"|"datetime-local", placeholder?: string, multiline?: boolean }',
        TextField: '{ label: string, placeholder?: string, rows?: number }',
        Select: '{ label: string, options: [{label, value}] }',
        ChoicePicker: '{ label?: string, options: [{label, value}], variant?: "chips"|"checkbox", displayStyle?: "inline"|"stacked" } — variant:"checkbox" = multi-select, values stored as comma-separated string',
        Checkbox: '{ label: string }',
        DatePicker: '{ label: string, min?: string, max?: string }',
        Rating: '{ label: string, max?: number }',
        Slider: '{ label: string, min: number, max: number, step?: number }',
        FileInput: '{ label: string, accept?: string, multiple?: boolean }',
        ImagePicker: '{ label: string, accept?: string, multiple?: boolean }',
        ImageSelect: '{ items: [{src, value, label?}], mode?: "single"|"multiple", columns?: number }',
        Signature: '{ label: string }',
      },
      display: {
        Text: '{ text: string, usageHint?: "heading"|"subheading"|"body"|"caption"|"label" }',
        RichText: '{ markdown: string }',
        Badge: '{ text: string, color?: string, variant?: "solid"|"outline"|"subtle" }',
        ProgressBar: '{ value: number, max?: number, label?: string, showValue?: boolean, variant?: "default"|"success"|"warning"|"error" }',
        Divider: '{ label?: string }',
        Image: '{ src: string, alt?: string, fit?: "cover"|"contain"|"fill"|"none", radius?: "none"|"sm"|"md"|"lg"|"full" }',
        Link: '{ text: string, href: string, target?: "_self"|"_blank" }',
      },
      data: {
        Table: '{ headers: string[], rows: string[][], compact?: boolean, striped?: boolean }',
        DataGrid: '{ columns: [{key, label, editable?}], rows: Record<string,unknown>[], editable?: boolean }',
        BarChart: '{ title?: string, data: [{label, value}], height?: number, colors?: string[] }',
        LineChart: '{ title?: string, data?: [{label, value}] | series?: [{name, data: [{label, value}]}], height?: number, colors?: string[] } — multi-series with legend',
        PieChart: '{ title?: string, data: [{label, value}], height?: number, colors?: string[] }',
        DonutChart: '{ title?: string, data: [{label, value}], colors?: string[] }',
        ProductGrid: '{ bind?: string, mode?: "single"|"multiple", columns?: number } — selectable grid container; bind tracks selected ItemCard values as comma-separated string',
        ItemCard: '{ title: string, subtitle?: string, image?: string, price?: string, badge?: string, value?: string } — value used for selection tracking',
        Map: '{ lat: number, lng: number, zoom?: number, marker?: {lat, lng, label?} }',
      },
      visibility: {
        description: 'Any component can have a "visible" prop that conditionally shows/hides it based on form data.',
        single: '{ visible: { when: "field_name", operator: "equals|notEquals|exists|notExists|greaterThan|lessThan|in", value: expected } }',
        and: '{ visible: { all: [{ when: "a", operator: "equals", value: "x" }, { when: "b", operator: "greaterThan", value: 5 }] } }',
        or: '{ visible: { any: [{ when: "a", operator: "equals", value: "x" }, { when: "a", operator: "equals", value: "y" }] } }',
        notes: 'Hidden components do not submit their bound values. Rules re-evaluate on every keystroke.',
      },
    },

    componentSchema: getComponentJsonSchema(),

    validationRules: [
      'Every component must have a unique id',
      'Input components need bind pointing to an inputs_schema property',
      'Send inputs_schema, a2ui_layout and initial_data_model as real JSON objects/arrays — NEVER as JSON-encoded strings. Do not wrap the arguments in an extra array or object.',
      'Every bind on an input component MUST also appear as a key in inputs_schema.properties, or the surface is rejected with UNRESOLVED_BIND (e.g. a Signature with bind:"buyer_signature" requires inputs_schema.properties.buyer_signature)',
      'Approval surfaces: inputs_schema may only contain "reason" — all other context belongs in RichText components in the layout',
      'Notification surfaces: no input components at all',
      'Button is server-owned — never include it in a layout',
      'Form component: exactly one per surface, must be top-level child of Card',
      'ChoicePicker in approval: server-injected, never send it',
      'Props are always in the "props" field, component name is just a string',
      'Never nest a component object inside the "component" field',
      'Severity is only valid on notification surfaces',
      'Required fields are defined ONLY in inputs_schema.required array — the asterisk is derived automatically',
      'Every field in inputs_schema.required MUST have a corresponding input component in the layout with a matching bind — otherwise the surface is rejected (REQUIRED_FIELD_NO_BIND) because the user could never fill in the missing field',
      'Do NOT set "required": true on individual component props — it will be rejected',
      'The a2ui_layout is a flat array of components. Each entry is a standalone object with its own id. Components link to each other via parent ("I belong to X") and children ("I contain these ids"). Every id in children must exist as a separate top-level entry in the array — children is a flat reference list, never a nested path.',
      'To receive a callback when the human responds, set configuration.pushNotificationConfig.url (required) and configuration.pushNotificationConfig.token (optional bearer token). The callback is a POST with {task_id, surface_id, status, user_input, submitted_at}. Callbacks retry with exponential backoff for up to 12 attempts.',
    ],

    pitfalls: [
      "Don't nest component object in component field — use string type name + separate props",
      "Don't JSON-stringify inputs_schema, a2ui_layout, or initial_data_model — pass them as structured JSON. Some agent frameworks (e.g. n8n) double-encode; if you control serialization, send real arrays/objects",
      "Don't set bind on display-only components (Text, Badge, Card, etc.)",
      "Don't include Button in your layout — it's rejected",
      "Don't include Form/ChoicePicker/InputField in approval layouts",
      "Don't include any input components in notification layouts",
      'Expiry is only valid on forms and approvals, not notifications',
      'Context is required for notifications, optional for forms/approvals',
      'Context MUST be brief plain text (1-2 sentences). No Markdown, no newlines. Rendered in card preview + surface header',
      'Put all detailed formatted content in a RichText component with markdown prop — NOT in context',
      "Never duplicate the same information in both context and RichText — context is the summary, RichText is the detail",
      'Notifications auto-complete on creation — task returns TASK_STATE_COMPLETED, no human response needed',
      'Notifications stay visible on dashboard until user dismisses (archives) them',
      'Severity controls accent colour and sort order: info (blue), success (green), warning (amber), error (red), critical (deep red)',
      "Card is the recommended root container — one per surface",
      "Use Row/Column for layout — don't try to position with CSS",
      'Every input component MUST have a bind that matches a property in inputs_schema',
      'A bind with no matching inputs_schema.properties key is rejected as UNRESOLVED_BIND — always declare every bound field in inputs_schema, including Signature and file/image inputs',
      "Every id listed in a children array must exist as its own top-level entry in a2ui_layout with that id. Don't put intermediate wrapper ids in children that aren't standalone entries — use parent on the child to establish the hierarchy, not nesting.",
      'ImageSelect items need bind to track selection — the selected item shows a primary border',
      'ProductGrid with bind makes ItemCards selectable — mode: "single" or "multiple" stores values comma-separated',
      'ChoicePicker with variant: "checkbox" is multi-select — values stored as comma-separated string in bind field',
      'Visibility rules use "visible" prop on any component — single condition, AND (all), or OR (any)',
      'For approvals: if "reason" is in inputs_schema, a reason field is auto-injected above approve/reject chips',
      'For approvals: action_validation.reject.required_fields: ["reason"] disables Reject until reason is filled',
      'Required fields: use inputs_schema.required array (e.g. "required": ["name", "email"]) — the asterisk * appears automatically. Never set "required" on component props.',
      'Callback URLs must be reachable from the Ido server — use a public URL or a tunnel (e.g. ngrok) for local development. The callback payload is JSON with task_id, surface_id, status, user_input, and submitted_at.',
    ],
  };

  if (mode === 'corporate') {
    guide.modeNotes = 'CORPORATE MODE: user_id (an email address) is REQUIRED on every surface. Surfaces without it are rejected. Domain restrictions may apply (IDO_CORP_ALLOWED_DOMAINS). Only the target user can see or act on their surfaces — surfaces are invisible to other users in the same organization.';
  } else {
    guide.modeNotes = 'user_id is optional. Omit it unless routing to a specific user.';
  }

  return guide;
}
