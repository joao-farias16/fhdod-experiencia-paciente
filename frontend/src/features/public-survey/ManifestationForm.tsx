import { Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { ApiError } from '../../lib/api-client';
import {
  CONTACT_PURPOSE_TEXT,
  type CreatedManifestation,
  isRetryable,
  type ManifestationBody,
  submitManifestation,
  type SubmittedResponse,
} from './public-survey-api';
import {
  DESCRIPTION_MAX,
  digits,
  type ManifestationErrors,
  type ManifestationValues,
  TYPES,
  validateManifestation,
} from './manifestation-rules';

function bodyOf(submitted: SubmittedResponse, values: ManifestationValues): ManifestationBody {
  const phone = digits(values.phone);
  const email = values.email.trim();
  return {
    responseId: submitted.responseId,
    manifestationToken: submitted.manifestation.token,
    type: values.type ?? 'complaint',
    description: values.description.trim(),
    anonymous: !values.identify,
    ...(values.identify
      ? {
          contact: {
            fullName: values.fullName.trim(),
            ...(phone === '' ? {} : { phone }),
            ...(email === '' ? {} : { email }),
            consent: true as const,
          },
        }
      : {}),
  };
}

function failureText(error: unknown): string {
  if (error instanceof ApiError && isRetryable(error)) {
    return 'Sem conexão com o servidor. Seu texto continua aqui. Tente enviar de novo.';
  }
  return error instanceof ApiError ? error.message : 'Não foi possível enviar. Tente novamente.';
}

/** Falhas definitivas: o token não serve mais (409, 403, 422); não adianta reenviar. */
function isFinal(error: unknown): boolean {
  return error instanceof ApiError && [403, 409, 422].includes(error.status);
}

interface ManifestationFormProps {
  submitted: SubmittedResponse;
  onCreated: (created: CreatedManifestation) => void;
  onCancel: () => void;
}

/**
 * TL10 — manifestação após a avaliação (RF41–RF43): tipo, descrição, anonimato como opção padrão
 * e contato voluntário com finalidade e aceite. Os dados ficam só na memória (nunca no
 * sessionStorage) e a Idempotency-Key é mantida até o sucesso; nova chave se o texto mudar (RN13).
 */
export function ManifestationForm({ submitted, onCreated, onCancel }: ManifestationFormProps) {
  const ids = useId();
  const [values, setValues] = useState<ManifestationValues>({
    type: null,
    description: '',
    identify: false,
    fullName: '',
    phone: '',
    email: '',
    consent: false,
  });
  const [errors, setErrors] = useState<ManifestationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const key = useRef<{ value: string; fingerprint: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Foco no título ao abrir o formulário (leitores de tela e teclado).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const set = <K extends keyof ManifestationValues>(field: K, value: ManifestationValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const onSubmit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const found = validateManifestation(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setTimeout(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }
    const body = bodyOf(submitted, values);
    const fingerprint = JSON.stringify(body);
    if (key.current?.fingerprint !== fingerprint) {
      key.current = { value: crypto.randomUUID(), fingerprint };
    }
    setSubmitting(true);
    setFailure(null);
    try {
      onCreated(await submitManifestation(body, key.current.value));
    } catch (error) {
      setFailure(error);
    } finally {
      setSubmitting(false);
    }
  };

  const remaining = DESCRIPTION_MAX - values.description.trim().length;

  return (
    <form
      ref={formRef}
      noValidate
      aria-labelledby={`${ids}-titulo`}
      onSubmit={(event) => void onSubmit(event)}
      className="space-y-6 text-left"
    >
      <div className="space-y-1">
        <h2
          id={`${ids}-titulo`}
          ref={headingRef}
          tabIndex={-1}
          className="text-[22px] font-semibold"
        >
          Registrar manifestação
        </h2>
        <p className="text-lg text-slate-700">
          Sua avaliação já foi registrada. A manifestação vai para a Ouvidoria.
        </p>
      </div>

      <fieldset
        className="space-y-2"
        aria-describedby={errors.type ? `${ids}-tipo-erro` : undefined}
      >
        <legend className="text-lg font-medium">Tipo</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {TYPES.map((option) => (
            <label
              key={option.value}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-neutral-border bg-white px-4 has-checked:border-brand-700 has-checked:ring-2 has-checked:ring-brand-700"
            >
              <input
                type="radio"
                name={`${ids}-tipo`}
                value={option.value}
                checked={values.type === option.value}
                aria-invalid={errors.type === undefined ? undefined : true}
                onChange={() => {
                  set('type', option.value);
                }}
                className="size-5"
              />
              <span className="text-lg">{option.label}</span>
            </label>
          ))}
        </div>
        {errors.type === undefined ? null : (
          <p id={`${ids}-tipo-erro`} className="font-medium text-danger-700">
            {errors.type}
          </p>
        )}
      </fieldset>

      <div className="space-y-1">
        <label htmlFor={`${ids}-descricao`} className="block text-lg font-medium">
          O que você quer contar?
        </label>
        <textarea
          id={`${ids}-descricao`}
          rows={5}
          maxLength={DESCRIPTION_MAX + 200}
          value={values.description}
          aria-invalid={errors.description === undefined ? undefined : true}
          aria-describedby={`${ids}-descricao-dica${errors.description ? ` ${ids}-descricao-erro` : ''}`}
          onChange={(event) => {
            set('description', event.target.value);
          }}
          className="block w-full rounded-lg border border-neutral-border bg-white p-3 text-lg aria-invalid:border-danger-700"
        />
        <p id={`${ids}-descricao-dica`} className="text-sm text-slate-700">
          De 10 a 2.000 caracteres. Restam {remaining.toLocaleString('pt-BR')}.
        </p>
        {errors.description === undefined ? null : (
          <p id={`${ids}-descricao-erro`} className="font-medium text-danger-700">
            {errors.description}
          </p>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="text-lg font-medium">Identificação</legend>
        {[
          { identify: false, label: 'Enviar sem me identificar' },
          { identify: true, label: 'Quero informar meu contato para receber retorno' },
        ].map((option) => (
          <label
            key={String(option.identify)}
            className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-neutral-border bg-white px-4 has-checked:border-brand-700 has-checked:ring-2 has-checked:ring-brand-700"
          >
            <input
              type="radio"
              name={`${ids}-identificacao`}
              checked={values.identify === option.identify}
              onChange={() => {
                set('identify', option.identify);
              }}
              className="size-5"
            />
            <span className="text-lg">{option.label}</span>
          </label>
        ))}
      </fieldset>

      {values.identify ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-slate-800">{CONTACT_PURPOSE_TEXT}</p>
          <TextField
            label="Nome"
            autoComplete="name"
            maxLength={120}
            value={values.fullName}
            error={errors.fullName}
            onChange={(event) => {
              set('fullName', event.target.value);
            }}
          />
          <TextField
            label="Telefone com DDD (opcional)"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            value={values.phone}
            error={errors.phone}
            onChange={(event) => {
              set('phone', event.target.value);
            }}
          />
          <TextField
            label="E-mail (opcional)"
            type="email"
            autoComplete="email"
            maxLength={254}
            hint="Informe ao menos um: telefone ou e-mail."
            value={values.email}
            error={errors.email}
            onChange={(event) => {
              set('email', event.target.value);
            }}
          />
          <div className="space-y-1">
            <label className="flex min-h-12 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={values.consent}
                aria-invalid={errors.consent === undefined ? undefined : true}
                aria-describedby={errors.consent ? `${ids}-aceite-erro` : undefined}
                onChange={(event) => {
                  set('consent', event.target.checked);
                }}
                className="mt-1 size-5 shrink-0"
              />
              <span>Li e aceito o uso do meu contato para esta finalidade.</span>
            </label>
            {errors.consent === undefined ? null : (
              <p id={`${ids}-aceite-erro`} className="font-medium text-danger-700">
                {errors.consent}
              </p>
            )}
          </div>
        </div>
      ) : null}

      {failure === null ? null : (
        <Alert
          tone="error"
          title="Sua manifestação ainda não foi enviada"
          requestId={failure instanceof ApiError ? failure.requestId : undefined}
        >
          {failureText(failure)}
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="secondary" className="min-h-12" disabled={submitting} onClick={onCancel}>
          {isFinal(failure) ? 'Voltar' : 'Cancelar'}
        </Button>
        {isFinal(failure) ? null : (
          <Button type="submit" className="min-h-12" disabled={submitting} aria-busy={submitting}>
            {submitting ? (
              'Enviando…'
            ) : (
              <>
                <Send aria-hidden="true" className="size-5" />
                {failure === null ? 'Enviar manifestação' : 'Tentar enviar de novo'}
              </>
            )}
          </Button>
        )}
      </div>
    </form>
  );
}
