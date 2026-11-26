import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { AccessEventType } from '../domain/access/access-events.js';
import { generalAdminProfile } from '../domain/access/access-profile.js';
import {
  ACCESS_UNIT_OF_WORK,
  type AccessUnitOfWork,
} from '../domain/access/access-repository.js';
import { CLOCK, type Clock } from '../domain/clock.js';

/**
 * Mantém o perfil "Administrador geral" igual ao catálogo do código: ao subir, cria o
 * perfil se não existir e acrescenta permissões novas. Assim, uma área nova do sistema
 * já nasce acessível a quem administra, sem passo manual de deploy.
 */
@Injectable()
export class SystemProfileSync implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemProfileSync.name);

  constructor(
    @Inject(ACCESS_UNIT_OF_WORK) private readonly uow: AccessUnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.sync();
    } catch (error) {
      // Não derruba a API: o perfil existente continua valendo até a próxima subida.
      this.logger.error(
        'Não foi possível sincronizar o perfil Administrador geral',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  sync() {
    return this.uow.transaction(async (repo) => {
      const expected = generalAdminProfile();
      const current = await repo.findProfile(expected.id);
      const now = this.clock.now();

      if (!current) {
        await repo.insertProfile(expected);
        await repo.appendEvents([
          {
            type: AccessEventType.ACCESS_PROFILE_CREATED,
            actorId: null,
            subjectType: 'access_profile',
            subjectId: expected.id,
            data: {
              app: expected.app,
              name: expected.name,
              permissions: expected.permissions,
            },
            occurredAt: now,
          },
        ]);
        return;
      }

      const added = expected.permissions.filter(
        (p) => !current.permissions.includes(p),
      );
      const removed = current.permissions.filter(
        (p) => !expected.permissions.includes(p),
      );
      if (
        added.length === 0 &&
        removed.length === 0 &&
        current.name === expected.name
      ) {
        return;
      }

      await repo.updateProfile(expected);
      await repo.appendEvents([
        {
          type: AccessEventType.SYSTEM_PROFILE_SYNCED,
          actorId: null,
          subjectType: 'access_profile',
          subjectId: expected.id,
          data: { added, removed },
          occurredAt: now,
        },
      ]);
    });
  }
}
