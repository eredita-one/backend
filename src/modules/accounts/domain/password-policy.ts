import { AuthErrors } from './auth-errors.js';

/**
 * Regra de senha nova (definida pelo admin ou trocada pela própria pessoa). Só tamanho,
 * sem regra de símbolos (NIST 800-63B). O mínimo de 6 é decisão do negócio (o NIST sugere
 * 8); o bloqueio por tentativas e o limite por IP compensam. O máximo evita gastar argon2
 * com entradas enormes.
 */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function assertPasswordPolicy(password: string): void {
  // Conta o que a pessoa vê como um caractere ("ç", um emoji), não unidades UTF-16.
  const length = [...graphemes.segment(password)].length;
  if (
    password.trim().length === 0 ||
    length < PASSWORD_MIN_LENGTH ||
    length > PASSWORD_MAX_LENGTH
  ) {
    throw AuthErrors.passwordWeak(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH);
  }
}
