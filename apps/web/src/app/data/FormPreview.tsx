import { memo, useId, useMemo, useState, type ChangeEvent } from 'react';
import { PlusIcon, Cross2Icon, CheckIcon } from '@radix-ui/react-icons';
import { Button, Banner } from '@nexus/ui';
import { MAX_FORM_VALUES, validateFormInputs, type FormField } from '@nexus/domain';

function ValueControl({
  field,
  index,
  value,
  error,
  onChange,
}: {
  field: FormField;
  index: number;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const label = `${field.label || 'Unnamed field'}${field.multiple ? ` ${String(index + 1)}` : ''}`;
  const props = {
    id,
    value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(event.target.value),
    required: field.required,
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${id}-error` : undefined,
  };
  return (
    <div className="nx-preview-value">
      <label htmlFor={id} className={field.multiple ? 'nx-visually-hidden' : 'nx-data-field-label'}>
        {label}
        {field.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {field.type === 'boolean' ? (
        <select {...props}>
          <option value="">Not set</option>
          {value && !['true', 'false'].includes(value.toLowerCase()) ? (
            <option value={value}>{value}</option>
          ) : null}
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : field.type === 'text' && field.multiline === true ? (
        <textarea {...props} rows={3} />
      ) : (
        <input
          {...props}
          type="text"
          inputMode={
            field.type === 'number'
              ? 'decimal'
              : field.type === 'phone'
                ? 'tel'
                : field.type === 'email'
                  ? 'email'
                  : field.type === 'url'
                    ? 'url'
                    : 'text'
          }
          placeholder={field.type === 'date' ? 'YYYY-MM-DD' : undefined}
        />
      )}
      {error ? (
        <span className="nx-data-field-error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export const FormPreview = memo(function FormPreview({ fields }: { fields: readonly FormField[] }) {
  const [values, setValues] = useState<ReadonlyMap<string, string[]>>(new Map());
  const [checked, setChecked] = useState(false);
  const result = useMemo(() => validateFormInputs({ fields }, values), [fields, values]);
  const update = (fieldId: string, next: string[]): void =>
    setValues((previous) => new Map(previous).set(fieldId, next));
  return (
    <section className="nx-form-preview" aria-label="Form preview">
      <header>
        <h2>Live preview</h2>
        <p>Checks formats only · Preview values are not saved</p>
      </header>
      {fields.length === 0 ? <p className="nx-data-privacy">Add a field to try the form</p> : null}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setChecked(true);
        }}
      >
        <div className="nx-preview-fields">
          {fields.map((field) => {
            const entered = values.get(field.id) ?? [''];
            const errors = checked
              ? result.issues.filter((issue) => issue.fieldId === field.id)
              : [];
            return (
              <fieldset className="nx-preview-field" key={field.id}>
                {field.multiple ? (
                  <legend>
                    {field.label || 'Unnamed field'}
                    {field.required ? <span aria-hidden="true"> *</span> : null}
                  </legend>
                ) : null}
                {entered.map((value, index) => (
                  <div className="nx-preview-row" key={index}>
                    <ValueControl
                      field={field}
                      index={index}
                      value={value}
                      error={
                        errors.find((issue) => issue.index === index || issue.index === null)
                          ?.message
                      }
                      onChange={(next) =>
                        update(
                          field.id,
                          entered.map((old, position) => (position === index ? next : old)),
                        )
                      }
                    />
                    {field.multiple && entered.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${field.label || 'field'} value ${String(index + 1)}`}
                        onClick={() =>
                          update(
                            field.id,
                            entered.filter((_, position) => position !== index),
                          )
                        }
                      >
                        <Cross2Icon aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                {field.multiple ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<PlusIcon aria-hidden="true" />}
                    disabled={entered.length >= MAX_FORM_VALUES}
                    onClick={() => update(field.id, [...entered, ''])}
                  >
                    Add {field.label || 'value'}
                  </Button>
                ) : null}
              </fieldset>
            );
          })}
        </div>
        {fields.length > 0 ? (
          <Button type="submit" variant="secondary" icon={<CheckIcon aria-hidden="true" />}>
            Check preview
          </Button>
        ) : null}
      </form>
      {checked && result.issues.length === 0 && fields.length > 0 ? (
        <Banner kind="success" title="Input formats are valid">
          These values remain in this preview
        </Banner>
      ) : null}
      {checked && result.issues.length > 0 ? (
        <p className="nx-data-field-error" role="status">
          Check the highlighted fields
        </p>
      ) : null}
    </section>
  );
});
