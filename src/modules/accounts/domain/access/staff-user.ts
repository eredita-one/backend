import type { AccountStatus } from '../accounts.js';
import type { AccessProfileRef } from './access-profile.js';
import { GENERAL_ADMIN_PROFILE_ID } from './access-profile.js';

/** Conta da equipe, do ponto de vista da gestão de acessos (sem credenciais). */
export type StaffUser = {
  id: string;
  email: string;
  name: string;
  status: AccountStatus;
  /** Ainda sem senha: o convite não foi aceito e a conta não consegue entrar. */
  invitePending: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  profiles: AccessProfileRef[];
};

export function hasProfile(user: StaffUser, profileId: string): boolean {
  return user.profiles.some((profile) => profile.id === profileId);
}

/** Administrador geral que consegue entrar de fato (ativo e com senha definida). */
export function isUsableGeneralAdmin(user: StaffUser): boolean {
  return (
    user.status === 'ACTIVE' &&
    !user.invitePending &&
    hasProfile(user, GENERAL_ADMIN_PROFILE_ID)
  );
}
