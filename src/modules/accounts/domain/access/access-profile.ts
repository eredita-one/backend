import type { StaffApp } from '../apps.js';
import type { Permission } from '../permissions.js';
import { permissionsOfApp } from '../permissions.js';

/** Perfil de acesso: pertence a um app e reúne permissões do catálogo desse app. */
export type AccessProfile = {
  id: string;
  app: StaffApp;
  name: string;
  description: string | null;
  /** Perfil do sistema: não pode ser editado nem apagado. */
  isSystem: boolean;
  permissions: Permission[];
};

/** Referência curta a um perfil, como aparece na conta do usuário. */
export type AccessProfileRef = Pick<AccessProfile, 'id' | 'app' | 'name'>;

/** Id fixo: permite travar a linha dele nas transações e achá-lo sem consulta por nome. */
export const GENERAL_ADMIN_PROFILE_ID = '00000000-0000-4000-8000-000000000001';

/**
 * "Administrador geral": todas as permissões do admin, sempre. Ao subir, a aplicação
 * sincroniza esse perfil com o catálogo (permissão nova no código entra nele sozinha).
 */
export function generalAdminProfile(): AccessProfile {
  return {
    id: GENERAL_ADMIN_PROFILE_ID,
    app: 'ADMIN',
    name: 'Administrador geral',
    description:
      'Perfil do sistema com todas as permissões do admin. Não pode ser editado nem apagado.',
    isSystem: true,
    // Ordenadas, como em qualquer perfil lido do armazenamento.
    permissions: permissionsOfApp('ADMIN').sort(),
  };
}
