import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Documentação em /docs (JSON em /docs-json). Ligada por `SWAGGER_ENABLED`. */
export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('api-backend')
    .setDescription(
      'Login e controle de acesso. Tokens da equipe interna (esquema "staff") e do ' +
        'portal do cliente (esquema "client") são assinados com segredos diferentes.',
    )
    .setVersion('1.0')
    .addBearerAuth(undefined, 'staff')
    .addBearerAuth(undefined, 'client')
    .build();

  SwaggerModule.setup('docs', app, () =>
    SwaggerModule.createDocument(app, config),
  );
}
