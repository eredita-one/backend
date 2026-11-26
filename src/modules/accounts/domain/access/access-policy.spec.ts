import type { AppException } from '../../../../common/exceptions/app.exception.js';
import { permissionsOfApp } from '../permissions.js';
import {
  type AccessActor,
  planGrant,
  planProfileCreation,
  planProfileDeletion,
  planProfileUpdate,
  planRevoke,
  planStatusChange,
  planUserCreation,
} from './access-policy.js';
import { type AccessProfile, generalAdminProfile } from './access-profile.js';
import type { StaffUser } from './staff-user.js';

const now = new Date('2026-11-25T12:00:00Z');

const generalAdmin = generalAdminProfile();
const operations: AccessProfile = {
  id: 'p-ops',
  app: 'ADMIN',
  name: 'Operações',
  description: null,
  isSystem: false,
  permissions: ['admin.clients.view', 'admin.requests.handle'],
};
const consultor: AccessProfile = {
  id: 'p-cons',
  app: 'CONSULTOR',
  name: 'Consultor',
  description: null,
  isSystem: false,
  permissions: ['consultor.portfolio.view'],
};

const actor = (id: string, permissions: string[]): AccessActor => ({
  id,
  permissions: new Set(permissions),
});
/** Tem tudo do admin (como o Administrador geral). */
const superAdmin = actor('admin', permissionsOfApp('ADMIN'));
/** Gerencia usuários e tem as permissões de Operações, mas não as demais. */
const usersManager = actor('rh', [
  'admin.access.users.manage',
  'admin.clients.view',
  'admin.requests.handle',
]);
/** Só gerencia o app Consultor. */
const networkManager = actor('rede', ['admin.access.consultor.manage']);

const ref = ({ id, app, name }: AccessProfile) => ({ id, app, name });
const user = (overrides: Partial<StaffUser> = {}): StaffUser => ({
  id: 'u1',
  email: 'u1@eredita.test',
  name: 'U1',
  status: 'ACTIVE',
  invitePending: false,
  lastLoginAt: null,
  createdAt: now,
  profiles: [],
  ...overrides,
});

/** Executa e devolve o código do erro (ou 'OK'). */
function outcome(fn: () => unknown): string {
  try {
    fn();
    return 'OK';
  } catch (error) {
    return (error as AppException).code;
  }
}

function details(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return (error as AppException).details;
  }
  throw new Error('esperava erro');
}

