import {
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  useId,
} from 'react';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  children: (describedBy: string | undefined) => ReactNode;
}

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  const hintId = hint === undefined ? undefined : `${id}-dica`;
  const errorId = error === undefined ? undefined : `${id}-erro`;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium text-slate-900">
        {label}
      </label>
      {children(describedBy)}
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm font-medium text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'block min-h-11 w-full rounded-lg border border-neutral-border bg-white px-3 text-base text-slate-900 aria-invalid:border-danger-700 disabled:bg-slate-100 disabled:text-slate-600';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  ref?: Ref<HTMLInputElement>;
}

/** Campo de texto com rótulo, dica e erro associados por aria-describedby (RNF06). */
export function TextField({ label, hint, error, id, className = '', ...props }: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      {(describedBy) => (
        <input
          id={fieldId}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          className={`${CONTROL} ${className}`}
          {...props}
        />
      )}
    </FieldShell>
  );
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  ref?: Ref<HTMLSelectElement>;
}

export function SelectField({
  label,
  hint,
  error,
  id,
  className = '',
  children,
  ...props
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      {(describedBy) => (
        <select
          id={fieldId}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          className={`${CONTROL} ${className}`}
          {...props}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}
