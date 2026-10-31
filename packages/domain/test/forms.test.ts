import { describe, expect, it } from 'vitest';
import {
  createDatasetCollection,
  createFormVersion,
  personFormFields,
  formFamilyId,
  formVersionId,
  formChanges,
  validateFormInputs,
  mapDatasetItem,
  prepareDatasetChanges,
  exportDatasetPage,
  importDatasetPage,
  MAX_FORM_VALUES,
  MAX_FORM_TEXT,
  type FormField,
} from '../src/index.ts';
import { collectionInput, datasetItem, DATASET_TIME as at } from './datasets.ts';

const collection = createDatasetCollection(
  collectionInput(),
  { workspaceId: 'local', orgId: null, projectId: 'project', boardId: null },
  'owner',
  at,
  'audit',
);
const form = (fields = personFormFields(), version = 1) =>
  createFormVersion({
    collection,
    familyId: 'person-form',
    version,
    name: 'Person',
    fields,
    now: at,
  });
const field = (type: FormField['type'], extra: Partial<FormField> = {}): FormField => ({
  id: 'value',
  label: 'Value',
  type,
  required: true,
  multiple: false,
  ...extra,
});

describe('published form versions', () => {
  it('creates scoped deterministic IDs and rejects forged versions and blank definitions', () => {
    const first = form();
    expect(first.id).toBe(formVersionId('person-form', 1));
    expect(formFamilyId(first)).toBe('person-form');
    expect(() => mapDatasetItem({ ...first, id: 'forged' })).toThrow(/family and version/);
    expect(() => mapDatasetItem({ ...first, familyId: 7 })).toThrow(/metadata/);
    expect(() => form([])).toThrow(/at least one/);
    expect(() => form([field('text', { label: ' ' })])).toThrow(/named field/);
    expect(() => form([field('text'), field('number')])).toThrow(/unique/);
    expect(() => formVersionId('bad family', 1)).toThrow();
    expect(() => formVersionId('valid', 0)).toThrow();
  });

  it('keeps published content immutable and creates a separate version with stable field IDs', () => {
    const first = form();
    const existing = new Map([[first.id, first]]);
    expect(() =>
      prepareDatasetChanges(
        collection,
        1,
        [{ op: 'put', item: { ...first, name: 'Overwritten' } }],
        existing,
        at,
        'next',
      ),
    ).toThrow(/immutable/);
    const fields = first.fields.map((item) =>
      item.id === 'full_name' ? { ...item, label: 'Legal name' } : item,
    );
    const second = createFormVersion({
      collection,
      familyId: formFamilyId(first),
      version: 2,
      name: 'Person',
      fields,
      now: at,
      previous: first,
    });
    expect(second.id).not.toBe(first.id);
    expect(second.fields.map((item) => item.id)).toEqual(first.fields.map((item) => item.id));
    const changed = prepareDatasetChanges(
      collection,
      1,
      [{ op: 'put', item: second }],
      existing,
      at,
      'next',
    );
    expect(changed).toHaveLength(1);
    expect(first.fields[0]!.label).toBe('Full name');
    expect(formChanges(first, fields)).toEqual(['Rename Full name to Legal name']);
  });

  it('retains legacy and extension fields without reinterpreting unknown metadata', () => {
    const legacy = datasetItem({
      id: 'legacy',
      kind: 'form_template',
      name: 'Legacy',
      version: 3,
      familyId: 42,
      fields: [field('text', { futureField: { unit: 'custom' } })],
      futureTemplate: { policy: 'retain' },
    });
    expect(legacy.kind).toBe('form_template');
    if (legacy.kind !== 'form_template') throw new Error('Fixture');
    const family = formFamilyId(legacy);
    expect(family).toMatch(/^legacy_[a-f0-9]{32}$/);
    expect(formFamilyId(legacy)).toBe(family);
    const copy = createFormVersion({
      collection,
      familyId: family,
      version: 4,
      name: legacy.name,
      fields: legacy.fields,
      now: at,
      previous: legacy,
    });
    expect(copy.futureTemplate).toEqual(legacy.futureTemplate);
    expect(copy.fields[0]!.futureField).toEqual(legacy.fields[0]!.futureField);
    const page = {
      format: 'raven.dataset.page.v1' as const,
      collection,
      items: [legacy, copy],
      nextCursor: null,
    };
    expect(importDatasetPage(exportDatasetPage(page))).toEqual(page);
    expect(legacy.familyId).toBe(42);
    expect(() => formFamilyId({ ...legacy, templateFormat: 'raven.form.v2' })).toThrow(
      /newer Raven/,
    );
  });

  it('previews type, cardinality, required, multiline, added, removed and reordered fields', () => {
    const before = form([
      field('text'),
      field('text', { id: 'remove', label: 'Old' }),
      field('text', { id: 'last', label: 'Last' }),
    ]);
    const after = [
      before.fields[2]!,
      {
        ...before.fields[0]!,
        type: 'email' as const,
        multiple: true,
        required: false,
        multiline: true,
      },
      field('url', { id: 'new', label: 'New' }),
    ];
    const changes = formChanges(before, after);
    expect(changes).toEqual(
      expect.arrayContaining([
        'Change Value from text to email',
        'Value becomes optional',
        'Value accepts multiple values',
        'Value uses multiple lines',
        'Remove Old from the new version',
        'Add New',
        'Update field order',
      ]),
    );
    expect(formChanges(before, before.fields)).toEqual([]);
  });
});

