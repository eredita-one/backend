/**
 * API pública do contexto Contas. Outros módulos importam SÓ daqui (regra de lint em
 * .oxlintrc.json): o que não está exportado é detalhe interno e pode mudar.
 *
 * O que os outros contextos recebem de Contas é o `Principal` (quem é e o que pode),
 * nunca a conta em si. Cadastros de negócio (cliente, associado) guardam só o id da conta.
 */
export { AccountsModule } from './accounts.module.js';
export { CLIENT_AUDIENCE, STAFF_APPS, StaffApp } from './domain/apps.js';
export type { Permission } from './domain/permissions.js';
export type {
  ClientPrincipal,
  Principal,
  StaffPrincipal,
} from './domain/principal.js';
export {
  Can,
  CanAny,
  ClientArea,
  CurrentClient,
  CurrentStaff,
  StaffApps,
} from './http/access-policy.js';
export { isNotAuthRateLimited } from './http/auth-rate-limit.js';
