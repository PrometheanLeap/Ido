import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ── Generate machine-readable JSON Schema from Zod prop schemas ──

export interface A2UISchemaEntry {
  props: Record<string, unknown>;
  bindable: boolean;
  allowedIn: string[];
}

export interface A2UISchemaDocument {
  $schema: string;
  title: string;
  description: string;
  version: string;
  components: Record<string, A2UISchemaEntry>;
}

export function getComponentJsonSchema(): A2UISchemaDocument {
  const components: Record<string, A2UISchemaEntry> = {};
  for (const [name, schema] of Object.entries(COMPONENT_PROP_SCHEMAS)) {
    const perm = COMPONENT_PERMISSIONS[name] || { form: false, approval: false, notification: false };
    components[name] = {
      props: zodToJsonSchema(schema, { target: 'jsonSchema7' }) as Record<string, unknown>,
      bindable: INPUT_COMPONENTS.has(name),
      allowedIn: Object.entries(perm).filter(([,v]) => v).map(([k]) => k),
    };
  }
  return {
    $schema: 'https://json-schema.org/draft-07/schema#',
    title: 'Ido A2UI Component Schema',
    description: 'Machine-readable component catalog for A2UI surfaces',
    version: '2.0.0',
    components,
  };
}

// ── Visibility Rules ────────────────────────────────────────

const VisibilityOperatorEnum = z.enum([
  'equals',
  'notEquals',
  'exists',
  'notExists',
  'greaterThan',
  'lessThan',
  'in',
]);

const SingleConditionSchema = z.object({
  when: z.string().min(1),
  operator: VisibilityOperatorEnum,
  value: z.unknown().optional(),
});

const VisibilityRuleSchema: z.ZodType<VisibilityRule> = z.lazy(() =>
  z.union([
    SingleConditionSchema,
    z.object({ all: z.array(VisibilityRuleSchema) }),
    z.object({ any: z.array(VisibilityRuleSchema) }),
  ])
);

type VisibilityRule = z.infer<typeof SingleConditionSchema> | {
  all: VisibilityRule[];
} | {
  any: VisibilityRule[];
};

// ── Base Component Schema ───────────────────────────────────

export const A2UIComponentSchema = z.object({
  id: z.string().min(1),
  component: z.string(),
  props: z.record(z.unknown()).optional(),
  bind: z.string().optional(),
  parent: z.string().optional(),
  children: z.array(z.string()).optional(),
  visible: VisibilityRuleSchema.optional(),
});

export type A2UIComponent = z.infer<typeof A2UIComponentSchema>;

// ── Layout Components ───────────────────────────────────────

export const CardPropsSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
});

export const ColumnPropsSchema = z.object({
  gap: z.number().min(0).max(48).optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
});

export const RowPropsSchema = z.object({
  gap: z.number().min(0).max(48).optional(),
  align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
  wrap: z.enum(['always', 'never', 'auto']).optional(),
  maxColumns: z.number().min(1).max(12).optional(),
});

export const AccordionPropsSchema = z.object({
  title: z.string().min(1),
  defaultOpen: z.boolean().optional(),
});

export const StepperPropsSchema = z.object({
  steps: z.array(z.object({
    label: z.string().min(1),
    description: z.string().optional(),
    completed: z.boolean().optional(),
  })),
  current: z.number().min(0),
});

// ── Input Components ────────────────────────────────────────

export const FormPropsSchema = z.object({
  submitLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
});

export const InputFieldPropsSchema = z.object({
  label: z.string().min(1),
  type: z.enum(['text', 'email', 'password', 'number', 'tel', 'url', 'date', 'time', 'datetime-local']).optional(),
  placeholder: z.string().optional(),
  multiline: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

export const TextFieldPropsSchema = z.object({
  label: z.string().min(1),
  placeholder: z.string().optional(),
  rows: z.number().min(1).max(20).optional(),
});

export const SelectPropsSchema = z.object({
  label: z.string().min(1),
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).min(1),
});

export const ChoicePickerPropsSchema = z.object({
  label: z.string().optional(),
  options: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })).min(1),
  variant: z.enum(['chips', 'checkbox']).optional(),
  displayStyle: z.enum(['inline', 'stacked']).optional(),
});

