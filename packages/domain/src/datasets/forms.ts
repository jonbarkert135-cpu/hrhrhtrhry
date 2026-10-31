/** Form publications and typed previews are independent of board templates and canvas nodes. */
import { z } from 'zod';
import { Sha256 } from '../files/sha256.ts';
import {
  FORM_TEMPLATE_FORMAT,
  FormVersionMetadataSchema,
  mapDatasetItem,
  type DataCollection,
  type FormTemplate,
} from './model.ts';

export type FormField = FormTemplate['fields'][number];
export const MAX_FORM_VALUES = 16;
export const MAX_FORM_TEXT = 4000;
export const FORM_FIELD_TYPES = [
  'text',
  'number',
  'boolean',
  'date',
  'email',
  'phone',
  'url',
] as const;

export function formFamilyId(template: FormTemplate): string {
  if (
    typeof template.templateFormat === 'string' &&
    template.templateFormat.startsWith('raven.form.') &&
    template.templateFormat !== FORM_TEMPLATE_FORMAT
  )
    throw new Error('This form format needs a newer Raven version');
  if (template.templateFormat === FORM_TEMPLATE_FORMAT)
    return FormVersionMetadataSchema.parse(template).familyId;
  return `legacy_${new Sha256().update(new TextEncoder().encode(template.id)).hex().slice(0, 32)}`;
}

export function formVersionId(familyId: string, version: number): string {
  const metadata = FormVersionMetadataSchema.parse({
    templateFormat: FORM_TEMPLATE_FORMAT,
    familyId,
  });
  z.number().int().positive().parse(version);
  return `${metadata.familyId}_v${String(version)}`;
}

export function createFormVersion(input: {
  collection: DataCollection;
  familyId: string;
  version: number;
  name: string;
  fields: readonly FormField[];
  now: string;
  previous?: FormTemplate;
}): FormTemplate {
  return mapDatasetItem({
    ...(input.previous ?? {}),
    kind: 'form_template',
    id: formVersionId(input.familyId, input.version),
    collectionId: input.collection.id,
    revision: 1,
    auditRef: input.collection.auditRef,
    createdAt: input.now,
    updatedAt: input.now,
    deletedAt: null,
    templateFormat: FORM_TEMPLATE_FORMAT,
    familyId: input.familyId,
    version: input.version,
    name: input.name.trim(),
    fields: input.fields.map((field) => ({ ...field, label: field.label.trim() })),
  }) as FormTemplate;
}

/** Stable field IDs mean a label change never reassigns an existing person's assertions. */
export function personFormFields(): FormField[] {
  return [
    { id: 'full_name', label: 'Full name', type: 'text', required: true, multiple: false },
    { id: 'addresses', label: 'Address', type: 'text', required: false, multiple: true },
    { id: 'phones', label: 'Phone', type: 'phone', required: false, multiple: true },
    { id: 'emails', label: 'Email', type: 'email', required: false, multiple: true },
    { id: 'profiles', label: 'Profile', type: 'url', required: false, multiple: true },
    {
      id: 'notes',
      label: 'Notes',
      type: 'text',
      required: false,
      multiple: false,
      multiline: true,
    },
    { id: 'tags', label: 'Tag', type: 'text', required: false, multiple: true },
    {
      id: 'observed_date',
      label: 'Observation date',
      type: 'date',
      required: false,
      multiple: false,
    },
  ];
}

export interface FormIssue {
  fieldId: string;
  index: number | null;
  message: string;
}
export interface ValidatedFormValue {
  fieldId: string;
  index: number;
  rawValue: unknown;
  normalizedValue: string | number | boolean;
}
export interface FormValidation {
  issues: FormIssue[];
  values: ValidatedFormValue[];
}

const blank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const email = z.string().max(320).email();
const webUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value));

