import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { setupSwagger } from './config/swagger.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const get = <K extends keyof Env>(key: K) => config.get(key, { infer: true });

  const swaggerEnabled = get('SWAGGER_ENABLED');
  // A API só devolve JSON; a CSP padrão do helmet bloquearia os scripts da página do Swagger.
  app.use(
    helmet({ contentSecurityPolicy: swaggerEnabled ? false : undefined }),
  );

  const origins = get('CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : false });

  // Atrás de proxy reverso, o IP real (usado no limite de tentativas) vem do X-Forwarded-For.
  const trustProxy = get('TRUST_PROXY');
  if (trustProxy > 0) app.set('trust proxy', trustProxy);

  if (swaggerEnabled) setupSwagger(app);

  app.enableShutdownHooks();
  await app.listen(get('PORT'));
}

await bootstrap();
