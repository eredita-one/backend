export const CLOCK = Symbol('CLOCK');

/** Relógio injetável: os testes avançam o tempo sem esperar (bloqueio, expiração). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
