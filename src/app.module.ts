import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { HealthController } from './common/health/health.controller.js';
import { RequestLoggerMiddleware } from './common/http/request-logger.middleware.js';
import { createValidationPipe } from './common/pipes/validation.pipe.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { type Env, validateEnv } from './config/env.js';
import {
  AccountsModule,
  isNotAuthRateLimited,
} from './modules/accounts/index.js';

const MINUTE_MS = 60_000;

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // Nos testes, só valem as variáveis de test/support/test-env.ts.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          // Teto geral por IP, para qualquer rota.
          { name: 'default', ttl: MINUTE_MS, limit: 300 },
          // Teto apertado só nas rotas marcadas com @AuthRateLimit() (login, refresh, logout).
          {
            name: 'auth',
            ttl: MINUTE_MS,
            limit: config.get('AUTH_RATE_LIMIT_PER_MINUTE', { infer: true }),
            skipIf: isNotAuthRateLimited,
          },
        ],
      }),
    }),
    PrismaModule,
    AccountsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('{*path}');
  }
}
