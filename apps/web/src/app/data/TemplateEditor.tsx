import { memo, useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, ArrowDownIcon, TrashIcon, PlusIcon } from '@radix-ui/react-icons';
import { Banner, Button, Dialog, Field } from '@nexus/ui';
import {
  createFormVersion,
  formChanges,
  formFamilyId,
  personFormFields,
  FORM_FIELD_TYPES,
  type DataCollection,
  type DatasetRepository,
  type FormField,
  type FormTemplate,
} from '@nexus/domain';
import { FormPreview } from './FormPreview';
import { datasetMessage } from './messages';

const FieldRow = memo(function FieldRow({
  field,
  index,
  last,
  update,
  move,
  remove,
}: {
  field: FormField;
  index: number;
  last: boolean;
  update: (id: string, patch: Partial<FormField>) => void;
  move: (id: string, delta: number) => void;
  remove: (id: string) => void;
}) {
  return (
    <li className="nx-form-field-row">
      <header>
        <span className="nx-form-order">{String(index + 1)}</span>
        <strong>{field.label || 'Unnamed field'}</strong>
        <div className="nx-form-row-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Move field ${String(index + 1)} up`}
            disabled={index === 0}
            onClick={() => move(field.id, -1)}
          >
            <ArrowUpIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Move field ${String(index + 1)} down`}
            disabled={last}
            onClick={() => move(field.id, 1)}
          >
            <ArrowDownIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove field ${String(index + 1)}`}
            onClick={() => remove(field.id)}
          >
            <TrashIcon aria-hidden="true" />
          </Button>
        </div>
      </header>
      <div className="nx-form-field-settings">
        <Field
          label={`Field ${String(index + 1)} label`}
          value={field.label}
          maxLength={200}
          onChange={(event) => update(field.id, { label: event.target.value })}
          required
        />
        <label className="nx-data-field">
          Field {String(index + 1)} type
          <select
            aria-label={`Field ${String(index + 1)} type`}
            value={field.type}
            onChange={(event) =>
              update(field.id, { type: event.target.value as FormField['type'] })
            }
          >
            {FORM_FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === 'url' ? 'Web link' : type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="nx-form-options">
        <label>
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => update(field.id, { required: event.target.checked })}
          />
          Required
        </label>
        <label>
          <input
            type="checkbox"
            checked={field.multiple}
            onChange={(event) => update(field.id, { multiple: event.target.checked })}
          />
          Multiple values
        </label>
        {field.type === 'text' ? (
          <label>
            <input
              type="checkbox"
              checked={field.multiline === true}
              onChange={(event) => update(field.id, { multiline: event.target.checked })}
            />
            Multiple lines
          </label>
        ) : null}
      </div>
    </li>
  );
});

