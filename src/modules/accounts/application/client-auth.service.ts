import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountStore,
  CLIENT_ACCOUNTS,
  type ClientAccount,
} from '../domain/accounts.js';
import { CLIENT_AUDIENCE } from '../domain/apps.js';
import { PasswordAuthenticator } from '../domain/password-authenticator.js';
import type { ClientPrincipal } from '../domain/principal.js';
import {
  CLIENT_REFRESH_TOKENS,
  type ClientTokenScope,
  type RefreshTokenStore,
} from '../domain/refresh-tokens.js';
import { OwnPasswordService } from './own-password.service.js';
import {
  type RequestMeta,
  SessionService,
  type TokenPair,
} from './session.service.js';

type ClientLogin = { email: string; password: string; remember: boolean };

export type ClientProfile = { id: string; email: string; name: string };

/** Login do portal do cliente. Usa só `client_accounts`: não enxerga a equipe. */
@Injectable()
export class ClientAuthService {
  constructor(
    private readonly authenticator: PasswordAuthenticator,
    private readonly sessions: SessionService,
    private readonly ownPassword: OwnPasswordService,
    @Inject(CLIENT_ACCOUNTS)
    private readonly accounts: AccountStore<ClientAccount>,
    @Inject(CLIENT_REFRESH_TOKENS)
    private readonly refreshTokens: RefreshTokenStore<ClientTokenScope>,
  ) {}

  async login(
    input: ClientLogin,
    meta: RequestMeta,
  ): Promise<TokenPair & { client: ClientProfile }> {
    const account = await this.authenticator.authenticate(this.accounts, {
      realm: 'client',
      email: input.email,
      password: input.password,
    });

    const tokens = await this.sessions.open({
      realm: 'client',
      store: this.refreshTokens,
      subjectId: account.id,
      audience: CLIENT_AUDIENCE,
      scope: {},
      remember: input.remember,
      meta,
    });

    return { ...tokens, client: clientProfileOf(account) };
  }

  refresh(rawToken: string, meta: RequestMeta): Promise<TokenPair> {
    return this.sessions.refresh({
      realm: 'client',
      store: this.refreshTokens,
      rawToken,
      meta,
      resolveAudience: async (record) => {
        const account = await this.accounts.findById(record.subjectId);
        return account?.status === 'ACTIVE' ? CLIENT_AUDIENCE : null;
      },
    });
  }

  logout(rawToken: string): Promise<void> {
    return this.sessions.close(this.refreshTokens, rawToken);
  }

  /** O cliente troca a própria senha; a sessão de `currentRefreshToken` continua aberta. */
  changePassword(
    accountId: string,
    input: {
      currentPassword: string;
      newPassword: string;
      currentRefreshToken?: string;
    },
  ): Promise<void> {
    return this.ownPassword.change({
      realm: 'client',
      accounts: this.accounts,
      refreshTokens: this.refreshTokens,
      accountId,
      ...input,
    });
  }
}

export function clientProfileOf(
  account: ClientAccount | ClientPrincipal,
): ClientProfile {
  return { id: account.id, email: account.email, name: account.name };
}
