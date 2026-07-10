import { z } from 'zod';
import {
  A2UIComponentSchema,
  COMPONENT_PROP_SCHEMAS,
  COMPONENT_PERMISSIONS,
  type A2UIComponent,
} from './schema.js';
import type { SurfaceType } from '../types.js';

// ── Validation Error ────────────────────────────────────────

export class A2UIValidationError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'A2UIValidationError';
  }
}

// ── Validate a single component ─────────────────────────────

function validateComponent(
  component: A2UIComponent,
  surfaceType: SurfaceType,
): void {
  // Check component name is known
  const propSchema = COMPONENT_PROP_SCHEMAS[component.component];
  if (!propSchema) {
    throw new A2UIValidationError(
      `Unknown component type: "${component.component}"`,
      'UNKNOWN_COMPONENT',
      { componentId: component.id, component: component.component },
    );
  }

  // Check permissions
  const permissions = COMPONENT_PERMISSIONS[component.component];
  if (permissions && !permissions[surfaceType]) {
    throw new A2UIValidationError(
      `Component "${component.component}" is not allowed in ${surfaceType} surfaces`,
      'COMPONENT_NOT_ALLOWED',
      { componentId: component.id, component: component.component, surfaceType },
    );
  }

  // Validate props against schema
  if (component.props) {
    const result = propSchema.safeParse(component.props);
    if (!result.success) {
      throw new A2UIValidationError(
        `Invalid props for "${component.component}" (${component.id}): ${result.error.message}`,
        'INVALID_PROPS',
        { componentId: component.id, errors: result.error.flatten() },
      );
    }
  }

  // bind is only valid on input components
  const inputComponents = new Set([
    'InputField', 'TextField', 'Select', 'ChoicePicker', 'Checkbox',
    'DatePicker', 'Rating', 'Slider', 'FileInput', 'ImagePicker',
    'ImageSelect', 'Signature',
  ]);
  if (component.bind && !inputComponents.has(component.component)) {
    throw new A2UIValidationError(
      `"bind" is not valid on "${component.component}" (${component.id}). Only input components can have a bind.`,
      'BIND_ON_DISPLAY',
      { componentId: component.id, component: component.component },
    );
  }
}

// ── Validate full layout ────────────────────────────────────

export function validateLayout(
  layout: A2UIComponent[],
  surfaceType: SurfaceType,
): void {
  if (!layout || layout.length === 0) {
    return; // Empty layout is valid — components will be auto-generated
  }

  const idSet = new Set<string>();
  const bindSet = new Set<string>();

  for (const component of layout) {
    // Check for missing id
    if (!component.id) {
      throw new A2UIValidationError(
        'Layout entry missing required "id" field',
        'MISSING_ENTRY_ID',
      );
    }

    // Check for duplicate ids
    if (idSet.has(component.id)) {
      throw new A2UIValidationError(
        `Duplicate component id: "${component.id}"`,
        'DUPLICATE_ID',
        { componentId: component.id },
      );
    }
    idSet.add(component.id);

    // Check for duplicate binds
    if (component.bind) {
      if (bindSet.has(component.bind)) {
        throw new A2UIValidationError(
          `Duplicate bind value: "${component.bind}" on component ${component.id}`,
          'DUPLICATE_BIND',
          { bind: component.bind, componentId: component.id },
        );
      }
      bindSet.add(component.bind);
    }

    validateComponent(component, surfaceType);
  }

  // Check all parent references resolve
  for (const component of layout) {
    if (component.parent && !idSet.has(component.parent)) {
      throw new A2UIValidationError(
        `Component "${component.id}" references non-existent parent: "${component.parent}"`,
        'UNRESOLVED_PARENT',
        { componentId: component.id, parent: component.parent },
      );
    }
    if (component.children) {
      for (const childId of component.children) {
        if (!idSet.has(childId)) {
          throw new A2UIValidationError(
            `Component "${component.id}" references non-existent child: "${childId}"`,
            'UNRESOLVED_CHILD',
            { componentId: component.id, child: childId },
          );
        }
      }
    }
  }

  // Check for circular parent references
  for (const component of layout) {
    const visited = new Set<string>();
    let currentId: string | undefined = component.parent;
    while (currentId) {
      if (visited.has(currentId)) {
        throw new A2UIValidationError(
          `Circular parent reference detected involving component "${component.id}"`,
          'CIRCULAR_PARENT',
          { componentId: component.id },
        );
      }
      if (currentId === component.id) {
        throw new A2UIValidationError(
          `Component "${component.id}" cannot be its own parent`,
          'CIRCULAR_PARENT',
          { componentId: component.id },
        );
      }
      visited.add(currentId);
      const parentComponent = layout.find((c) => c.id === currentId);
      currentId = parentComponent?.parent;
    }
  }

  // Approval-specific: no input components beyond what server injects
  if (surfaceType === 'approval') {
    const approvalInputComponents = layout.filter(
      (c) => ['InputField', 'TextField', 'Select', 'ChoicePicker', 'Checkbox',
        'DatePicker', 'Rating', 'Slider', 'FileInput', 'ImagePicker',
        'ImageSelect', 'Signature', 'Form', 'Button'].includes(c.component),
    );
    if (approvalInputComponents.length > 0) {
      throw new A2UIValidationError(
        `Approval surfaces cannot contain input components. Found: ${approvalInputComponents.map(c => c.component).join(', ')}`,
        'APPROVAL_INPUT_NOT_ALLOWED',
        { components: approvalInputComponents.map(c => c.id) },
      );
    }
  }

  // Notification-specific: no input components
  if (surfaceType === 'notification') {
    const notificationInputComponents = layout.filter(
      (c) => ['Form', 'InputField', 'TextField', 'Select', 'ChoicePicker',
        'Checkbox', 'DatePicker', 'Rating', 'Slider', 'FileInput',
        'ImagePicker', 'ImageSelect', 'Signature', 'Button'].includes(c.component),
    );
    if (notificationInputComponents.length > 0) {
      throw new A2UIValidationError(
        `Notification surfaces cannot contain input components. Found: ${notificationInputComponents.map(c => c.component).join(', ')}`,
        'NOTIFICATION_INPUT_NOT_ALLOWED',
        { components: notificationInputComponents.map(c => c.id) },
      );
    }
  }
}

