import { randomUUID, timingSafeEqual } from 'node:crypto';

import type { Database } from '../../lib/database.js';
import type { Clock } from '../../utils/dates.js';
import { HttpError, isUniqueViolation } from '../../utils/errors.js';
import {
  canonicalHash,
  idempotencyKeyReused,
  manifestationToken,
} from '../../utils/idempotency.js';
import {
  consumeManifestationToken,
  findManifestationByIdempotencyKey,
  findProtocol,
  findResponseForManifestation,
  insertContact,
  insertManifestation,
  insertNotes,
  type StoredManifestation,
} from './manifestations.repository.js';
import { type CreateManifestationInput, PURPOSE_TEXT_VERSION } from './manifestations.schemas.js';

export interface PublicManifestationDeps {
  db: Database;
  clock: Clock;
  manifestationTokenSecret: string;
}

export interface CreatedManifestationDto {
  protocol: string;
  receivedAt: string;
}

export type CreateManifestationResult = { replayed: boolean; data: CreatedManifestationDto };

/** Token ausente, adulterado ou de outra resposta → 403, sem revelar se a resposta existe. */
function tokenInvalid(): HttpError {
  return new HttpError(
    403,
    'MANIFESTATION_TOKEN_INVALID',
    'Não foi possível confirmar esta avaliação. Responda a pesquisa de novo para se manifestar.',
  );
}

function alreadyRegistered(): HttpError {
  return new HttpError(
    409,
    'MANIFESTATION_ALREADY_EXISTS',
    'Já existe uma manifestação para esta avaliação.',
  );
}

function tokenExpired(): HttpError {
  return new HttpError(
    422,
    'MANIFESTATION_TOKEN_EXPIRED',
    'O prazo para registrar a manifestação terminou. Responda a pesquisa de novo para se manifestar.',
  );
}

/** Seção 4.3: comparação do token em tempo constante (timingSafeEqual). */
export function isValidManifestationToken(
  secret: string,
  responseId: string,
  token: string,
): boolean {
  const expected = Buffer.from(manifestationToken(secret, responseId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

type Stored = StoredManifestation;

function replay(stored: Stored, requestHash: string): CreateManifestationResult {
  if (stored.requestHash !== requestHash) throw idempotencyKeyReused();
  return {
    replayed: true,
    data: { protocol: stored.protocol, receivedAt: stored.receivedAt.toISOString() },
  };
}

/** Sinaliza, dentro da transação, que outro envio consumiu o token primeiro. */
class TokenAlreadyUsed extends Error {}

/**
 * E03 — registro da manifestação (RF41–RF43, RN04, RN12, RN13, RN22). Valida o token HMAC da
 * resposta, sua validade de 60 minutos e o uso único; numa só transação consome o token, grava a
 * manifestação (status received, protocolo da sequência), o contato segregado quando não anônima e
 * o evento "created" da linha do tempo. A mesma Idempotency-Key com o mesmo conteúdo devolve o
 * protocolo original (200); concorrência resolvida pelas restrições UNIQUE e pelo bloqueio da linha.
 */
export async function createManifestation(
  { db, clock, manifestationTokenSecret }: PublicManifestationDeps,
  idempotencyKey: string,
  input: CreateManifestationInput,
): Promise<CreateManifestationResult> {
  const requestHash = canonicalHash(input);
  const previous = await findManifestationByIdempotencyKey(db, idempotencyKey);
  if (previous !== null) return replay(previous, requestHash);

  if (
    !isValidManifestationToken(manifestationTokenSecret, input.responseId, input.manifestationToken)
  ) {
    throw tokenInvalid();
  }
  const response = await findResponseForManifestation(db, input.responseId);
  if (response === null) throw tokenInvalid();
  const recover = async (error: unknown): Promise<CreateManifestationResult> => {
    const winner = await findManifestationByIdempotencyKey(db, idempotencyKey);
    if (winner !== null) return replay(winner, requestHash);
    if (
      error instanceof TokenAlreadyUsed ||
      isUniqueViolation(error, 'manifestations_response_id_key')
    ) {
      throw alreadyRegistered();
    }
    throw error;
  };

  // RN22: uma manifestação por resposta (409) antes da validade do token (422). Um envio
  // concorrente que chega depois do COMMIT do primeiro, com a mesma chave, repete o original.
  if (response.hasManifestation || response.manifestationTokenUsedAt !== null) {
    return recover(new TokenAlreadyUsed());
  }
  const now = clock.now();
  if (now.getTime() > response.manifestationTokenExpiresAt.getTime()) throw tokenExpired();

  try {
    const created = await db.transaction(async (tx) => {
      // Uso único: só um envio muda manifestation_token_used_at de nulo para preenchido.
      if (!(await consumeManifestationToken(tx, response.id, now))) throw new TokenAlreadyUsed();

      const id = randomUUID();
      await insertManifestation(tx, {
        id,
        responseId: response.id,
        sectorId: response.sectorId,
        type: input.type,
        description: input.description,
        isAnonymous: input.anonymous,
        triggeredByLowScore: response.lowScore,
        receivedAt: now,
        idempotencyKey,
        requestHash,
      });
      if (!input.anonymous && input.contact !== undefined) {
        await insertContact(tx, {
          manifestationId: id,
          fullName: input.contact.fullName,
          phone: input.contact.phone ?? null,
          email: input.contact.email ?? null,
          consentGivenAt: now,
          purposeTextVersion: PURPOSE_TEXT_VERSION,
        });
      }
      await insertNotes(tx, [
        {
          id: randomUUID(),
          manifestationId: id,
          authorId: null,
          kind: 'created',
          content: null,
          fromValue: null,
          toValue: 'received',
          createdAt: now,
        },
      ]);
      return { protocol: await findProtocol(tx, id), receivedAt: now };
    });
    return {
      replayed: false,
      data: { protocol: created.protocol, receivedAt: created.receivedAt.toISOString() },
    };
  } catch (error) {
    if (
      error instanceof TokenAlreadyUsed ||
      isUniqueViolation(error, 'manifestations_idempotency_key_key') ||
      isUniqueViolation(error, 'manifestations_response_id_key')
    ) {
      return recover(error);
    }
    throw error;
  }
}