function normalizeValue(field: FormField, raw: unknown): string | number | boolean | null {
  if (typeof raw === 'string' && raw.length > MAX_FORM_TEXT) return null;
  if (field.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'string' && /^(true|false)$/i.test(raw)) return raw.toLowerCase() === 'true';
    return null;
  }
  if (field.type === 'number') {
    if (typeof raw !== 'number' && typeof raw !== 'string') return null;
    if (
      typeof raw === 'string' &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())
    )
      return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  if (typeof raw !== 'string' || raw.length > MAX_FORM_TEXT) return null;
  const value = raw.trim();
  switch (field.type) {
    case 'text':
      return raw;
    case 'email': {
      if (!email.safeParse(value).success) return null;
      const separator = value.lastIndexOf('@');
      return `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
    }
    case 'url': {
      if (!webUrl.safeParse(value).success) return null;
      const parsed = new URL(value);
      return parsed.username || parsed.password ? null : parsed.href;
    }
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
        ? value
        : null;
    }
    case 'phone': {
      if (
        value.length > 128 ||
        !/\d/.test(value) ||
        !/^[+()0-9 .-]+(?: *(?:ext\.?|x|#) *[0-9]+)?$/i.test(value)
      )
        return null;
      const compact = value.replace(/[(). -]/g, '');
      // Do not guess a country, remove a local leading zero, or infer ownership.
      return /^\+[1-9]\d{6,14}$/.test(compact) ? compact : value;
    }
  }
}

const VALUE_ERRORS: Record<FormField['type'], string> = {
  text: `Enter text with at most ${String(MAX_FORM_TEXT)} characters`,
  number: 'Enter a finite number',
  boolean: 'Choose Yes or No',
  date: 'Enter a valid calendar date',
  email: 'Enter an email address',
  phone: 'Enter a phone value with digits and optional punctuation or an extension',
  url: 'Enter an HTTP(S) link without embedded credentials',
};

/** Maps avoid interpreting arbitrary field IDs as JavaScript object properties. */
export function validateFormInputs(
  template: { fields: readonly FormField[] },
  input: ReadonlyMap<string, readonly unknown[]>,
): FormValidation {
  const issues: FormIssue[] = [];
  const values: ValidatedFormValue[] = [];
  for (const field of template.fields) {
    const supplied = input.get(field.id) ?? [];
    if (supplied.length > MAX_FORM_VALUES) {
      issues.push({
        fieldId: field.id,
        index: null,
        message: `Use at most ${String(MAX_FORM_VALUES)} values`,
      });
      continue;
    }
    const entered = supplied
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => !blank(value));
    if (field.required && entered.length === 0)
      issues.push({ fieldId: field.id, index: null, message: `${field.label} is required` });
    if ((!field.multiple && entered.length > 1) || entered.length > MAX_FORM_VALUES) {
      issues.push({
        fieldId: field.id,
        index: null,
        message: field.multiple
          ? `Use at most ${String(MAX_FORM_VALUES)} values`
          : 'Use one value for this field',
      });
      continue;
    }
    for (const { value, index } of entered) {
      const normalizedValue = normalizeValue(field, value);
      if (normalizedValue === null)
        issues.push({ fieldId: field.id, index, message: VALUE_ERRORS[field.type] });
      else values.push({ fieldId: field.id, index, rawValue: value, normalizedValue });
    }
  }
  return { issues, values };
}

export function formChanges(previous: FormTemplate, fields: readonly FormField[]): string[] {
  const changes: string[] = [];
  const before = new Map(previous.fields.map((field) => [field.id, field]));
  const after = new Map(fields.map((field) => [field.id, field]));
  for (const old of previous.fields) {
    const next = after.get(old.id);
    if (!next) changes.push(`Remove ${old.label} from the new version`);
    else {
      if (old.label !== next.label) changes.push(`Rename ${old.label} to ${next.label}`);
      if (old.type !== next.type)
        changes.push(`Change ${next.label} from ${old.type} to ${next.type}`);
      if (old.required !== next.required)
        changes.push(`${next.label} becomes ${next.required ? 'required' : 'optional'}`);
      if ((old.multiline === true) !== (next.multiline === true))
        changes.push(
          `${next.label} uses ${next.multiline === true ? 'multiple lines' : 'one line'}`,
        );
      if (old.multiple !== next.multiple)
        changes.push(`${next.label} accepts ${next.multiple ? 'multiple values' : 'one value'}`);
    }
  }
  for (const field of fields) if (!before.has(field.id)) changes.push(`Add ${field.label}`);
  if (
    previous.fields
      .filter((field) => after.has(field.id))
      .map((field) => field.id)
      .join(',') !==
    fields
      .filter((field) => before.has(field.id))
      .map((field) => field.id)
      .join(',')
  )
    changes.push('Update field order');
  return changes;
}