export const CheckboxPropsSchema = z.object({
  label: z.string().min(1),
});

export const DatePickerPropsSchema = z.object({
  label: z.string().min(1),
  min: z.string().optional(),
  max: z.string().optional(),
});

export const RatingPropsSchema = z.object({
  label: z.string().min(1),
  max: z.number().min(3).max(10).optional(),
});

export const SliderPropsSchema = z.object({
  label: z.string().min(1),
  min: z.number(),
  max: z.number(),
  step: z.number().optional(),
});

export const FileInputPropsSchema = z.object({
  label: z.string().min(1),
  accept: z.string().optional(),
  multiple: z.boolean().optional(),
});

export const ImagePickerPropsSchema = z.object({
  label: z.string().min(1),
  accept: z.string().optional(),
  multiple: z.boolean().optional(),
});

export const ImageSelectPropsSchema = z.object({
  items: z.array(z.object({
    src: z.string().url(),
    value: z.string(),
    label: z.string().optional(),
  })).min(1),
  mode: z.enum(['single', 'multiple']).optional(),
  columns: z.number().min(1).max(6).optional(),
});

export const SignaturePropsSchema = z.object({
  label: z.string().min(1),
});

// ── Display Components ──────────────────────────────────────

export const TextPropsSchema = z.object({
  text: z.string(),
  usageHint: z.enum(['heading', 'subheading', 'body', 'caption', 'label']).optional(),
});

export const RichTextPropsSchema = z.object({
  markdown: z.string().min(1),
});

export const BadgePropsSchema = z.object({
  text: z.string(),
  color: z.string().optional(),
  variant: z.enum(['solid', 'outline', 'subtle']).optional(),
});

export const ProgressBarPropsSchema = z.object({
  value: z.number().min(0).max(100),
  max: z.number().optional(),
  label: z.string().optional(),
  showValue: z.boolean().optional(),
  variant: z.enum(['default', 'success', 'warning', 'error']).optional(),
});

export const DividerPropsSchema = z.object({
  label: z.string().optional(),
});

export const ImagePropsSchema = z.object({
  src: z.string(),
  alt: z.string().optional(),
  fit: z.enum(['cover', 'contain', 'fill', 'none']).optional(),
  radius: z.enum(['none', 'sm', 'md', 'lg', 'full']).optional(),
});

export const LinkPropsSchema = z.object({
  text: z.string(),
  href: z.string(),
  target: z.enum(['_self', '_blank']).optional(),
});

// ── Data Components ─────────────────────────────────────────

export const TablePropsSchema = z.object({
  headers: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())),
  compact: z.boolean().optional(),
  striped: z.boolean().optional(),
});

export const DataGridPropsSchema = z.object({
  columns: z.array(z.object({
    key: z.string(),
    label: z.string(),
    editable: z.boolean().optional(),
  })).min(1),
  rows: z.array(z.record(z.unknown())),
  editable: z.boolean().optional(),
});

export const ChartDataPointSchema = z.object({
  label: z.string(),
  value: z.number(),
});

export const LineChartSeriesSchema = z.object({
  name: z.string(),
  data: z.array(ChartDataPointSchema).min(2),
});

export const BarChartPropsSchema = z.object({
  title: z.string().optional(),
  data: z.array(ChartDataPointSchema).min(1),
  height: z.number().min(100).max(800).optional(),
  colors: z.array(z.string()).optional(),
});

export const LineChartPropsSchema = z.object({
  title: z.string().optional(),
  data: z.array(ChartDataPointSchema).min(2).optional(),
  series: z.array(LineChartSeriesSchema).min(1).max(4).optional(),
  height: z.number().min(100).max(800).optional(),
  colors: z.array(z.string()).optional(),
});

export const PieChartPropsSchema = z.object({
  title: z.string().optional(),
  data: z.array(ChartDataPointSchema).min(1),
  height: z.number().min(100).max(800).optional(),
  colors: z.array(z.string()).optional(),
});

export const DonutChartPropsSchema = z.object({
  title: z.string().optional(),
  data: z.array(ChartDataPointSchema).min(1),
  colors: z.array(z.string()).optional(),
});

export const ItemCardPropsSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(),
  image: z.string().optional(),
  price: z.string().optional(),
  badge: z.string().optional(),
  value: z.string().optional(),
});

