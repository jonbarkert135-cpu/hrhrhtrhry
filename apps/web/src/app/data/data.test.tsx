import { useState } from 'react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { IDBFactory } from 'fake-indexeddb';
import {
  createFormVersion,
  personFormFields,
  DatasetError,
  type DataCollection,
  type FormField,
} from '@nexus/domain';
import { createLocalWorkspaceRepository } from '../../data/workspace/local';
import { createLocalDatasetRepository } from '../../data/datasets/local';
import DataPage from './DataPage';
import { CollectionForms } from './CollectionForms';
import { TemplateEditor } from './TemplateEditor';
import { FormPreview } from './FormPreview';

let projectId: string;
let repository: ReturnType<typeof createLocalDatasetRepository>;
let collection: DataCollection;
let client: QueryClient;
const at = '2026-10-31T00:00:00.000Z';
const fail = () => {
  throw new Error('Offline forms must not use any transport');
};
function wrapper(element: React.ReactNode, path = `/p/${projectId}/data`) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/p/:projectId/data/:collectionId?" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const definition = (version = 1, fields = personFormFields()) =>
  createFormVersion({ collection, familyId: 'person', version, name: 'Person', fields, now: at });
const enter = async (label: string, value: string) => {
  const control = screen.getByLabelText(label, { exact: true });
  await userEvent.clear(control);
  await userEvent.type(control, value);
};
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('fetch', fail);
  vi.stubGlobal('XMLHttpRequest', fail);
  vi.stubGlobal('WebSocket', fail);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  projectId = (await createLocalWorkspaceRepository().createProject({ name: 'Synthetic research' }))
    .id;
  repository = createLocalDatasetRepository({
    actorId: 'local-owner',
    scope: { workspaceId: 'local', orgId: null, projectId, boardId: null },
  });
  collection = await repository.createCollection({
    id: 'collection',
    name: 'Synthetic collection',
    description: '',
    visibility: 'private',
    label: 'restricted',
    retentionDays: 30,
  });
});
afterEach(async () => {
  cleanup();
  client.clear();
  await repository.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('offline collection forms', () => {
  it('creates a private scoped collection, saves a form without preview data, and reloads both immutable versions', async () => {
    const firstRender = wrapper(<DataPage />);
    await screen.findByRole('link', { name: /Synthetic collection/ });
    await userEvent.click(screen.getByRole('button', { name: 'New collection' }));
    await enter('Collection name', 'Fictional interviews');
    await enter('Retention days', '60');
    await userEvent.type(screen.getByLabelText('Description'), 'Permitted manual notes');
    await userEvent.selectOptions(screen.getByLabelText(/^Visibility/), 'project');
    await userEvent.selectOptions(screen.getByLabelText(/^Classification/), 'internal');
    await userEvent.click(screen.getByRole('button', { name: 'Create collection' }));
    await screen.findByRole('heading', { name: 'Fictional interviews' });
    await userEvent.click(await screen.findByRole('button', { name: 'New Person form' }));
    await enter('Field 1 label', 'Legal name');
    await userEvent.type(
      screen.getByRole('textbox', { name: /^Legal name/ }),
      'NEVER PERSIST PREVIEW',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Check preview' }));
    expect(await screen.findByText('Input formats are valid')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await screen.findByRole('button', { name: 'Preview Person v1' });
    const created = (await repository.listCollections()).items.find(
      (item) => item.name === 'Fictional interviews',
    )!;
    expect(created).toMatchObject({ retentionDays: 60, label: 'internal', visibility: 'project' });
    const saved = (await repository.listItems(created.id, 'form_template')).items[0]!;
    expect(JSON.stringify(saved)).not.toContain('NEVER PERSIST PREVIEW');
    expect((await repository.listItems(created.id, 'record')).items).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'New version of Person v1' }));
    await userEvent.selectOptions(screen.getByLabelText('Field 1 type', { exact: true }), 'email');
    expect(screen.getByText('Change Legal name from text to email')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save version 2' }));
    await screen.findByRole('button', { name: 'Preview Person v2' });
    firstRender.unmount();
    client.clear();
    wrapper(<DataPage />, `/p/${projectId}/data/${created.id}`);
    await screen.findByRole('button', { name: 'Preview Person v1' });
    await screen.findByRole('button', { name: 'Preview Person v2' });
    await userEvent.click(screen.getByRole('button', { name: 'Preview Person v1' }));
    expect(screen.getByRole('textbox', { name: /^Legal name/ })).toHaveValue('');
  });

  it('edits stable custom field definitions, reorders and removes fields, and confirms discarding a draft', async () => {
    wrapper(<DataPage />, `/p/${projectId}/data/collection`);
    await screen.findByRole('button', { name: 'Custom form' });
    await userEvent.click(screen.getByRole('button', { name: 'Custom form' }));
    expect(screen.getByRole('button', { name: 'Save form' })).toBeDisabled();
    await enter('Form name', 'Interview');
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await enter('Field 1 label', 'Summary');
    const row = screen.getByRole('listitem');
    await userEvent.click(within(row).getByLabelText('Required'));
    await userEvent.click(within(row).getByLabelText('Multiple values'));
    await userEvent.click(within(row).getByLabelText('Multiple lines'));
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }));
    await enter('Field 2 label', 'Attended');
    await userEvent.selectOptions(
      screen.getByLabelText('Field 2 type', { exact: true }),
      'boolean',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move field 2 up' }));
    expect(screen.getByLabelText('Field 1 label')).toHaveValue('Attended');
    await userEvent.click(screen.getByRole('button', { name: 'Move field 1 down' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove field 2' }));
    fireEvent(window, new Event('beforeunload', { cancelable: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Discard this unsaved draft?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save form' }));
    await screen.findByRole('button', { name: 'Preview Interview v1' });
    const saved = (await repository.listItems('collection', 'form_template')).items[0]!;
    expect(saved).toMatchObject({
      fields: [{ label: 'Summary', multiple: true, required: true, multiline: true }],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Custom form' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Custom form' }));
    await enter('Form name', 'Discard me');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('retains a conflicting draft and retries against refreshed collection revision', async () => {
    const saved = await repository.commit('collection', 1, [{ op: 'put', item: definition() }]);
    const close = vi.fn();
    function Editor() {
      const [current, setCurrent] = useState(saved.collection);
      return (
        <TemplateEditor
          collection={current}
          repository={repository}
          previous={definition()}
          preset="blank"
          canWrite
          onClose={close}
          onSaved={() => {
            close();
            return Promise.resolve();
          }}
          onReload={async () => {
            setCurrent(await repository.getCollection('collection'));
          }}
        />
      );
    }
    render(<Editor />);
    await enter('Form name', 'Person revised');
    await enter('Version number', '3');
    await repository.updateCollection('collection', 2, { description: 'Concurrent edit' });
    await userEvent.click(screen.getByRole('button', { name: 'Save version 3' }));
    expect(await screen.findByText("Form wasn't saved")).toBeInTheDocument();
    expect(screen.getByLabelText('Form name')).toHaveValue('Person revised');
    expect(screen.getByText('Rename form to Person revised')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh collection' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save version 3' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect((await repository.getItem('collection', 'person_v3')).name).toBe('Person revised');
  });

  it('respects read-only grants while keeping safe previews usable and rejects newer template revisions', async () => {
    await repository.commit('collection', 1, [
      { op: 'put', item: { ...definition(), id: 'future', templateFormat: 'raven.form.v2' } },
    ]);
    wrapper(
      <CollectionForms
        projectId={projectId}
        collectionId="collection"
        project={{
          repository,
          cacheScope: 'readonly',
          mode: 'server',
          canCreate: false,
          access: () => Promise.resolve({ canWrite: false }),
        }}
      />,
    );
    await screen.findByText('View access');
    expect(screen.getByRole('button', { name: 'New Person form' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'New version of Person v1' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Preview Person v1' }));
    expect(screen.getByRole('textbox', { name: /^Full name/ })).toHaveValue('');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows precise unavailable and invalid-link states instead of a failed render', async () => {
    const view = wrapper(<DataPage />, `/p/${projectId}/data/missing`);
    expect(await screen.findByText("Couldn't open this collection")).toBeInTheDocument();
    view.unmount();
    wrapper(<DataPage />, '/p/bad%20id/data');
    expect(screen.getByText('Invalid collection link')).toBeInTheDocument();
  });

  it('keeps data unavailable when read access checks fail', async () => {
    wrapper(
      <CollectionForms
        projectId={projectId}
        collectionId="collection"
        project={{
          repository,
          cacheScope: 'denied',
          mode: 'server',
          canCreate: true,
          access: () => Promise.reject(new DatasetError('FORBIDDEN', 'Grant revoked')),
        }}
      />,
    );
    expect(await screen.findByText('Grant revoked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom form' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Grant revoked');
  });
});

describe('transient typed previews', () => {
  const field = (
    id: string,
    type: FormField['type'],
    extra: Partial<FormField> = {},
  ): FormField => ({ id, label: id, type, required: false, multiple: false, ...extra });
  it('validates formats, preserves false and multiple values, and supports corrections without persistence', async () => {
    wrapper(
      <FormPreview
        fields={[
          field('Email', 'email', { required: true, multiple: true }),
          field('Attended', 'boolean'),
          field('Notes', 'text', { multiline: true }),
          field('Date', 'date'),
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Check preview' }));
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /^Email 1/ }), 'wrong');
    expect(screen.getByText('Enter an email address')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: /^Email 1/ }));
    await userEvent.type(
      screen.getByRole('textbox', { name: /^Email 1/ }),
      'fictional@example.test',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add Email' }));
    await userEvent.type(screen.getByRole('textbox', { name: /^Email 2/ }), 'second@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Email value 1' }));
    expect(screen.getByRole('textbox', { name: /^Email 1/ })).toHaveValue('second@example.test');
    await userEvent.selectOptions(screen.getByLabelText('Attended', { exact: true }), 'false');
    await userEvent.type(screen.getByLabelText('Notes'), 'Synthetic note');
    await userEvent.type(screen.getByLabelText('Date'), '2026-10-31');
    expect(screen.getByText('Input formats are valid')).toBeInTheDocument();
    expect((await repository.listItems('collection', 'assertion')).items).toEqual([]);
  });

  it('keeps raw values across definition changes and makes newly-invalid boolean data correctable', async () => {
    const view = render(<FormPreview fields={[field('value', 'text')]} />);
    await userEvent.type(screen.getByLabelText('value'), 'not boolean');
    view.rerender(<FormPreview fields={[field('value', 'boolean')]} />);
    expect(screen.getByLabelText('value')).toHaveValue('not boolean');
    await userEvent.click(screen.getByRole('button', { name: 'Check preview' }));
    expect(screen.getByText('Choose Yes or No')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('value'), 'true');
    expect(screen.getByText('Input formats are valid')).toBeInTheDocument();
    view.rerender(<FormPreview fields={[]} />);
    expect(screen.getByText('Add a field to try the form')).toBeInTheDocument();
  });
});
