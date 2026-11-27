import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../../common/exceptions/app.exception.js';
import { ErrorCode } from '../../../common/exceptions/error-codes.js';

/** Erros de login e de acesso às rotas. */
export const AuthErrors = {
  /** E-mail inexistente, senha errada ou convite ainda não aceito: sempre a mesma resposta. */
  invalidCredentials: () =>
    new AppException(
      ErrorCode.AUTH_INVALID_CREDENTIALS,
      HttpStatus.UNAUTHORIZED,
      'Invalid email or password',
    ),

  accountLocked: (retryAfterSeconds: number) =>
    new AppException(
      ErrorCode.AUTH_ACCOUNT_LOCKED,
      HttpStatus.TOO_MANY_REQUESTS,
      'Account temporarily locked after too many failed attempts',
      { retryAfterSeconds },
    ),

  accountDisabled: () =>
    new AppException(
      ErrorCode.AUTH_ACCOUNT_DISABLED,
      HttpStatus.FORBIDDEN,
      'Account disabled',
    ),

  appForbidden: () =>
    new AppException(
      ErrorCode.AUTH_APP_FORBIDDEN,
      HttpStatus.FORBIDDEN,
      'User has no access to this app',
    ),

  permissionDenied: (required: readonly string[]) =>
    new AppException(
      ErrorCode.AUTH_PERMISSION_DENIED,
      HttpStatus.FORBIDDEN,
      'Missing permission for this action',
      { required },
    ),

  tokenMissing: () =>
    new AppException(
      ErrorCode.AUTH_TOKEN_MISSING,
      HttpStatus.UNAUTHORIZED,
      'Bearer token required',
    ),

  tokenInvalid: () =>
    new AppException(
      ErrorCode.AUTH_TOKEN_INVALID,
      HttpStatus.UNAUTHORIZED,
      'Invalid or expired access token',
    ),

  refreshInvalid: () =>
    new AppException(
      ErrorCode.AUTH_REFRESH_INVALID,
      HttpStatus.UNAUTHORIZED,
      'Invalid or expired refresh token',
    ),

  currentPasswordInvalid: () =>
    new AppException(
      ErrorCode.AUTH_CURRENT_PASSWORD_INVALID,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Current password does not match',
    ),

  passwordWeak: (minLength: number, maxLength: number) =>
    new AppException(
      ErrorCode.AUTH_PASSWORD_WEAK,
      HttpStatus.UNPROCESSABLE_ENTITY,
      `Password must have between ${minLength} and ${maxLength} characters`,
      { minLength, maxLength },
    ),

  passwordUnchanged: () =>
    new AppException(
      ErrorCode.AUTH_PASSWORD_UNCHANGED,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'New password must differ from the current one',
    ),

  accessPolicyMissing: () =>
    new AppException(
      ErrorCode.AUTH_ACCESS_POLICY_MISSING,
      HttpStatus.FORBIDDEN,
      'Route has no access policy',
    ),
};
