import type { StaffApp } from './apps.js';
import type { Permission } from './permissions.js';

/**
 * Quem está chamando a rota. É o que o contexto Contas entrega aos outros contextos:
 * identidade e permissões, nunca a entidade da conta.
 */
export type StaffPrincipal = {
  realm: 'staff';
  id: string;
  email: string;
  name: string;
  /** App do token atual. */
  app: StaffApp;
  /** Todos os apps que o usuário pode acessar. */
  apps: StaffApp[];
  /** Permissões do usuário no app atual. */
  permissions: Permission[];
};

export type ClientPrincipal = {
  realm: 'client';
  id: string;
  email: string;
  name: string;
};

export type Principal = StaffPrincipal | ClientPrincipal;
