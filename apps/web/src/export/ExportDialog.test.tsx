import { createBoardDoc, exportBoard, parseBoardExport } from '@nexus/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from './ExportDialog';
const NOW = '2026-10-30T12:00:00.000Z';
let payload: Blob | undefined;
let filename = '';
beforeEach(() => {
  payload = undefined;
  filename = '';
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = vi.fn((blob: Blob | MediaSource) => {
        if (blob instanceof Blob) payload = blob;
        return 'blob:training';
      });
      static override revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filename = this.download;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function archive() {
  const doc = createBoardDoc({ boardId: 'b_export', title: 'Training board', now: NOW });
  return exportBoard(doc, { appVersion: '1', now: NOW });
}
function fileText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error(reader.error?.message ?? 'Cannot read download'));
    reader.readAsText(blob);
  });
}
describe('export outcomes', () => {
  it('downloads a real board archive and closes only after success', async () => {
    const close = vi.fn();
    render(<ExportDialog open onOpenChange={close} buildArchive={archive} />);
    fireEvent.click(screen.getByTestId('export-run'));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(filename).toBe('Training board.raven.json');
    expect(payload).toBeInstanceOf(Blob);
    const decoded: unknown = JSON.parse(await fileText(payload!));
    expect(parseBoardExport(decoded).data.board.title).toBe('Training board');
  });
  it('keeps the dialog open if no canvas can be encoded, and reports build failures', async () => {
    const close = vi.fn();
    const build = vi.fn(archive);
    render(<ExportDialog open onOpenChange={close} buildArchive={build} />);
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'png' } });
    fireEvent.click(screen.getByTestId('export-run'));
    await screen.findByText('The canvas image is not available on this device');
    expect(close).not.toHaveBeenCalled();
    expect(payload).toBeUndefined();
    build.mockImplementationOnce(() => {
      throw new Error('Archive could not be read');
    });
    fireEvent.click(screen.getByTestId('export-run'));
    await screen.findByText('Archive could not be read');
    expect(close).not.toHaveBeenCalled();
  });
  it('includes the written summary in the generated report', async () => {
    const close = vi.fn();
    render(<ExportDialog open onOpenChange={close} buildArchive={archive} />);
    fireEvent.change(screen.getByTestId('export-format'), { target: { value: 'report' } });
    fireEvent.change(screen.getByTestId('export-summary'), {
      target: { value: 'Fictional training summary' },
    });
    fireEvent.click(screen.getByTestId('export-run'));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(filename).toBe('Training board.report.html');
    expect(await fileText(payload!)).toContain('Fictional training summary');
  });
});
