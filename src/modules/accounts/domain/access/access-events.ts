/** Eventos de domínio do contexto Contas que interessam à auditoria. */
export const AccessEventType = {
  STAFF_USER_CREATED: 'StaffUserCreated',
  STAFF_USER_DISABLED: 'StaffUserDisabled',
  STAFF_USER_ENABLED: 'StaffUserEnabled',
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

export type AuditQuery = { limit: number; subjectId?: string };

/** Trilha de auditoria: só acrescenta e lista, nunca altera. */
export interface AuditTrail {
  append(events: readonly AccessEvent[]): Promise<void>;
  list(query: AuditQuery): Promise<RecordedAccessEvent[]>;
}

export const AUDIT_TRAIL = Symbol('AUDIT_TRAIL');