describe('Política de acesso', () => {
  describe('conceder e revogar perfis', () => {
    it('concede quem tem a permissão de gestão e todas as permissões do perfil', () => {
      const events = planGrant(usersManager, user(), operations, now);
      expect(events).toEqual([
        {
          type: 'AccessProfileGranted',
          actorId: 'rh',
          subjectType: 'staff_user',
          subjectId: 'u1',
          data: { profileId: 'p-ops', profileName: 'Operações', app: 'ADMIN' },
          occurredAt: now,
        },
      ]);
    });

    it('não concede perfil com permissões que quem age não tem', () => {
      const grant = () => planGrant(usersManager, user(), generalAdmin, now);
      expect(outcome(grant)).toBe('ACCESS_ESCALATION_DENIED');
      expect(details(grant)).toMatchObject({
        missing: expect.arrayContaining([
          'admin.commissions.view',
          'admin.access.audit.view',
        ]),
      });
    });

    it('perfis de outro app pedem só a permissão de gestão daquele app', () => {
      expect(
        outcome(() => planGrant(networkManager, user(), consultor, now)),
      ).toBe('OK');
      expect(
        outcome(() => planGrant(networkManager, user(), operations, now)),
      ).toBe('ACCESS_ESCALATION_DENIED');
      expect(
        outcome(() => planGrant(usersManager, user(), consultor, now)),
      ).toBe('ACCESS_ESCALATION_DENIED');
    });

    it('ninguém altera o próprio acesso, nem o administrador geral', () => {
      expect(
        outcome(() =>
          planGrant(superAdmin, user({ id: 'admin' }), consultor, now),
        ),
      ).toBe('ACCESS_SELF_CHANGE_DENIED');
      expect(
        outcome(() =>
          planRevoke(
            superAdmin,
            user({ id: 'admin', profiles: [ref(generalAdmin)] }),
            generalAdmin,
            5,
            now,
          ),
        ),
      ).toBe('ACCESS_SELF_CHANGE_DENIED');
    });

    it('conceder o que já tem ou revogar o que não tem não gera evento', () => {
      expect(
        planGrant(
          usersManager,
          user({ profiles: [ref(operations)] }),
          operations,
          now,
        ),
      ).toEqual([]);
      expect(planRevoke(usersManager, user(), operations, 1, now)).toEqual([]);
    });

    it('não revoga o último Administrador geral que consegue entrar', () => {
      const holder = user({ profiles: [ref(generalAdmin)] });
      expect(
        outcome(() => planRevoke(superAdmin, holder, generalAdmin, 1, now)),
      ).toBe('ACCESS_LAST_GENERAL_ADMIN');
      expect(
        outcome(() => planRevoke(superAdmin, holder, generalAdmin, 2, now)),
      ).toBe('OK');
    });

    it('revogar de quem não consegue entrar (convite pendente) não conta como último', () => {
      const pending = user({
        invitePending: true,
        profiles: [ref(generalAdmin)],
      });
      expect(
        outcome(() => planRevoke(superAdmin, pending, generalAdmin, 1, now)),
      ).toBe('OK');
    });
  });

  describe('ativar e desativar usuários', () => {
    it('não age sobre quem tem mais poder', () => {
      const boss = user({ profiles: [ref(generalAdmin)] });
      expect(
        outcome(() =>
          planStatusChange(
            usersManager,
            boss,
            [generalAdmin],
            'DISABLED',
            3,
            now,
          ),
        ),
      ).toBe('ACCESS_ESCALATION_DENIED');
    });

    it('exige gestão de usuários mesmo para quem não tem perfil', () => {
      expect(
        outcome(() =>
          planStatusChange(networkManager, user(), [], 'DISABLED', 1, now),
        ),
      ).toBe('ACCESS_ESCALATION_DENIED');
    });

    it('não desativa o último Administrador geral', () => {
      const holder = user({ profiles: [ref(generalAdmin)] });
      expect(
        outcome(() =>
          planStatusChange(
            superAdmin,
            holder,
            [generalAdmin],
            'DISABLED',
            1,
            now,
          ),
        ),
      ).toBe('ACCESS_LAST_GENERAL_ADMIN');
    });

    it('é idempotente e registra o evento certo', () => {
      expect(
        planStatusChange(superAdmin, user(), [], 'ACTIVE', 1, now),
      ).toEqual([]);
      expect(
        planStatusChange(superAdmin, user(), [], 'DISABLED', 1, now),
      ).toMatchObject([
        { type: 'StaffUserDisabled', actorId: 'admin', subjectId: 'u1' },
      ]);
    });
  });

  describe('criar usuário', () => {
    it('registra a criação e cada perfil inicial', () => {
      const events = planUserCreation(
        usersManager,
        { id: 'u9', email: 'n@x', name: 'N' },
        [operations],
        now,
      );
      expect(events.map((e) => e.type)).toEqual([
        'StaffUserCreated',
        'AccessProfileGranted',
      ]);
    });

    it('perfis iniciais seguem a mesma regra de autoridade', () => {
      expect(
        outcome(() =>
          planUserCreation(
            usersManager,
            { id: 'u9', email: 'n@x', name: 'N' },
            [generalAdmin],
            now,
          ),
        ),
      ).toBe('ACCESS_ESCALATION_DENIED');
    });
  });

  describe('definir perfis', () => {
    const profilesManager = actor('gp', [
      'admin.access.profiles.manage',
      'admin.clients.view',
    ]);

    it('só aceita permissões do catálogo do app do perfil', () => {
      const create = () =>
        planProfileCreation(
          superAdmin,
          {
            id: 'p1',
            app: 'ADMIN',
            name: 'X',
            description: null,
            permissions: ['consultor.team.view', 'nao.existe'],
          },
          now,
        );
      expect(outcome(create)).toBe('ACCESS_UNKNOWN_PERMISSION');
      expect(details(create)).toEqual({
        app: 'ADMIN',
        permissions: ['consultor.team.view', 'nao.existe'],
      });
    });

    it('não cria perfil do admin com permissão que quem age não tem', () => {
      expect(
        outcome(() =>
          planProfileCreation(
            profilesManager,
            {
              id: 'p1',
              app: 'ADMIN',
              name: 'Fin',
              description: null,
              permissions: ['admin.commissions.view'],
            },
            now,
          ),
        ),
      ).toBe('ACCESS_ESCALATION_DENIED');
    });

    it('para editar, precisa ter também as permissões que vai remover', () => {
      // `operations` tem admin.requests.handle, que profilesManager não tem.
      expect(
        outcome(() =>
          planProfileUpdate(
            profilesManager,
            operations,
            { permissions: ['admin.clients.view'] },
            now,
          ),
        ),
      ).toBe('ACCESS_ESCALATION_DENIED');
    });

    it('registra só o que mudou', () => {
      const { events } = planProfileUpdate(
        superAdmin,
        operations,
        {
          name: 'Atendimento',
          permissions: ['admin.clients.view', 'admin.relocation.view'],
        },
        now,
      );
      expect(events).toMatchObject([
        {
          type: 'AccessProfileUpdated',
          data: {
            name: { from: 'Operações', to: 'Atendimento' },
            added: ['admin.relocation.view'],
            removed: ['admin.requests.handle'],
          },
        },
      ]);
      expect(
        planProfileUpdate(superAdmin, operations, { name: 'Operações' }, now)
          .events,
      ).toEqual([]);
    });

    it('perfil do sistema não é editado nem apagado', () => {
      expect(
        outcome(() =>
          planProfileUpdate(superAdmin, generalAdmin, { name: 'X' }, now),
        ),
      ).toBe('ACCESS_SYSTEM_PROFILE_READONLY');
      expect(
        outcome(() => planProfileDeletion(superAdmin, generalAdmin, 0, now)),
      ).toBe('ACCESS_SYSTEM_PROFILE_READONLY');
    });

    it('perfil em uso não é apagado', () => {
      expect(
        outcome(() => planProfileDeletion(superAdmin, operations, 2, now)),
      ).toBe('ACCESS_PROFILE_IN_USE');
      expect(
        outcome(() => planProfileDeletion(superAdmin, operations, 0, now)),
      ).toBe('OK');
    });
  });
});
