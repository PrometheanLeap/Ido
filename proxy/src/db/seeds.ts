import type { Kysely } from 'kysely';
import type { DB } from './adapter.js';

// ── Built-in Surface Templates ──────────────────────────────
// Seeded on startup into the `surface_templates` table with
// `tenant_id = NULL` so they are available to all tenants.

interface BuiltInTemplate {
  id: string;
  name: string;
  description: string;
  surface_type: string;
  inputs_schema_json: string;
  a2ui_layout_json: string;
  created_by: string;
}

const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: 'standup',
    name: 'Daily Standup',
    description: 'Standard standup form',
    surface_type: 'form',
    inputs_schema_json: JSON.stringify({
      type: 'object',
      properties: {
        yesterday: { type: 'string', title: 'Yesterday' },
        today: { type: 'string', title: 'Today' },
        blockers: { type: 'string', title: 'Blockers' },
      },
      required: ['today'],
    }),
    a2ui_layout_json: JSON.stringify([
      { id: 'card', component: 'Card', props: { title: 'Daily Standup' }, children: ['form-root'] },
      { id: 'form-root', component: 'Form', props: { submitLabel: 'Submit' }, parent: 'card', children: ['yesterday', 'today', 'blockers'] },
      { id: 'yesterday', component: 'TextField', props: { label: 'Yesterday', rows: 3 }, bind: 'yesterday', parent: 'form-root' },
      { id: 'today', component: 'TextField', props: { label: 'Today', required: true, rows: 3 }, bind: 'today', parent: 'form-root' },
      { id: 'blockers', component: 'TextField', props: { label: 'Blockers', rows: 2 }, bind: 'blockers', parent: 'form-root' },
    ]),
    created_by: 'system',
  },
  {
    id: 'approval-simple',
    name: 'Simple Approval',
    description: 'Single-field approval',
    surface_type: 'approval',
    inputs_schema_json: JSON.stringify({
      type: 'object',
      properties: { reason: { type: 'string', title: 'Reason' } },
    }),
    a2ui_layout_json: JSON.stringify([
      { id: 'card', component: 'Card', props: { title: 'Approval Request' }, children: ['context'] },
      { id: 'context', component: 'RichText', props: { markdown: 'Context text' }, parent: 'card' },
    ]),
    created_by: 'system',
  },
  {
    id: 'status-report',
    name: 'Status Report',
    description: 'Status badge + rich text',
    surface_type: 'notification',
    inputs_schema_json: '{}',
    a2ui_layout_json: JSON.stringify([
      { id: 'card', component: 'Card', props: { title: 'Status Report' }, children: ['badge-row', 'body'] },
      { id: 'badge-row', component: 'Row', props: { gap: 8 }, parent: 'card', children: ['status-badge'] },
      { id: 'status-badge', component: 'Badge', props: { text: 'Healthy', color: '#10B981', variant: 'solid' }, parent: 'badge-row' },
      { id: 'body', component: 'RichText', props: { markdown: 'All systems operational.' }, parent: 'card' },
    ]),
    created_by: 'system',
  },
  {
    id: 'incident',
    name: 'Incident Report',
    description: 'Incident reporting form',
    surface_type: 'form',
    inputs_schema_json: JSON.stringify({
      type: 'object',
      properties: {
        severity: { type: 'string', title: 'Severity', enum: ['SEV1', 'SEV2', 'SEV3', 'SEV4'] },
        system: { type: 'string', title: 'System' },
        description: { type: 'string', title: 'Description' },
        steps: { type: 'string', title: 'Steps' },
      },
      required: ['severity', 'description'],
    }),
    a2ui_layout_json: JSON.stringify([
      { id: 'card', component: 'Card', props: { title: 'Incident Report' }, children: ['form-root'] },
      { id: 'form-root', component: 'Form', props: { submitLabel: 'Report' }, parent: 'card', children: ['fs', 'fsys', 'fd', 'fst'] },
      { id: 'fs', component: 'Select', props: { label: 'Severity', required: true, options: [{ label: 'SEV1', value: 'SEV1' }, { label: 'SEV2', value: 'SEV2' }, { label: 'SEV3', value: 'SEV3' }, { label: 'SEV4', value: 'SEV4' }] }, bind: 'severity', parent: 'form-root' },
      { id: 'fsys', component: 'InputField', props: { label: 'System', type: 'text' }, bind: 'system', parent: 'form-root' },
      { id: 'fd', component: 'TextField', props: { label: 'Description', required: true, rows: 4 }, bind: 'description', parent: 'form-root' },
      { id: 'fst', component: 'TextField', props: { label: 'Steps', rows: 4 }, bind: 'steps', parent: 'form-root' },
    ]),
    created_by: 'system',
  },
  {
    id: 'travel-request',
    name: 'Travel Request',
    description: 'Travel request form',
    surface_type: 'form',
    inputs_schema_json: JSON.stringify({
      type: 'object',
      properties: {
        destination: { type: 'string', title: 'Destination' },
        departure_date: { type: 'string', title: 'Departure' },
        return_date: { type: 'string', title: 'Return' },
        purpose: { type: 'string', title: 'Purpose' },
        budget: { type: 'number', title: 'Budget' },
      },
      required: ['destination', 'departure_date', 'purpose'],
    }),
    a2ui_layout_json: JSON.stringify([
      { id: 'card', component: 'Card', props: { title: 'Travel Request' }, children: ['form-root'] },
      { id: 'form-root', component: 'Form', props: { submitLabel: 'Submit' }, parent: 'card', children: ['dest', 'dep', 'ret', 'purp', 'budget'] },
      { id: 'dest', component: 'InputField', props: { label: 'Destination', required: true, type: 'text' }, bind: 'destination', parent: 'form-root' },
      { id: 'dep', component: 'DatePicker', props: { label: 'Departure Date', required: true }, bind: 'departure_date', parent: 'form-root' },
      { id: 'ret', component: 'DatePicker', props: { label: 'Return Date' }, bind: 'return_date', parent: 'form-root' },
      { id: 'purp', component: 'TextField', props: { label: 'Purpose', required: true, rows: 3 }, bind: 'purpose', parent: 'form-root' },
      { id: 'budget', component: 'InputField', props: { label: 'Budget (USD)', type: 'number', min: 0 }, bind: 'budget', parent: 'form-root' },
    ]),
    created_by: 'system',
  },
];

export async function seedTemplates(db: Kysely<DB>): Promise<void> {
  for (const template of BUILT_IN_TEMPLATES) {
    const existing = await db
      .selectFrom('surface_templates')
      .where('id', '=', template.id)
      .where('tenant_id', 'is', null)
      .selectAll()
      .executeTakeFirst();
    if (!existing) {
      await db
        .insertInto('surface_templates')
        .values({
          id: template.id,
          tenant_id: null,
          name: template.name,
          description: template.description,
          surface_type: template.surface_type,
          inputs_schema_json: template.inputs_schema_json,
          a2ui_layout_json: template.a2ui_layout_json,
          created_by: template.created_by,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .execute();
    }
  }
  console.log('Built-in templates seeded');
}
