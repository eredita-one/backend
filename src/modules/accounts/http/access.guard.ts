import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import {
  type AccountStore,
  appsOf,
  CLIENT_ACCOUNTS,
  type ClientAccount,
  STAFF_ACCOUNTS,
  type StaffAccount,
} from '../domain/accounts.js';
import { CLIENT_AUDIENCE } from '../domain/apps.js';
import { AuthErrors } from '../domain/auth-errors.js';
import type { ClientPrincipal, StaffPrincipal } from '../domain/principal.js';
import { AccessTokenService } from '../infrastructure/jwt-access-tokens.js';
import {
  ACCESS_POLICY_KEY,
  type AccessPolicy,
  type AuthenticatedRequest,
} from './access-policy.js';

type StaffPolicy = Extract<AccessPolicy, { realm: 'staff' }>;

/**
 * Guard global. Ordem das checagens:
 *   1. `@Public()` passa direto.
 *   2. Sem política (`@StaffApps`/`@Can`/`@CanAny`/`@ClientArea`), nega: esquecer o
 *      decorator não abre a rota.
 *   3. Valida o token com o segredo do domínio da rota (token de cliente não confere numa
 *      rota da equipe, e vice-versa).
 *   4. Rota da equipe: o app do token precisa estar entre os apps da rota.
 *   5. Relê a conta no banco: conta desativada, perfil removido ou permissão retirada
 *      valem na hora, sem esperar o token expirar.
 *   6. Confere as permissões exigidas pela rota.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    @Inject(STAFF_ACCOUNTS)
    private readonly staff: AccountStore<StaffAccount>,
    @Inject(CLIENT_ACCOUNTS)
    private readonly clients: AccountStore<ClientAccount>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(
      ACCESS_POLICY_KEY,
      targets,
    );
    if (!policy) {
      this.logger.error(
        `Rota sem política de acesso: ${context.getClass().name}.${context.getHandler().name}`,
      );
      throw AuthErrors.accessPolicyMissing();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearer(request);
    if (!token) throw AuthErrors.tokenMissing();

    const claims = await this.accessTokens.verify(policy.realm, token);
    if (!claims) throw AuthErrors.tokenInvalid();

    request.principal =
      policy.realm === 'staff'
        ? await this.staffPrincipal(policy, claims.sub, claims.aud)
        : await this.clientPrincipal(claims.sub, claims.aud);
    return true;
  }

  private async staffPrincipal(
    policy: StaffPolicy,
    userId: string,
    audience: string,
  ): Promise<StaffPrincipal> {
    const app = policy.apps.find((allowed) => allowed === audience);
    if (!app) throw AuthErrors.appForbidden();

    const user = await this.staff.findById(userId);
    const permissions = user?.access[app];
    if (!user || user.status !== 'ACTIVE' || !permissions) {
      throw AuthErrors.tokenInvalid();
    }

    if (policy.permissions) {
      const { mode, keys } = policy.permissions;
      const granted = new Set<string>(permissions);
      const allowed =
        mode === 'all'
          ? keys.every((key) => granted.has(key))
          : keys.some((key) => granted.has(key));
      if (!allowed) throw AuthErrors.permissionDenied(keys);
    }

    return {
      realm: 'staff',
      id: user.id,
      email: user.email,
      name: user.name,
      app,
      apps: appsOf(user.access),
      permissions,
    };
  }

  private async clientPrincipal(
    accountId: string,
    audience: string,
  ): Promise<ClientPrincipal> {
    if (audience !== CLIENT_AUDIENCE) throw AuthErrors.tokenInvalid();

    const account = await this.clients.findById(accountId);
    if (!account || account.status !== 'ACTIVE') {
      throw AuthErrors.tokenInvalid();
    }

    return {
      realm: 'client',
      id: account.id,
      email: account.email,
      name: account.name,
    };
  }

  private extractBearer(request: AuthenticatedRequest): string | null {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
