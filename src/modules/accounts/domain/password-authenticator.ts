import { Inject, Injectable } from '@nestjs/common';
import {
  AccessEventType,
  AUDIT_TRAIL,
  type AuditTrail,
} from './access/access-events.js';
import type { Account, AccountStore } from './accounts.js';
import type { Realm } from './apps.js';
import { AUTH_CONFIG, type AuthConfig } from './auth-config.js';
import { AuthErrors } from './auth-errors.js';
import { CLOCK, type Clock } from './clock.js';
import { PasswordHasher } from './password-hasher.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type AuthenticateInput<T extends Account> = {
  realm: Realm;
  email: string;
  password: string;
  /**
   * Regra extra do domínio, avaliada só depois de a senha conferir (ex.: o usuário tem
   * acesso ao app pedido?). Deve lançar para recusar; nesse caso o login não é registrado.
   */
  authorize?: (account: T) => void;
};

/** Confere e-mail e senha, com bloqueio após falhas seguidas. Igual para os dois domínios. */
@Injectable()
export class PasswordAuthenticator {
  constructor(
    private readonly hasher: PasswordHasher,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  async authenticate<T extends Account>(
    store: AccountStore<T>,
    input: AuthenticateInput<T>,
  ): Promise<T> {
    const now = this.clock.now();
    const account = await store.findByEmail(normalizeEmail(input.email));

    // Durante o bloqueio a senha nem é conferida: senão o bloqueio não impediria tentativas.
    if (account?.lockedUntil && account.lockedUntil > now) {
      const seconds = Math.ceil(
        (account.lockedUntil.getTime() - now.getTime()) / 1000,
      );
      throw AuthErrors.accountLocked(seconds);
    }

    const valid = await this.hasher.verify(
      input.password,
      account?.passwordHash,
    );
    if (!account || !valid) {
      if (account)
        await this.registerFailure(store, input.realm, account.id, now);
      throw AuthErrors.invalidCredentials();
    }

    if (account.status !== 'ACTIVE') throw AuthErrors.accountDisabled();

    input.authorize?.(account);

    await store.recordSuccessfulLogin(account.id, now);
    return account;
  }

  private async registerFailure<T extends Account>(
    store: AccountStore<T>,
    realm: Realm,
    accountId: string,
    now: Date,
  ) {
    const failures = await store.incrementFailedLogins(accountId);
    if (failures < this.config.maxFailedLogins) return;

    const until = new Date(now.getTime() + this.config.lockDurationMs);
    await store.lock(accountId, until);
    await this.audit.append([
      {
        type: AccessEventType.ACCOUNT_LOCKED,
        actorId: null,
        subjectType: realm === 'staff' ? 'staff_user' : 'client_account',
        subjectId: accountId,
        data: { until: until.toISOString(), failures },
        occurredAt: now,
      },
    ]);
  }
}
