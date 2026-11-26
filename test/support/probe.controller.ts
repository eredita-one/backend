import { Controller, Get } from '@nestjs/common';
import {
  Can,
  CanAny,
  ClientArea,
  type ClientPrincipal,
  CurrentClient,
  CurrentStaff,
  StaffApp,
  StaffApps,
  type StaffPrincipal,
} from '../../src/modules/accounts/index.js';

/**
 * Rotas que existem só nos testes, uma por política de acesso, para provar o isolamento
 * sem depender dos módulos de negócio (que ainda não existem). Usa só a API pública do
 * contexto Contas, como um módulo de negócio usaria.
 */
@Controller('probe')
export class ProbeController {
  @StaffApps(StaffApp.ADMIN)
  @Get('admin')
  admin(@CurrentStaff() staff: StaffPrincipal) {
    return { id: staff.id, app: staff.app };
  }

  @StaffApps(StaffApp.CONSULTOR)
  @Get('consultor')
  consultor(@CurrentStaff() staff: StaffPrincipal) {
    return { id: staff.id, app: staff.app };
  }

  @StaffApps(StaffApp.ADMIN, StaffApp.CONSULTOR)
  @Get('admin-ou-consultor')
  shared(@CurrentStaff() staff: StaffPrincipal) {
    return { id: staff.id, app: staff.app };
  }

  @Can('admin.commissions.view')
  @Get('comissoes')
  commissions(@CurrentStaff() staff: StaffPrincipal) {
    return { id: staff.id };
  }

  @Can('admin.clients.view', 'admin.clients.edit')
  @Get('editar-cliente')
  editClient() {
    return { ok: true };
  }

  @CanAny('admin.commissions.view', 'admin.requests.handle')
  @Get('comissoes-ou-solicitacoes')
  anyOf() {
    return { ok: true };
  }

  @ClientArea()
  @Get('cliente')
  client(@CurrentClient() client: ClientPrincipal) {
    return { id: client.id };
  }

  /** Sem política: o guard precisa negar, mesmo com token válido. */
  @Get('sem-politica')
  noPolicy() {
    return { leaked: true };
  }
}
