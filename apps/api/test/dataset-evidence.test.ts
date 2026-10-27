import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Sha256 } from '@nexus/domain';
import { ctx, prismaMock, recordAuditMock, PROJECT_ID } from './prisma-mock.ts';

const access = vi.fn();
vi.mock('../src/datasets/files.ts', () => ({ assertDatasetFileAccess: access }));
vi.mock('@nexus/db', () => ({ prisma: prismaMock, recordAudit: recordAuditMock }));
const storage = {
  presignPut: vi.fn(() => 'https://example.invalid/put'),
  presignGet: vi.fn(() => 'https://example.invalid/get'),
  headBytes: vi.fn(),
  readHead: vi.fn(),
  remove: vi.fn(),
};
vi.mock('../src/files/storage.ts', () => ({ getStorage: () => storage }));
const { appRouter } = await import('../src/trpc/router.ts');
const { createCallerFactory } = await import('../src/trpc/trpc.ts');
const caller = createCallerFactory(appRouter);
const fileId = 'f'.repeat(24),
  collectionId = 'c'.repeat(24);
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const hash = new Sha256().update(bytes).hex();
const row = (over: Record<string, unknown> = {}) => ({
  id: fileId,
  projectId: PROJECT_ID,
  datasetCollectionId: collectionId,
  filename: 'synthetic.png',
  mime: 'image/png',
  kind: 'image',
  bytes: 8n,
  sha256: null,
  storageKey: 'synthetic-key',
  state: 'pending',
  failureCode: null,
  failureMessage: null,
  thumbKey: null,
  previewKey: null,
  pageCount: null,
  width: null,
  height: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});
beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue(undefined);
  prismaMock.project.findFirst.mockResolvedValue({ id: PROJECT_ID });
  prismaMock.file.findFirst.mockResolvedValue(row());
  storage.headBytes.mockResolvedValue(8);
  storage.readHead.mockResolvedValue(bytes);
  prismaMock.file.update.mockResolvedValue(row({ state: 'ready', sha256: hash }));
});
describe('dataset-owned object pipeline', () => {
  it('computes the checksum from the entire stored object before marking evidence ready', async () => {
    const result = await caller(ctx({ role: 'editor' })).files.complete({ fileId });
    expect(result.sha256).toBe(hash);
    expect(storage.readHead).toHaveBeenNthCalledWith(1, 'synthetic-key', 8, 0);
    expect(prismaMock.file.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'ready', sha256: hash }) }),
    );
    expect(access).toHaveBeenCalledWith(collectionId, PROJECT_ID, expect.anything(), true);
  });
  it('rejects a forged digest and removes the untrusted object', async () => {
    await expect(
      caller(ctx({ role: 'editor' })).files.complete({ fileId, sha256: '0'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(storage.remove).toHaveBeenCalledWith('synthetic-key');
    expect(prismaMock.file.update).toHaveBeenCalledWith({
      where: { id: fileId },
      data: expect.objectContaining({ state: 'failed', failureCode: 'FILE_HASH_MISMATCH' }),
    });
  });
  it('refuses a truncated object during chunk verification', async () => {
    storage.readHead.mockResolvedValue(new Uint8Array(1));
    await expect(caller(ctx({ role: 'editor' })).files.complete({ fileId })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(prismaMock.file.update).not.toHaveBeenCalled();
  });
  it('binds upload reservations and deduplication to a collection, with a bounded size', async () => {
    prismaMock.file.findFirst.mockResolvedValue(null);
    await caller(ctx({ role: 'editor' })).files.presign({
      projectId: PROJECT_ID,
      collectionId,
      filename: 'synthetic.png',
      declaredMime: 'image/png',
      bytes: 8,
      sha256: hash,
    });
    expect(prismaMock.file.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ datasetCollectionId: collectionId, projectId: PROJECT_ID }),
    });
    expect(prismaMock.file.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ datasetCollectionId: collectionId, projectId: PROJECT_ID }),
    });
    await expect(
      caller(ctx({ role: 'editor' })).files.presign({
        projectId: PROJECT_ID,
        collectionId,
        filename: 'synthetic.pdf',
        declaredMime: 'application/pdf',
        bytes: 101 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('uses attachment disposition and prevents deleting a file behind a live evidence reference', async () => {
    prismaMock.file.findFirst.mockResolvedValue(row({ state: 'ready' }));
    await caller(ctx({ role: 'viewer' })).files.download({ fileId });
    expect(storage.presignGet).toHaveBeenCalledWith(
      'synthetic-key',
      900,
      expect.objectContaining({ attachment: true }),
    );
    prismaMock.dataEntry.findFirst.mockResolvedValue({ id: 'evidence' });
    await expect(caller(ctx({ role: 'editor' })).files.delete({ fileId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