export const ProductGridPropsSchema = z.object({
  bind: z.string().optional(),
  mode: z.enum(['single', 'multiple']).optional(),
  columns: z.number().min(1).max(6).optional(),
});

export const MapPropsSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  zoom: z.number().min(1).max(20).optional(),
  marker: z.object({
    lat: z.number(),
    lng: z.number(),
    label: z.string().optional(),
  }).optional(),
});

// ── Component Prop Map ──────────────────────────────────────

export const COMPONENT_PROP_SCHEMAS: Record<string, z.ZodTypeAny> = {
  Card: CardPropsSchema,
  Column: ColumnPropsSchema,
  Row: RowPropsSchema,
  Accordion: AccordionPropsSchema,
  Stepper: StepperPropsSchema,
  Form: FormPropsSchema,
  InputField: InputFieldPropsSchema,
  TextField: TextFieldPropsSchema,
  Select: SelectPropsSchema,
  ChoicePicker: ChoicePickerPropsSchema,
  Checkbox: CheckboxPropsSchema,
  DatePicker: DatePickerPropsSchema,
  Rating: RatingPropsSchema,
  Slider: SliderPropsSchema,
  FileInput: FileInputPropsSchema,
  ImagePicker: ImagePickerPropsSchema,
  ImageSelect: ImageSelectPropsSchema,
  Signature: SignaturePropsSchema,
  Text: TextPropsSchema,
  RichText: RichTextPropsSchema,
  Badge: BadgePropsSchema,
  ProgressBar: ProgressBarPropsSchema,
  Divider: DividerPropsSchema,
  Image: ImagePropsSchema,
  Link: LinkPropsSchema,
  Table: TablePropsSchema,
  DataGrid: DataGridPropsSchema,
  BarChart: BarChartPropsSchema,
  LineChart: LineChartPropsSchema,
  PieChart: PieChartPropsSchema,
  DonutChart: DonutChartPropsSchema,
  ItemCard: ItemCardPropsSchema,
  ProductGrid: ProductGridPropsSchema,
  Map: MapPropsSchema,
};

// ── Valid Components ────────────────────────────────────────

export const VALID_COMPONENTS = Object.keys(COMPONENT_PROP_SCHEMAS) as [string, ...string[]];

// ── Component Permission Matrix ─────────────────────────────

const DISPLAY_COMPONENTS = new Set([
  'Card', 'Column', 'Row', 'Accordion', 'Stepper',
  'Text', 'RichText', 'Badge', 'ProgressBar', 'Divider',
  'Image', 'Link', 'Table', 'DataGrid',
  'BarChart', 'LineChart', 'PieChart', 'DonutChart',
  'ProductGrid', 'ItemCard', 'Map',
]);

const INPUT_COMPONENTS = new Set([
  'Form', 'InputField', 'TextField', 'Select', 'ChoicePicker',
  'Checkbox', 'DatePicker', 'Rating', 'Slider',
  'FileInput', 'ImagePicker', 'ImageSelect', 'Signature',
]);

const SERVER_OWNED = new Set(['Button']);

export const COMPONENT_PERMISSIONS: Record<string, { form: boolean; approval: boolean; notification: boolean }> = {};

for (const comp of VALID_COMPONENTS) {
  COMPONENT_PERMISSIONS[comp] = {
    form: DISPLAY_COMPONENTS.has(comp) || INPUT_COMPONENTS.has(comp),
    approval: DISPLAY_COMPONENTS.has(comp),
    notification: DISPLAY_COMPONENTS.has(comp),
  };
}
// Server-owned components: Form, ChoicePicker, etc. are server-owned in approval
COMPONENT_PERMISSIONS['Form'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['ChoicePicker'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['InputField'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['TextField'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['Select'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['Checkbox'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['DatePicker'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['Rating'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['Slider'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['FileInput'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['ImagePicker'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['ImageSelect'] = { form: true, approval: false, notification: false };
COMPONENT_PERMISSIONS['Signature'] = { form: true, approval: false, notification: false };

for (const comp of SERVER_OWNED) {
  COMPONENT_PERMISSIONS[comp] = { form: false, approval: false, notification: false };
}
