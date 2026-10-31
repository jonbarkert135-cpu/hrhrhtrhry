import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArchiveIcon, PlusIcon, ArrowLeftIcon, LockClosedIcon } from '@radix-ui/react-icons';
import { DatasetIdSchema, type CreateCollection } from '@nexus/domain';
import { Banner, Button, Dialog, Field, Skeleton } from '@nexus/ui';
import { datasetMessage } from './messages';
import { DatasetProjectBoundary, type DatasetProject } from '../../data/datasets/useDatasetProject';
import { CollectionForms } from './CollectionForms';
import './data.css';

function Collections({ projectId, project }: { projectId: string; project: DatasetProject }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<CreateCollection['visibility']>('private');
  const [retention, setRetention] = useState(30);
  const [label, setLabel] = useState<CreateCollection['label']>('restricted');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const key = ['datasets', project.cacheScope, 'collections'] as const;
  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      project.repository.listCollections({
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const create = useMutation({
    mutationFn: () =>
      project.repository.createCollection({
        id: crypto.randomUUID(),
        name,
        description,
        visibility,
        label,
        retentionDays: retention,
      }),
    onSuccess: async (collection) => {
      await client.invalidateQueries({ queryKey: key });
      if (!alive.current) return;
      setOpen(false);
      await navigate(`/p/${projectId}/data/${collection.id}`);
    },
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="nx-page nx-data-page">
      <Link className="nx-data-back" to={`/p/${projectId}`}>
        <ArrowLeftIcon aria-hidden="true" />
        Project boards
      </Link>
      <header className="nx-page-head">
        <div>
          <p className="nx-page-kicker">Data intelligence</p>
          <h1 className="nx-page-title">Collections</h1>
          <p className="nx-page-sub">
            Keep structured data outside the canvas and choose how it is recorded
          </p>
        </div>
        <Button
          icon={<PlusIcon aria-hidden="true" />}
          onClick={() => setOpen(true)}
          disabled={!project.canCreate}
        >
          New collection
        </Button>
      </header>
      {!project.canCreate ? (
        <Banner kind="info" title="View access">
          You can inspect collection forms, but cannot create or edit them
        </Banner>
      ) : null}
      {query.error ? (
        <Banner kind="danger" title="Couldn't load collections">
          {datasetMessage(query.error)}
          <Button variant="ghost" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </Banner>
      ) : null}
      {query.isPending ? <Skeleton height="var(--nx-space-10)" /> : null}
      {!query.isPending && !query.error && items.length === 0 ? (
        <div className="nx-data-empty">
          <ArchiveIcon aria-hidden="true" />
          <h2>Create a collection</h2>
          <p>Name a collection, then define its Person form or a custom template</p>
        </div>
      ) : null}
      <div className="nx-data-grid">
        {items.map((collection) => (
          <Link
            className="nx-data-card"
            key={collection.id}
            to={`/p/${projectId}/data/${collection.id}`}
          >
            <ArchiveIcon aria-hidden="true" />
            <h2>{collection.name}</h2>
            <p>{collection.description || 'Form templates for structured records'}</p>
            <span>
              <LockClosedIcon aria-hidden="true" />
              {collection.label} ·{' '}
              {collection.visibility === 'organization'
                ? 'Workspace'
                : collection.visibility === 'project'
                  ? 'Project'
                  : 'Private'}{' '}
              · {String(collection.retentionDays)} day retention
            </span>
          </Link>
        ))}
      </div>
      {query.hasNextPage ? (
        <Button
          variant="secondary"
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Load more collections
        </Button>
      ) : null}
      <p className="nx-data-privacy">
        {project.mode === 'local'
          ? 'Saved on this device · No account or external service required'
          : 'Access is checked against your workspace and collection permissions'}
      </p>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!create.isPending) setOpen(next);
        }}
        title="New collection"
        description="Start with a private collection and a clear name"
      >
        <form
          className="nx-stack"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Field
            label="Collection name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={200}
          />
          <label className="nx-data-field">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={4000}
              rows={3}
            />
          </label>
          <label className="nx-data-field">
            Visibility
            <select
              value={visibility}
              onChange={(event) =>
                setVisibility(event.target.value as CreateCollection['visibility'])
              }
            >
              <option value="private">Private</option>
              <option value="project">Project members</option>
              {project.mode === 'server' ? (
                <option value="organization">Workspace members</option>
              ) : null}
            </select>
          </label>
          <Field
            label="Retention days"
            type="number"
            min={1}
            max={3650}
            step={1}
            value={retention}
            onChange={(event) => setRetention(Number(event.target.value))}
            required
            description="Deleted collections remain recoverable until this period expires"
          />
          <label className="nx-data-field">
            Classification
            <select
              value={label}
              onChange={(event) => setLabel(event.target.value as CreateCollection['label'])}
            >
              <option value="restricted">Restricted</option>
              <option value="internal">Internal</option>
              <option value="public">Public classification</option>
            </select>
          </label>
          <p className="nx-data-privacy">
            Classification does not publish data · Restricted collections need an explicit
            membership grant
          </p>
          {create.error ? (
            <Banner kind="danger" title="Collection wasn't created">
              {datasetMessage(create.error)}
            </Banner>
          ) : null}
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Create collection
          </Button>
        </form>
      </Dialog>
    </section>
  );
}

export default function DataPage() {
  const { projectId = '', collectionId } = useParams();
  if (
    !DatasetIdSchema.safeParse(projectId).success ||
    (collectionId !== undefined && !DatasetIdSchema.safeParse(collectionId).success)
  )
    return (
      <section className="nx-page">
        <Banner kind="warn" title="Invalid collection link">
          Choose a project and open its data collections
        </Banner>
        <Link to="/">Open workspace</Link>
      </section>
    );
  return (
    <DatasetProjectBoundary projectId={projectId}>
      {(project) =>
        collectionId ? (
          <CollectionForms
            key={`${project.cacheScope}:${collectionId}`}
            projectId={projectId}
            collectionId={collectionId}
            project={project}
          />
        ) : (
          <Collections key={project.cacheScope} projectId={projectId} project={project} />
        )
      }
    </DatasetProjectBoundary>
  );
}
