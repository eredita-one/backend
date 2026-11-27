import type { AppException } from '../../../common/exceptions/app.exception.js';
import {
  assertPasswordPolicy,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './password-policy.js';

function outcome(password: string) {
  try {
    assertPasswordPolicy(password);
    return 'OK';
  } catch (error) {
    return (error as AppException).code;
  }
}

describe('Regra de senha', () => {
  it('aceita do mínimo ao máximo de caracteres', () => {
    expect(outcome('a'.repeat(PASSWORD_MIN_LENGTH))).toBe('OK');
    expect(outcome('a'.repeat(PASSWORD_MAX_LENGTH))).toBe('OK');
  });

  it('recusa curta, longa ou só de espaços, dizendo os limites', () => {
    expect(outcome('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      'AUTH_PASSWORD_WEAK',
    );
    expect(outcome('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
      'AUTH_PASSWORD_WEAK',
    );
    expect(outcome(' '.repeat(PASSWORD_MIN_LENGTH + 2))).toBe(
      'AUTH_PASSWORD_WEAK',
    );
    try {
      assertPasswordPolicy('curta');
    } catch (error) {
      expect((error as AppException).details).toEqual({
        minLength: PASSWORD_MIN_LENGTH,
        maxLength: PASSWORD_MAX_LENGTH,
      });
    }
  });

  it('conta o que a pessoa vê como caractere, não unidades UTF-16', () => {
    // 9 emojis de família têm dezenas de unidades UTF-16, mas são 9 caracteres.
    expect(outcome('👨‍👩‍👧'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(
      'AUTH_PASSWORD_WEAK',
    );
    expect(outcome('çãõ'.repeat(4))).toBe('OK');
  });
});