// ── Build component tree ────────────────────────────────────

export interface ComponentTreeNode {
  id: string;
  component: string;
  props: Record<string, unknown>;
  bind?: string;
  children: ComponentTreeNode[];
  visible?: unknown;
}

export function buildComponentTree(layout: A2UIComponent[]): ComponentTreeNode[] {
  const nodeMap = new Map<string, ComponentTreeNode>();
  const roots: ComponentTreeNode[] = [];

  // First pass: create all nodes
  for (const comp of layout) {
    nodeMap.set(comp.id, {
      id: comp.id,
      component: comp.component,
      props: (comp.props ?? {}) as Record<string, unknown>,
      bind: comp.bind,
      children: [],
      visible: comp.visible,
    });
  }

  // Second pass: wire up parent-child relationships
  for (const comp of layout) {
    const node = nodeMap.get(comp.id);
    if (!node) continue;

    // Process explicit children array
    if (comp.children) {
      for (const childId of comp.children) {
        const childNode = nodeMap.get(childId);
        if (childNode) {
          node.children.push(childNode);
        }
      }
    }

    // Process parent reference
    if (comp.parent) {
      const parentNode = nodeMap.get(comp.parent);
      if (parentNode && !parentNode.children.some((c) => c.id === comp.id)) {
        parentNode.children.push(node);
      }
    } else if (!hasParentInLayout(comp.id, layout)) {
      roots.push(node);
    }
  }

  return roots;
}

function hasParentInLayout(id: string, layout: A2UIComponent[]): boolean {
  return layout.some((c) => c.children?.includes(id));
}

// ── Auto-generate layout from inputs_schema ─────────────────

export function autoGenerateLayout(
  inputsSchema: Record<string, unknown> | undefined,
): A2UIComponent[] | null {
  if (!inputsSchema) return null;
  const schema = inputsSchema as Record<string, unknown>;
  const properties = (schema as Record<string, { properties?: Record<string, unknown> }>)?.properties;
  if (!properties || Object.keys(properties).length === 0) return null;

  const layout: A2UIComponent[] = [];
  layout.push({
    id: 'form-root',
    component: 'Form',
    props: { submitLabel: 'Submit' },
    children: [],
  });

  for (const [key, prop] of Object.entries(properties)) {
    const p = prop as Record<string, unknown>;
    const type = p.type as string | undefined;
    const label = (p.title as string) ?? key;
    const description = p.description as string | undefined;

    let componentId = `field-${key}`;
    let component: A2UIComponent;

    if (type === 'boolean') {
      component = {
        id: componentId,
        component: 'Checkbox',
        props: { label },
        bind: key,
        parent: 'form-root',
      };
    } else if (type === 'string' && (p.enum as string[] | undefined)) {
      const opts = (p.enum as string[]).map((v: string) => ({ label: v, value: v }));
      component = {
        id: componentId,
        component: 'Select',
        props: { label, options: opts },
        bind: key,
        parent: 'form-root',
      };
    } else if (type === 'number' || type === 'integer') {
      component = {
        id: componentId,
        component: 'InputField',
        props: { label, type: 'number', min: p.minimum as number, max: p.maximum as number },
        bind: key,
        parent: 'form-root',
      };
    } else {
      // Default to text input
      component = {
        id: componentId,
        component: 'InputField',
        props: { label, type: 'text', placeholder: description },
        bind: key,
        parent: 'form-root',
      };
    }

    layout.push(component);
    layout[0]!.children!.push(componentId);
  }

  return layout;
}
