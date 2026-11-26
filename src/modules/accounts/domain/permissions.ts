import type { StaffApp } from './apps.js';

type PermissionDefinition = { key: string; description: string };

/**
 * Catálogo de permissões, por app.
 *
 * Fica no código porque uma permissão só tem efeito se algum endpoint a exigir
 * (`@Can(...)`): o admin não cria permissões, ele combina as daqui em perfis de acesso.
 * A chave começa pelo app, e um perfil só pode usar permissões do próprio app.
 *
 * Rascunho tirado dos protótipos: ajuste cada área quando o módulo correspondente for
 * implementado. Remover uma chave daqui não quebra nada: chaves antigas gravadas em perfis
 * são ignoradas.
 */
export const PERMISSION_CATALOG = {
  ADMIN: [
    {
      key: 'admin.clients.view',
      description: 'Ver carteira e ficha dos clientes',
    },
    { key: 'admin.clients.edit', description: 'Cadastrar e editar clientes' },
    {
      key: 'admin.clients.sensitive.view',
      description:
        'Ver dados sensíveis sem máscara (codice fiscale, IBAN, estado civil)',
    },
    {
      key: 'admin.clients.family.view',
      description: 'Ver família e rede de relacionamento',
    },
    {
      key: 'admin.clients.family.edit',
      description: 'Editar família e rede de relacionamento',
    },
    { key: 'admin.properties.view', description: 'Ver imóveis e lançamentos' },
    {
      key: 'admin.properties.edit',
      description: 'Editar imóveis e registrar lançamentos',
    },
    { key: 'admin.fiscal.view', description: 'Ver central fiscal' },
    {
      key: 'admin.fiscal.export',
      description: 'Exportar dossiê fiscal para o commercialista',
    },
    { key: 'admin.relocation.view', description: 'Ver jornada de relocation' },
    {
      key: 'admin.relocation.edit',
      description: 'Atualizar jornada de relocation',
    },
    { key: 'admin.requests.view', description: 'Ver solicitações' },
    {
      key: 'admin.requests.handle',
      description: 'Atender solicitações (mudar status)',
    },
    { key: 'admin.services.view', description: 'Ver serviços contratados' },
    {
      key: 'admin.services.edit',
      description: 'Registrar e editar serviços contratados',
    },
    { key: 'admin.commissions.view', description: 'Ver receitas e comissões' },
    { key: 'admin.commissions.receive', description: 'Registrar recebimentos' },
    {
      key: 'admin.commissions.pay',
      description: 'Marcar comissões como pagas',
    },
    {
      key: 'admin.network.edit',
      description: 'Editar política de remuneração e rede comercial',
    },
    {
      key: 'admin.network.approve',
      description: 'Aprovar integrantes propostos por líderes',
    },
    { key: 'admin.timeline.view', description: 'Ver linha do tempo interna' },
    {
      key: 'admin.timeline.record',
      description: 'Registrar atividades na linha do tempo',
    },
    {
      key: 'admin.documents.view',
      description: 'Ver arquivo documental restrito',
    },
    { key: 'admin.documents.attach', description: 'Anexar documentos' },
    { key: 'admin.documents.remove', description: 'Remover documentos' },
    {
      key: 'admin.help.publish',
      description: 'Publicar orientações na central de ajuda',
    },
    {
      key: 'admin.access.users.manage',
      description:
        'Criar, ativar e desativar usuários da equipe e atribuir perfis do admin',
    },
    {
      key: 'admin.access.profiles.manage',
      description: 'Criar e editar perfis de acesso do admin',
    },
    {
      key: 'admin.access.consultor.manage',
      description: 'Gerenciar perfis do app Consultor e quem os tem',
    },
    {
      key: 'admin.access.contabil.manage',
      description: 'Gerenciar perfis do app Contábil e quem os tem',
    },
    { key: 'admin.access.audit.view', description: 'Ver auditoria de acessos' },
  ],
  CONSULTOR: [
    {
      key: 'consultor.portfolio.view',
      description: 'Ver carteira e calendário (próprios e da equipe)',
    },
    { key: 'consultor.earnings.view', description: 'Ver ganhos e comissões' },
    { key: 'consultor.team.view', description: 'Ver a própria equipe' },
    {
      key: 'consultor.team.propose',
      description: 'Propor integrante direto (líder autorizado)',
    },
  ],
  CONTABIL: [
    {
      key: 'contabil.taxpayers.view',
      description: 'Ver contribuintes e dados fiscais',
    },
    {
      key: 'contabil.taxpayers.bank.edit',
      description: 'Editar coordenadas bancárias e mandato',
    },
    {
      key: 'contabil.cadastre.edit',
      description: 'Editar catasto e dados de locação',
    },
    { key: 'contabil.obligations.view', description: 'Ver adempimenti' },
    {
      key: 'contabil.obligations.edit',
      description: 'Registrar e atualizar adempimenti (F24, status, pagamento)',
    },
    { key: 'contabil.documents.view', description: 'Ver arquivo documental' },
    { key: 'contabil.documents.attach', description: 'Anexar documentos' },
    { key: 'contabil.documents.remove', description: 'Remover documentos' },
    {
      key: 'contabil.reports.export',
      description: 'Imprimir e exportar relatórios fiscais',
    },
  ],
} as const satisfies Record<StaffApp, readonly PermissionDefinition[]>;

export type Permission = (typeof PERMISSION_CATALOG)[StaffApp][number]['key'];

const APP_BY_PERMISSION = new Map<string, StaffApp>(
  (Object.keys(PERMISSION_CATALOG) as StaffApp[]).flatMap((app) =>
    PERMISSION_CATALOG[app].map(({ key }) => [key, app] as const),
  ),
);

export function isPermission(value: string): value is Permission {
  return APP_BY_PERMISSION.has(value);
}

export function isPermissionOf(
  app: StaffApp,
  value: string,
): value is Permission {
  return APP_BY_PERMISSION.get(value) === app;
}

export function appOfPermission(permission: Permission): StaffApp {
  return APP_BY_PERMISSION.get(permission)!;
}

export function permissionsOfApp(app: StaffApp): Permission[] {
  return PERMISSION_CATALOG[app].map(({ key }) => key);
}
