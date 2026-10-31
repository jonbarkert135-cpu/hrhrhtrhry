import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, PersonIcon, FileTextIcon, PlusIcon } from '@radix-ui/react-icons';
import { FORM_TEMPLATE_FORMAT, type FormTemplate } from '@nexus/domain';
import { Banner, Button, Dialog, Skeleton } from '@nexus/ui';
import type { DatasetProject } from '../../data/datasets/useDatasetProject';
import { datasetMessage } from './messages';
import { TemplateEditor } from './TemplateEditor';
import { FormPreview } from './FormPreview';

export function CollectionForms({
  projectId,
  collectionId,
  project,
}: {
  projectId: string;
  collectionId: string;
  project: DatasetProject;
}) {
  const client = useQueryClient();
  const root = ['datasets', project.cacheScope, collectionId] as const;
  const collection = useQuery({
    queryKey: [...root, 'collection'],
    queryFn: () => project.repository.getCollection(collectionId),
  });
  const access = useQuery({
    queryKey: [...root, 'access'],
    queryFn: () => project.access(collectionId),
    enabled: Boolean(collection.data),
  });
  const forms = useInfiniteQuery({
    queryKey: [...root, 'forms'],
    enabled: Boolean(collection.data),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      project.repository.listItems(collectionId, 'form_template', {
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const [editor, setEditor] = useState<{
    previous: FormTemplate | undefined;
    preset: 'person' | 'blank';
  } | null>(null);
  const [preview, setPreview] = useState<FormTemplate | null>(null);
  const canWrite = access.data?.canWrite === true && !access.error;
  const items = (forms.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (item): item is FormTemplate => item.kind === 'form_template',
  );
  if (!collection.data && collection.error)
    return (
      <section className="nx-page">
        <Banner kind="danger" title="Couldn't open this collection">
          {datasetMessage(collection.error)}
        </Banner>
        <Link to={`/p/${projectId}/data`}>Back to collections</Link>
      </section>
    );
  if (!collection.data)
    return (
      <section className="nx-page">
        <Skeleton height="var(--nx-space-10)" />
      </section>
    );
  const current = collection.data;
  return (
    <section className="nx-page nx-data-page">
      <Link className="nx-data-back" to={`/p/${projectId}/data`}>
        <ArrowLeftIcon aria-hidden="true" />
        Collections
      </Link>
      <header className="nx-page-head">
        <div>
          <p className="nx-page-kicker">Collection forms</p>
          <h1 className="nx-page-title">{current.name}</h1>
          <p className="nx-page-sub">
            {current.description || 'Define how your records will be structured'}
          </p>
        </div>
        <span className="nx-data-classification">
          {current.label} · {current.visibility}
        </span>
      </header>
      <div className="nx-data-actions">
        <Button
          icon={<PersonIcon aria-hidden="true" />}
          onClick={() => setEditor({ previous: undefined, preset: 'person' })}
          disabled={!canWrite}
        >
          New Person form
        </Button>
        <Button
          variant="secondary"
          icon={<PlusIcon aria-hidden="true" />}
          onClick={() => setEditor({ previous: undefined, preset: 'blank' })}
          disabled={!canWrite}
        >
          Custom form
        </Button>
      </div>
      {access.isPending ? (
        <p className="nx-data-privacy" role="status">
          Checking collection access
        </p>
      ) : !canWrite && !access.error ? (
        <Banner kind="info" title="View access">
          You can try the forms, but cannot save new versions
        </Banner>
      ) : null}
      {collection.error || forms.error || access.error ? (
        <Banner kind="danger" title="Couldn't refresh collection data">
          {datasetMessage(collection.error ?? forms.error ?? access.error)}
          <Button variant="ghost" onClick={() => void client.invalidateQueries({ queryKey: root })}>
            Try again
          </Button>
        </Banner>
      ) : null}
      {forms.isPending ? <Skeleton height="var(--nx-space-10)" /> : null}
      {!forms.isPending && !forms.error && items.length === 0 ? (
        <div className="nx-data-empty">
          <FileTextIcon aria-hidden="true" />
          <h2>Shape the first form</h2>
          <p>Start with Person or add your own fields · Each saved version stays unchanged</p>
        </div>
      ) : null}
      <div className="nx-data-grid">
        {items.map((template) => {
          const supported =
            typeof template.templateFormat !== 'string' ||
            !template.templateFormat.startsWith('raven.form.') ||
            template.templateFormat === FORM_TEMPLATE_FORMAT;
          return (
            <article className="nx-data-card nx-form-card" key={template.id}>
              <FileTextIcon aria-hidden="true" />
              <h2>{template.name}</h2>
              <span className="nx-form-version">
                Version {String(template.version)} · {String(template.fields.length)} fields
              </span>
              <p>
                {template.fields
                  .slice(0, 4)
                  .map((field) => field.label)
                  .join(' · ')}
                {template.fields.length > 4 ? ' …' : ''}
              </p>
              <div className="nx-data-actions">
                <Button
                  variant="secondary"
                  aria-label={`Preview ${template.name} v${String(template.version)}`}
                  onClick={() => setPreview(template)}
                >
                  Preview
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`New version of ${template.name} v${String(template.version)}`}
                  disabled={!canWrite || !supported}
                  onClick={() => setEditor({ previous: template, preset: 'blank' })}
                >
                  {supported ? 'New version' : 'Newer form format'}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      {forms.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={forms.isFetchingNextPage}
          onClick={() => void forms.fetchNextPage()}
        >
          Load more forms
        </Button>
      ) : null}
      <p className="nx-data-privacy">Saved versions preserve the meaning of earlier records</p>
      {editor ? (
        <TemplateEditor
          key={editor.previous?.id ?? editor.preset}
          collection={current}
          repository={project.repository}
          previous={editor.previous}
          preset={editor.preset}
          canWrite={canWrite}
          onClose={() => setEditor(null)}
          onReload={() => client.invalidateQueries({ queryKey: root })}
          onSaved={async () => {
            await client.invalidateQueries({ queryKey: root });
            setEditor(null);
          }}
        />
      ) : null}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={preview ? `Preview · ${preview.name} v${String(preview.version)}` : 'Form preview'}
        size="lg"
      >
        {preview ? <FormPreview key={preview.id} fields={preview.fields} /> : null}
      </Dialog>
    </section>
  );
}
