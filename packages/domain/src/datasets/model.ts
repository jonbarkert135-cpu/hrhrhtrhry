/** Collections are independent documents, never additional board/Y.Doc roots. */
import { z } from 'zod';

export const DatasetIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const time = z.string().datetime();
const nullableTime = time.nullable();
const text = z.string().max(4000);
const url = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//i.test(v), 'Expected an HTTP(S) URL');
export const DatasetScopeSchema = z
  .object({
    workspaceId: DatasetIdSchema,
    orgId: DatasetIdSchema.nullable(),
    projectId: DatasetIdSchema,
    boardId: DatasetIdSchema.nullable(),
  })
  .passthrough();
export type DatasetScope = z.infer<typeof DatasetScopeSchema>;
export const DataCollectionSchema = z
  .object({
    format: z.literal('raven.dataset.v1'),
    id: DatasetIdSchema,
    scope: DatasetScopeSchema,
    ownerId: DatasetIdSchema,
    name: z.string().trim().min(1).max(200),
    description: text,
    visibility: z.enum(['private', 'project', 'organization']),
    label: z.enum(['public', 'internal', 'restricted']),
    retentionDays: z.number().int().min(1).max(3650),
    revision: z.number().int().min(1),
    auditRef: DatasetIdSchema,
    createdAt: time,
    updatedAt: time,
    deletedAt: nullableTime,
    purgeAfter: nullableTime,
  })
  .passthrough();
export type DataCollection = z.infer<typeof DataCollectionSchema>;

const base = z
  .object({
    id: DatasetIdSchema,
    collectionId: DatasetIdSchema,
    revision: z.number().int().min(1),
    auditRef: DatasetIdSchema,
    createdAt: time,
    updatedAt: time,
    deletedAt: nullableTime,
  })
  .passthrough();
export const DatasetVersionSchema = base.extend({
  kind: z.literal('version'),
  number: z.number().int().positive(),
  description: text,
  sealedAt: nullableTime,
});
export const DatasetSourceSchema = base.extend({
  kind: z.literal('source'),
  name: z.string().trim().min(1).max(200),
  origin: z.enum(['user_upload', 'authorized_api', 'manual_note', 'public_document']),
  author: z.object({ id: z.string().max(300), name: z.string().max(300) }).passthrough(),
  observedAt: nullableTime,
  importedAt: time,
  url: url.nullable(),
  fileHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  license: z.string().min(1).max(500),
  lawfulBasis: z.string().min(1).max(1000),
  restriction: z.string().max(1000),
  externalUseAllowed: z.boolean(),
});
export const CollectionRecordSchema = base.extend({
  kind: z.literal('record'),
  versionId: DatasetIdSchema,
  templateId: DatasetIdSchema.nullable(),
  title: z.string().max(300),
  rowIndex: z.number().int().nonnegative().nullable(),
});
export const AssessmentSchema = z
  .object({
    confidence: z.number().min(0).max(1).nullable(),
    assessedBy: DatasetIdSchema.nullable(),
    assessedAt: nullableTime,
    rationale: text,
  })
  .passthrough();
