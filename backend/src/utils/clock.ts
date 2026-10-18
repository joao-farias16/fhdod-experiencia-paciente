/** Relógio injetável, para que regras dependentes de data sejam testáveis (Seção 7). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};
