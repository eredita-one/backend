import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import type { RequestMeta } from '../application/session.service.js';
import type { StaffApp } from '../domain/apps.js';
import { appOfPermission, type Permission } from '../domain/permissions.js';
import type {
  ClientPrincipal,
  Principal,
  StaffPrincipal,
} from '../domain/principal.js';

export const ACCESS_POLICY_KEY = 'accessPolicy';

/** Quem pode chamar a rota. Toda rota precisa de uma, ou de `@Public()`. */
export type AccessPolicy =
  | {
      realm: 'staff';
      apps: readonly StaffApp[];
      permissions?: { mode: 'all' | 'any'; keys: readonly Permission[] };
    }
  | { realm: 'client' };

export type AuthenticatedRequest = Request & { principal?: Principal };

const staffPolicy = (policy: Extract<AccessPolicy, { realm: 'staff' }>) =>
  applyDecorators(
    SetMetadata(ACCESS_POLICY_KEY, policy satisfies AccessPolicy),
    ApiBearerAuth('staff'),
  );

/**
 * Rota da equipe liberada para tokens de um dos apps listados, sem exigir permissão
 * específica (ex.: `/auth/staff/me`). Para funcionalidades, prefira `@Can()`.
 */
export const StaffApps = (...apps: [StaffApp, ...StaffApp[]]) =>
  staffPolicy({ realm: 'staff', apps });

function permissionPolicy(mode: 'all' | 'any', keys: readonly Permission[]) {
  const apps = [...new Set(keys.map(appOfPermission))];
  if (apps.length !== 1) {
    // Erro de programação: aparece ao subir a aplicação, não em produção.
    throw new Error(
      `@Can/@CanAny com permissões de apps diferentes: ${keys.join(', ')}`,
    );
  }
  return staffPolicy({ realm: 'staff', apps, permissions: { mode, keys } });
}

/**
 * Exige TODAS as permissões listadas. O app vem da própria permissão
 * (`admin.*` → app ADMIN), então `@Can` já barra token de outro app.
 *
 *   @Can('admin.commissions.view')
 */
export const Can = (...permissions: [Permission, ...Permission[]]) =>
  permissionPolicy('all', permissions);

/** Exige ao menos UMA das permissões listadas (todas do mesmo app). */
export const CanAny = (...permissions: [Permission, ...Permission[]]) =>
  permissionPolicy('any', permissions);

/** Rota do portal do cliente: só aceita tokens do domínio de clientes. */
export const ClientArea = () =>
  applyDecorators(
    SetMetadata(ACCESS_POLICY_KEY, { realm: 'client' } satisfies AccessPolicy),
    ApiBearerAuth('client'),
  );

const principalOf = (context: ExecutionContext) =>
  context.switchToHttp().getRequest<AuthenticatedRequest>().principal;

/** Usuário da equipe autenticado. Só em rotas com `@StaffApps()`, `@Can()` ou `@CanAny()`. */
export const CurrentStaff = createParamDecorator(
  (_: unknown, context: ExecutionContext): StaffPrincipal => {
    const principal = principalOf(context);
    if (principal?.realm !== 'staff') {
      throw new Error('@CurrentStaff() usado em rota sem política da equipe');
    }
    return principal;
  },
);

/** Cliente autenticado. Só em rotas com `@ClientArea()`. */
export const CurrentClient = createParamDecorator(
  (_: unknown, context: ExecutionContext): ClientPrincipal => {
    const principal = principalOf(context);
    if (principal?.realm !== 'client') {
      throw new Error('@CurrentClient() usado em rota sem @ClientArea()');
    }
    return principal;
  },
);

/** User-Agent e IP da requisição, gravados junto com o refresh token. */
export const ReqMeta = createParamDecorator(
  (_: unknown, context: ExecutionContext): RequestMeta => {
    const request = context.switchToHttp().getRequest<Request>();
    return {
      userAgent: request.headers['user-agent']?.slice(0, 255) ?? null,
      ip: request.ip ?? null,
    };
  },
);
