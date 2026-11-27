import { Inject, Injectable } from '@nestjs/common';
import { AccessEventType } from '../domain/access/access-events.js';
import type { Account, AccountStore } from '../domain/accounts.js';
import type { Realm } from '../domain/apps.js';
import { AuthErrors } from '../domain/auth-errors.js';
import { CLOCK, type Clock } from '../domain/clock.js';
import { PasswordAuthenticator } from '../domain/password-authenticator.js';
import { PasswordHasher } from '../domain/password-hasher.js';
import { assertPasswordPolicy } from '../domain/password-policy.js';
import {
  hashRefreshToken,
  type RefreshTokenStore,
} from '../domain/refresh-tokens.js';

type ChangeOwnPassword<T extends Account, TScope extends object> = {
  realm: Realm;
  accounts: AccountStore<T>;
  refreshTokens: RefreshTokenStore<TScope>;
  accountId: string;
  currentPassword: string;
  newPassword: string;
  /** Refresh token da sessão atual: ela continua aberta, as outras são encerradas. */
  currentRefreshToken?: string;
};

/**
 * Troca da própria senha, igual nos dois domínios (equipe e cliente): confirma a senha
 * atual (com as regras de bloqueio do login), aplica a regra de senha, grava e encerra as
 * outras sessões. Quem precisa trocar a senha de outra pessoa é a gestão de acessos.
 */
@Injectable()
export class OwnPasswordService {
  constructor(
    private readonly authenticator: PasswordAuthenticator,
    private readonly hasher: PasswordHasher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async change<T extends Account, TScope extends object>(
    input: ChangeOwnPassword<T, TScope>,
  ): Promise<void> {
    const account = await input.accounts.findById(input.accountId);
    // Conta apagada ou desativada depois do login: o token não vale mais para isto.
    if (!account || account.status !== 'ACTIVE')
      throw AuthErrors.tokenInvalid();

    assertPasswordPolicy(input.newPassword);
    await this.authenticator.confirmCurrentPassword(
      input.accounts,
      input.realm,
      account,
      input.currentPassword,
    );
    if (await this.hasher.verify(input.newPassword, account.passwordHash)) {
      throw AuthErrors.passwordUnchanged();
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    const now = this.clock.now();
    await input.accounts.changePassword({
      accountId: account.id,
      passwordHash,
      at: now,
      keepSessionId: await this.currentSession(input),
      event: {
        type: AccessEventType.PASSWORD_CHANGED,
        actorId: account.id,
        subjectType: input.realm === 'staff' ? 'staff_user' : 'client_account',
        subjectId: account.id,
        data: { otherSessionsRevoked: true },
        occurredAt: now,
      },
    });
  }

  /** Sessão (família) do refresh token informado, se for desta conta. */
  private async currentSession<T extends Account, TScope extends object>(
    input: ChangeOwnPassword<T, TScope>,
  ): Promise<string | null> {
    if (!input.currentRefreshToken) return null;
    const record = await input.refreshTokens.findByHash(
      hashRefreshToken(input.currentRefreshToken),
    );
    return record?.subjectId === input.accountId ? record.familyId : null;
  }
}