export const RecordAssertionSchema = base.extend({
  kind: z.literal('assertion'),
  recordId: DatasetIdSchema,
  sourceId: DatasetIdSchema,
  evidenceId: DatasetIdSchema.nullable(),
  fieldId: DatasetIdSchema,
  value: z.unknown(),
  normalizedValue: z.unknown(),
  assertionType: z.enum(['observed', 'claimed', 'inferred']),
  observedAt: nullableTime,
  rowIndex: z.number().int().nonnegative().nullable(),
  assessment: AssessmentSchema,
});
export const DatasetEvidenceSchema = base.extend({
  kind: z.literal('evidence'),
  sourceId: DatasetIdSchema,
  fileId: DatasetIdSchema,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(200),
});
export const RecordEntityLinkSchema = base.extend({
  kind: z.literal('entity_link'),
  recordId: DatasetIdSchema,
  boardId: DatasetIdSchema,
  nodeId: DatasetIdSchema,
  decision: z.enum(['proposed', 'confirmed', 'rejected']),
  assessment: AssessmentSchema,
});
export const RecordRelationSchema = base.extend({
  kind: z.literal('relation'),
  recordId: DatasetIdSchema,
  targetRecordId: DatasetIdSchema,
  sourceId: DatasetIdSchema,
  predicate: z.string().min(1).max(200),
  assertionType: z.enum(['observed', 'claimed', 'inferred']),
  assessment: AssessmentSchema,
});
export const DatasetSavedViewSchema = base.extend({
  kind: z.literal('saved_view'),
  name: z.string().min(1).max(200),
  filters: z
    .array(
      z
        .object({
          fieldId: DatasetIdSchema,
          operator: z.enum(['eq', 'contains']),
          value: z.unknown(),
        })
        .passthrough(),
    )
    .max(32),
  columns: z.array(DatasetIdSchema).max(128),
});
export const FormTemplateSchema = base.extend({
  kind: z.literal('form_template'),
  name: z.string().min(1).max(200),
  version: z.number().int().positive(),
  fields: z
    .array(
      z
        .object({
          id: DatasetIdSchema,
          label: z.string().min(1).max(200),
          type: z.enum(['text', 'number', 'boolean', 'date', 'email', 'phone', 'url']),
          required: z.boolean(),
          multiple: z.boolean(),
        })
        .passthrough(),
    )
    .max(128),
});
export const DatasetMemberSchema = base.extend({
  kind: z.literal('member'),
  userId: DatasetIdSchema,
  role: z.enum(['viewer', 'editor']),
});
export const DatasetItemSchema = z.discriminatedUnion('kind', [
  DatasetVersionSchema,
  DatasetSourceSchema,
  CollectionRecordSchema,
  RecordAssertionSchema,
  DatasetEvidenceSchema,
  RecordEntityLinkSchema,
  RecordRelationSchema,
  DatasetSavedViewSchema,
  FormTemplateSchema,
  DatasetMemberSchema,
]);
export type DatasetItem = z.infer<typeof DatasetItemSchema>;
export type DatasetItemKind = DatasetItem['kind'];
export type DatasetVersion = z.infer<typeof DatasetVersionSchema>;
export type DatasetSource = z.infer<typeof DatasetSourceSchema>;
export type CollectionRecord = z.infer<typeof CollectionRecordSchema>;
export type RecordAssertion = z.infer<typeof RecordAssertionSchema>;
export type DatasetEvidence = z.infer<typeof DatasetEvidenceSchema>;
export type RecordEntityLink = z.infer<typeof RecordEntityLinkSchema>;
export type RecordRelation = z.infer<typeof RecordRelationSchema>;
export type DatasetSavedView = z.infer<typeof DatasetSavedViewSchema>;
export type FormTemplate = z.infer<typeof FormTemplateSchema>;

/** Shared storage/wire mapper. JSON-only data and extension fields are preserved. */
export function datasetJson(value: unknown, maxBytes = 1024 * 1024): unknown {
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (depth > 32) throw new Error('Dataset JSON exceeds the nesting limit');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || seen.has(v)) throw new Error('Expected acyclic JSON data');
    if (
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw new Error('Expected plain JSON data');
    seen.add(v);
    for (const [key, child] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key))
        throw new Error('Unsafe JSON property');
      visit(child, depth + 1);
    }
    seen.delete(v);
  };
  visit(value, 0);
  if (JSON.stringify(value).length > maxBytes) throw new Error('Dataset item exceeds 1 MiB');
  return value;
}
export function mapDatasetItem(value: unknown): DatasetItem {
  datasetJson(value);
  return DatasetItemSchema.parse(value);
}
export const DatasetPageSchema = z
  .object({
    format: z.literal('raven.dataset.page.v1'),
    collection: DataCollectionSchema,
    items: z.array(DatasetItemSchema).max(200),
    nextCursor: DatasetIdSchema.nullable(),
  })
  .passthrough();
export function importDatasetPage(text: string): z.infer<typeof DatasetPageSchema> {
  if (text.length > 16 * 1024 * 1024) throw new Error('Dataset page exceeds 16 MiB');
  const parsed: unknown = JSON.parse(text);
  datasetJson(parsed, 16 * 1024 * 1024);
  // Check items independently: a page may contain many individually bounded records.
  const page = DatasetPageSchema.parse(parsed);
  for (const item of page.items) datasetJson(item);
  return page;
}
export function exportDatasetPage(page: z.infer<typeof DatasetPageSchema>): string {
  return JSON.stringify(importDatasetPage(JSON.stringify(page)));
}
