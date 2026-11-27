/** Eventos de domínio do contexto Contas que interessam à auditoria. */
export const AccessEventType = {
  STAFF_USER_CREATED: 'StaffUserCreated',
  STAFF_USER_DISABLED: 'StaffUserDisabled',
  STAFF_USER_ENABLED: 'StaffUserEnabled',
  /** Nome ou e-mail alterado pelo admin (`data.name` / `data.email`: `{ from, to }`). */
  STAFF_USER_UPDATED: 'StaffUserUpdated',
  /** Senha definida pelo admin: as sessões da pessoa são encerradas. */
  STAFF_USER_PASSWORD_RESET: 'StaffUserPasswordReset',
  /** A própria pessoa trocou a senha (equipe ou cliente): as outras sessões são encerradas. */
  PASSWORD_CHANGED: 'PasswordChanged',
  ACCESS_PROFILE_GRANTED: 'AccessProfileGranted',
  ACCESS_PROFILE_REVOKED: 'AccessProfileRevoked',
  ACCESS_PROFILE_CREATED: 'AccessProfileCreated',
  ACCESS_PROFILE_UPDATED: 'AccessProfileUpdated',
  ACCESS_PROFILE_DELETED: 'AccessProfileDeleted',
  SYSTEM_PROFILE_SYNCED: 'SystemProfileSynced',
  ACCOUNT_LOCKED: 'AccountLocked',
  SESSION_REUSE_DETECTED: 'SessionReuseDetected',
} as const;

export type AccessEventType =
  (typeof AccessEventType)[keyof typeof AccessEventType];

export type AuditSubjectType =
  'staff_user' | 'client_account' | 'access_profile';

export type AccessEvent = {
  type: AccessEventType;
  /** Quem fez; `null` quando foi o sistema (sincronização, bloqueio automático). */
  actorId: string | null;
  subjectType: AuditSubjectType;
  subjectId: string;
  data: Record<string, unknown>;
  occurredAt: Date;
};

export type RecordedAccessEvent = AccessEvent & { id: string };

export type AuditQuery = {
  /** Começa em 1. */
  page: number;
  pageSize: number;
  /** `desc`: mais recentes primeiro. */
  order: 'desc' | 'asc';
  /** Só eventos sobre este usuário, cliente ou perfil. */
  subjectId?: string;
  /** Eventos em que a pessoa aparece: quem fez OU sobre quem. */
  personId?: string;
  type?: AccessEventType;
  /** Nome ou e-mail de quem fez ou sobre quem, ou nome do perfil (sem diferenciar maiúsculas). */
  search?: string;
  /** Período: `from` inclusivo, `until` exclusivo. */
  from?: Date;
  until?: Date;
};

export type AuditPage = { items: RecordedAccessEvent[]; total: number };

/** Trilha de auditoria: só acrescenta e lista, nunca altera. */
export interface AuditTrail {
  append(events: readonly AccessEvent[]): Promise<void>;
  list(query: AuditQuery): Promise<AuditPage>;
}

export const AUDIT_TRAIL = Symbol('AUDIT_TRAIL');