export function TemplateEditor({
  collection,
  repository,
  previous,
  preset,
  canWrite,
  onClose,
  onSaved,
  onReload,
}: {
  collection: DataCollection;
  repository: DatasetRepository;
  previous: FormTemplate | undefined;
  preset: 'person' | 'blank';
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onReload: () => Promise<unknown>;
}) {
  const [name, setName] = useState(previous?.name ?? (preset === 'person' ? 'Person' : ''));
  const [fields, setFields] = useState<FormField[]>(() =>
    previous
      ? previous.fields.map((field) => ({ ...field }))
      : preset === 'person'
        ? personFormFields()
        : [],
  );
  const [familyId] = useState(() =>
    previous ? formFamilyId(previous) : `form_${crypto.randomUUID()}`,
  );
  const [version, setVersion] = useState((previous?.version ?? 0) + 1);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const previewFields = useDeferredValue(fields);
  const update = useCallback((id: string, patch: Partial<FormField>) => {
    setDirty(true);
    setFields((old) => old.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  }, []);
  const remove = useCallback((id: string) => {
    setDirty(true);
    setFields((old) => old.filter((field) => field.id !== id));
  }, []);
  const move = useCallback((id: string, delta: number) => {
    setDirty(true);
    setFields((old) => {
      const next = [...old];
      const index = next.findIndex((field) => field.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= next.length) return old;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }, []);
  const close = (): void => {
    if (saving) return;
    if (dirty) setDiscard(true);
    else onClose();
  };
  const save = async (): Promise<void> => {
    setError(null);
    setSaving(true);
    try {
      const template = createFormVersion({
        collection,
        familyId,
        version,
        name,
        fields,
        now: new Date().toISOString(),
        ...(previous ? { previous } : {}),
      });
      await repository.commit(collection.id, collection.revision, [{ op: 'put', item: template }]);
      if (alive.current) {
        setDirty(false);
        await onSaved();
      }
    } catch (cause) {
      if (alive.current) setError(cause);
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  const changes = previous ? formChanges(previous, fields) : [];
  const valid =
    name.trim().length > 0 &&
    fields.length > 0 &&
    fields.every((field) => field.label.trim()) &&
    Number.isSafeInteger(version) &&
    version > (previous?.version ?? 0);
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      size="lg"
      title={
        previous
          ? `New version of ${previous.name}`
          : preset === 'person'
            ? 'New Person form'
            : 'Custom form'
      }
      description="Save a reusable definition · Existing records keep their exact form version"
    >
      <div className="nx-form-editor">
        <div className="nx-form-definition">
          <Field
            label="Form name"
            value={name}
            maxLength={200}
            required
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
            }}
          />
          <Field
            label="Version number"
            type="number"
            min={(previous?.version ?? 0) + 1}
            step={1}
            value={version}
            readOnly={!previous}
            onChange={(event) => {
              setVersion(Number(event.target.value));
              setDirty(true);
            }}
            description="Each saved version has its own immutable definition"
          />
          <ol className="nx-form-field-list">
            {fields.map((field, index) => (
              <FieldRow
                key={field.id}
                field={field}
                index={index}
                last={index === fields.length - 1}
                update={update}
                move={move}
                remove={remove}
              />
            ))}
          </ol>
          <Button
            variant="secondary"
            icon={<PlusIcon aria-hidden="true" />}
            disabled={fields.length >= 128}
            onClick={() => {
              setDirty(true);
              setFields((old) => [
                ...old,
                {
                  id: `field_${crypto.randomUUID()}`,
                  label: `Field ${String(old.length + 1)}`,
                  type: 'text',
                  required: false,
                  multiple: false,
                },
              ]);
            }}
          >
            Add field
          </Button>
        </div>
        <FormPreview fields={previewFields} />
      </div>
      {previous ? (
        <details className="nx-form-changes" open>
          <summary>Changes in version {String(version)}</summary>
          <p>Existing records are not converted</p>
          {previous.name !== name ? <p>Rename form to {name || 'an unnamed form'}</p> : null}
          <ul>
            {changes.map((change, index) => (
              <li key={`${String(index)}:${change}`}>{change}</li>
            ))}
          </ul>
          {changes.length === 0 ? <p>No field changes</p> : null}
        </details>
      ) : null}
      {!canWrite ? (
        <Banner kind="warn" title="This collection is read-only">
          Your draft is kept, but saving requires edit access
        </Banner>
      ) : null}
      {error ? (
        <Banner kind="danger" title="Form wasn't saved">
          {datasetMessage(error)}
          <Button variant="ghost" onClick={() => void onReload()}>
            Refresh collection
          </Button>
        </Banner>
      ) : null}
      {discard ? (
        <Banner kind="warn" title="Discard this unsaved draft?">
          <div className="nx-inline">
            <Button variant="danger" onClick={onClose}>
              Discard draft
            </Button>
            <Button variant="secondary" onClick={() => setDiscard(false)}>
              Keep editing
            </Button>
          </div>
        </Banner>
      ) : null}
      <footer className="nx-form-footer">
        <span>
          {fields.length === 0
            ? 'Add at least one field'
            : `${String(fields.length)} fields · Preview values are not saved`}
        </span>
        <Button variant="ghost" onClick={close} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={!valid || !canWrite}
          loading={saving}
        >
          {previous ? `Save version ${String(version)}` : 'Save form'}
        </Button>
      </footer>
    </Dialog>
  );
}
