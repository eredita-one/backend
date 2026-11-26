import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Client do Prisma (PostgreSQL, driver `pg`). A conexão abre na primeira consulta.
 * Só loga avisos e erros: query com parâmetros vazaria hash de senha e dados pessoais.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg(config.get('DATABASE_URL', { infer: true })),
      log: ['warn', 'error'],
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
