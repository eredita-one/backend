import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const AUTH_RATE_LIMIT_KEY = 'authRateLimit';

/** Aplica o limite `auth` (por IP) à rota. Use em login, refresh e logout. */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

const reflector = new Reflector();

/** `skipIf` do throttler `auth`: só conta as rotas marcadas com `@AuthRateLimit()`. */
export const isNotAuthRateLimited = (context: ExecutionContext): boolean =>
  !reflector.get<boolean | undefined>(
    AUTH_RATE_LIMIT_KEY,
    context.getHandler(),
  );
