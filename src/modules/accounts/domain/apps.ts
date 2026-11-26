/**
 * Apps da equipe interna. Cada um é um módulo: o usuário entra nele se tiver algum perfil
 * de acesso daquele app. Espelha o enum `StaffApp` do schema Prisma.
 */
export const StaffApp = {
  ADMIN: 'ADMIN',
  CONSULTOR: 'CONSULTOR',
  CONTABIL: 'CONTABIL',
} as const;

export type StaffApp = (typeof StaffApp)[keyof typeof StaffApp];

export const STAFF_APPS = [
  StaffApp.ADMIN,
  StaffApp.CONSULTOR,
  StaffApp.CONTABIL,
] as const;

export function isStaffApp(value: string): value is StaffApp {
  return (STAFF_APPS as readonly string[]).includes(value);
}

/** Audiência (`aud`) dos tokens do portal do cliente. */
export const CLIENT_AUDIENCE = 'CLIENTE';

/**
 * Domínio de login. Cada um tem tabela de contas, tabela de refresh tokens e segredo
 * de assinatura próprios: um token de um domínio nunca é válido no outro.
 */
export type Realm = 'staff' | 'client';
