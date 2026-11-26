/**
 * Códigos de erro estáveis devolvidos no campo `code` de toda resposta de erro.
 * O front traduz pelo código (os apps têm 4 idiomas); `message` é só para log/debug.
 */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  BUSINESS_RULE: 'BUSINESS_RULE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_ACCOUNT_LOCKED: 'AUTH_ACCOUNT_LOCKED',
  AUTH_ACCOUNT_DISABLED: 'AUTH_ACCOUNT_DISABLED',
  /** Credenciais certas, mas o usuário não tem acesso ao app pedido. */
  AUTH_APP_FORBIDDEN: 'AUTH_APP_FORBIDDEN',
  AUTH_TOKEN_MISSING: 'AUTH_TOKEN_MISSING',
  AUTH_TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  AUTH_REFRESH_INVALID: 'AUTH_REFRESH_INVALID',
  /** Rota sem `@Public()`, `@StaffApps()`, `@Can()` ou `@ClientArea()`: negada por padrão. */
  AUTH_ACCESS_POLICY_MISSING: 'AUTH_ACCESS_POLICY_MISSING',
  /** Token válido e app certo, mas falta a permissão exigida pela rota (`details.required`). */
  AUTH_PERMISSION_DENIED: 'AUTH_PERMISSION_DENIED',

  // Gestão de acessos (perfis e usuários da equipe)
  ACCESS_PROFILE_NOT_FOUND: 'ACCESS_PROFILE_NOT_FOUND',
  STAFF_USER_NOT_FOUND: 'STAFF_USER_NOT_FOUND',
  /** Permissão fora do catálogo do app do perfil (`details.permissions`). */
  ACCESS_UNKNOWN_PERMISSION: 'ACCESS_UNKNOWN_PERMISSION',
  /** Quem age não tem as permissões que tenta conceder, revogar ou editar (`details.missing`). */
  ACCESS_ESCALATION_DENIED: 'ACCESS_ESCALATION_DENIED',
  /** Ninguém altera os próprios perfis nem o próprio status. */
  ACCESS_SELF_CHANGE_DENIED: 'ACCESS_SELF_CHANGE_DENIED',
  /** A mudança deixaria o sistema sem Administrador geral ativo. */
  ACCESS_LAST_GENERAL_ADMIN: 'ACCESS_LAST_GENERAL_ADMIN',
  ACCESS_SYSTEM_PROFILE_READONLY: 'ACCESS_SYSTEM_PROFILE_READONLY',
  ACCESS_PROFILE_IN_USE: 'ACCESS_PROFILE_IN_USE',
  ACCESS_PROFILE_NAME_TAKEN: 'ACCESS_PROFILE_NAME_TAKEN',
  STAFF_USER_EMAIL_TAKEN: 'STAFF_USER_EMAIL_TAKEN',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
