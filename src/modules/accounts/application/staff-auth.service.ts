import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountStore,
  appsOf,
  STAFF_ACCOUNTS,
  type StaffAccount,
} from '../domain/accounts.js';
import type { StaffApp } from '../domain/apps.js';
import { AuthErrors } from '../domain/auth-errors.js';
import { PasswordAuthenticator } from '../domain/password-authenticator.js';
import type { Permission } from '../domain/permissions.js';
import type { StaffPrincipal } from '../domain/principal.js';
import {
  type RefreshTokenStore,
  STAFF_REFRESH_TOKENS,
  type StaffTokenScope,
} from '../domain/refresh-tokens.js';
import {
  type RequestMeta,
  SessionService,
  type TokenPair,
} from './session.service.js';

type StaffLogin = {
  email: string;
  password: string;
  app: StaffApp;
  remember: boolean;
};

export type StaffProfile = {
  id: string;
  email: string;
  name: string;
  app: StaffApp;
  apps: StaffApp[];
  permissions: Permission[];
};

/** Login da equipe interna. A sessão é aberta para um único app. */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly authenticator: PasswordAuthenticator,
    private readonly sessions: SessionService,
    @Inject(STAFF_ACCOUNTS)
    private readonly accounts: AccountStore<StaffAccount>,
    @Inject(STAFF_REFRESH_TOKENS)
    private readonly refreshTokens: RefreshTokenStore<StaffTokenScope>,
  ) {}

  async login(
    input: StaffLogin,
    meta: RequestMeta,
  ): Promise<TokenPair & { user: StaffProfile }> {
    const user = await this.authenticator.authenticate(this.accounts, {
      realm: 'staff',
      email: input.email,
      password: input.password,
      authorize: (account) => {
        if (!account.access[input.app]) throw AuthErrors.appForbidden();
      },
    });

    const tokens = await this.sessions.open({
      realm: 'staff',
      store: this.refreshTokens,
      subjectId: user.id,
      audience: input.app,
      scope: { app: input.app },
      remember: input.remember,
      meta,
    });

    return { ...tokens, user: staffProfileOf(user, input.app) };
  }

  refresh(rawToken: string, meta: RequestMeta): Promise<TokenPair> {
    return this.sessions.refresh({
      realm: 'staff',
      store: this.refreshTokens,
      rawToken,
      meta,
      resolveAudience: async (record) => {
        const user = await this.accounts.findById(record.subjectId);
        const allowed =
          user?.status === 'ACTIVE' && user.access[record.app] !== undefined;
        return allowed ? record.app : null;
      },
    });
  }

  logout(rawToken: string): Promise<void> {
    return this.sessions.close(this.refreshTokens, rawToken);
  }
}

export function staffProfileOf(
  user: StaffAccount,
  app: StaffApp,
): StaffProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    app,
    apps: appsOf(user.access),
    permissions: user.access[app] ?? [],
  };
}

export function staffProfileFromPrincipal(
  principal: StaffPrincipal,
): StaffProfile {
  const { realm: _realm, ...profile } = principal;
  return profile;
}
