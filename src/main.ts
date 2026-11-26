import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { setupSwagger } from './config/swagger.js';
import { parseTrustProxy } from './config/trust-proxy.js';

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

  // O front (Next) chama a API do servidor e repassa o IP de quem está no navegador no
  // X-Forwarded-For. Sem confiar nele, todos os usuários teriam o IP do servidor do front:
  // o limite de tentativas de login seria um só para todo mundo.
  const trustProxy = parseTrustProxy(get('TRUST_PROXY'));
  if (trustProxy !== false) app.set('trust proxy', trustProxy);

  if (swaggerEnabled) setupSwagger(app);

  app.enableShutdownHooks();
  await app.listen(get('PORT'));
}

await bootstrap();
