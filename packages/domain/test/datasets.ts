import { mapDatasetItem, type DatasetItem, type CreateCollection } from '../src/datasets/index.ts';
export const DATASET_TIME = '2026-10-26T00:00:00.000Z';
export const collectionInput = (id = 'collection'): CreateCollection => ({
  id,
  name: 'Fictional research',
  description: 'Synthetic data only',
  visibility: 'private',
  label: 'restricted',
  retentionDays: 30,
});
export function datasetItem(
  data: { id: string; kind: DatasetItem['kind']; [key: string]: unknown },
  collectionId = 'collection',
): DatasetItem {
  return mapDatasetItem({
    collectionId,
    revision: 1,
    auditRef: 'initial',
    createdAt: DATASET_TIME,
    updatedAt: DATASET_TIME,
    deletedAt: null,
    ...data,
  });
}
export function datasetFixture(collectionId = 'collection'): DatasetItem[] {
  return [
    datasetItem(
      { id: 'version', kind: 'version', number: 1, description: 'Initial', sealedAt: null },
      collectionId,
    ),
    datasetItem(
      {
        id: 'source',
        kind: 'source',
        name: 'Manual fictional note',
        origin: 'manual_note',
        author: { id: 'fictional-author', name: 'Example Analyst' },
        observedAt: DATASET_TIME,
        importedAt: DATASET_TIME,
        url: 'https://example.invalid/source',
        fileHash: null,
        license: 'Synthetic fixture',
        lawfulBasis: 'Fictional test data, no real person',
        restriction: 'Do not send externally',
        externalUseAllowed: false,
      },
      collectionId,
    ),
    datasetItem(
      {
        id: 'record',
        kind: 'record',
        versionId: 'version',
        templateId: null,
        title: 'Example Person (fictional)',
        rowIndex: 0,
      },
      collectionId,
    ),
    datasetItem(
      {
        id: 'assertion',
        kind: 'assertion',
        recordId: 'record',
        sourceId: 'source',
        evidenceId: null,
        fieldId: 'name',
        value: 'Example Person',
        normalizedValue: 'Example Person',
        assertionType: 'claimed',
        observedAt: DATASET_TIME,
        rowIndex: 0,
        assessment: {
          confidence: null,
          assessedBy: null,
          assessedAt: null,
          rationale: 'Not an identity determination',
        },
      },
      collectionId,
    ),
  ];
}