describe('typed form inputs', () => {
  it('keeps zero and false, while empty inputs remain missing', () => {
    const definition = form([field('number'), field('boolean', { id: 'flag', label: 'Flag' })]);
    expect(
      validateFormInputs(
        definition,
        new Map([
          ['value', [0]],
          ['flag', [false]],
        ]),
      ).values.map((value) => value.normalizedValue),
    ).toEqual([0, false]);
    expect(validateFormInputs(definition, new Map()).issues).toHaveLength(2);
    expect(
      validateFormInputs(
        form([field('text', { required: false })]),
        new Map([['value', [' ', null, undefined]]]),
      ).issues,
    ).toEqual([]);
  });

  it.each([
    ['text', '  Original text  ', '  Original text  '],
    ['number', '1.25e2', 125],
    ['boolean', 'FALSE', false],
    ['date', '2024-02-29', '2024-02-29'],
    ['email', 'Mira@EXAMPLE.TEST', 'Mira@example.test'],
    ['phone', '+1 (202) 555-0100', '+12025550100'],
    ['phone', '00123', '00123'],
    ['phone', '123 ext. 5', '123 ext. 5'],
    ['url', 'https://example.test', 'https://example.test/'],
  ] as const)('validates %s without replacing its raw value', (type, raw, normalized) => {
    const result = validateFormInputs(form([field(type)]), new Map([['value', [raw]]]));
    expect(result.issues).toEqual([]);
    expect(result.values[0]).toMatchObject({ rawValue: raw, normalizedValue: normalized });
  });

  it.each([
    ['text', {}],
    ['text', 'x'.repeat(MAX_FORM_TEXT + 1)],
    ['number', '0x10'],
    ['number', Infinity],
    ['number', 'not-a-number'],
    ['boolean', 1],
    ['date', '2023-02-29'],
    ['date', 'not-a-date'],
    ['email', 'not-an-email'],
    ['phone', 'not-a-phone'],
    ['phone', '+++'],
    ['url', 'javascript:alert(1)'],
    ['url', 'https://user:pass@example.test'],
  ] as const)('reports malformed %s values at their field', (type, raw) => {
    const result = validateFormInputs(form([field(type)]), new Map([['value', [raw]]]));
    expect(result.issues).toMatchObject([{ fieldId: 'value', index: 0 }]);
    expect(result.values).toEqual([]);
  });

  it('bounds multiplicity and uses a map for field IDs such as constructor', () => {
    expect(
      validateFormInputs(form([field('text')]), new Map([['value', ['one', 'two']]])).issues[0]
        ?.message,
    ).toMatch(/one value/);
    expect(
      validateFormInputs(
        form([field('text', { multiple: true })]),
        new Map([['value', Array.from({ length: MAX_FORM_VALUES + 1 }, () => 'x')]]),
      ).issues[0]?.message,
    ).toMatch(/at most/);
    const safe = validateFormInputs(
      form([field('text', { id: 'constructor' })]),
      new Map([['constructor', ['Safe']]]),
    );
    expect(safe.values[0]?.normalizedValue).toBe('Safe');
  });
});
