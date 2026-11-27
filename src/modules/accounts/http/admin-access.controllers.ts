import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AccessManagementService } from '../application/access-management.service.js';
import type { StaffPrincipal } from '../domain/principal.js';
import { Can, CanAny, CurrentStaff } from './access-policy.js';
import {
  AccessProfileDto,
  AuditPageDto,
  AuditQueryDto,
  CreateAccessProfileDto,
  CreateStaffUserDto,
  PermissionDto,
  StaffUserDto,
  UpdateAccessProfileDto,
  UpdateStaffUserDto,
} from './dto/access.dto.js';

/*
 * As rotas exigem alguma permissão de gestão (`@CanAny`). A regra fina, sobre QUAL perfil
 * cada pessoa pode criar, editar, conceder ou revogar, fica na política do domínio
 * (domain/access/access-policy.ts), porque depende do perfil envolvido.
 */

const uuid = new ParseUUIDPipe({ version: 'all' });

@ApiTags('Admin · Perfis de acesso')
@Controller('admin')
export class AdminAccessProfilesController {
  constructor(private readonly access: AccessManagementService) {}

  @CanAny(
    'admin.access.users.manage',
    'admin.access.profiles.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Get('permissions')
  @ApiOkResponse({ type: [PermissionDto] })
  permissions(): PermissionDto[] {
    return this.access.permissionCatalog();
  }

  @CanAny(
    'admin.access.users.manage',
    'admin.access.profiles.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Get('access-profiles')
  @ApiOkResponse({ type: [AccessProfileDto] })
  list(): Promise<AccessProfileDto[]> {
    return this.access.listProfiles();
  }

  @CanAny(
    'admin.access.profiles.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Post('access-profiles')
  @ApiOkResponse({ type: AccessProfileDto })
  create(
    @CurrentStaff() actor: StaffPrincipal,
    @Body() dto: CreateAccessProfileDto,
  ): Promise<AccessProfileDto> {
    return this.access.createProfile(actor.id, dto);
  }

  @CanAny(
    'admin.access.profiles.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Patch('access-profiles/:id')
  @ApiOkResponse({ type: AccessProfileDto })
  update(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateAccessProfileDto,
  ): Promise<AccessProfileDto> {
    return this.access.updateProfile(actor.id, id, dto);
  }

  @CanAny(
    'admin.access.profiles.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Delete('access-profiles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async delete(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', uuid) id: string,
  ) {
    await this.access.deleteProfile(actor.id, id);
  }
}

@ApiTags('Admin · Usuários da equipe')
@Controller('admin/staff-users')
export class AdminStaffUsersController {
  constructor(private readonly access: AccessManagementService) {}

  @CanAny(
    'admin.access.users.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Get()
  @ApiOkResponse({ type: [StaffUserDto] })
  async list(): Promise<StaffUserDto[]> {
    return (await this.access.listUsers()).map((user) =>
      StaffUserDto.from(user),
    );
  }

  @CanAny(
    'admin.access.users.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Get(':id')
  @ApiOkResponse({ type: StaffUserDto })
  async get(@Param('id', uuid) id: string): Promise<StaffUserDto> {
    return StaffUserDto.from(await this.access.getUser(id));
  }

  /** A conta nasce com convite pendente (sem senha). */
  @Can('admin.access.users.manage')
  @Post()
  @ApiOkResponse({ type: StaffUserDto })
  async create(
    @CurrentStaff() actor: StaffPrincipal,
    @Body() dto: CreateStaffUserDto,
  ): Promise<StaffUserDto> {
    return StaffUserDto.from(
      await this.access.createUser(actor.id, {
        email: dto.email,
        name: dto.name,
        profileIds: dto.profileIds ?? [],
      }),
    );
  }

  /**
   * Nome, e-mail e/ou senha de outra pessoa. Senha nova encerra as sessões dela. Exige
   * autoridade sobre todos os perfis da pessoa; a própria conta não se edita por aqui.
   */
  @Can('admin.access.users.manage')
  @Patch(':id')
  @ApiOkResponse({ type: StaffUserDto })
  async update(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateStaffUserDto,
  ): Promise<StaffUserDto> {
    return StaffUserDto.from(
      await this.access.updateUser(actor.id, id, {
        name: dto.name,
        email: dto.email,
        password: dto.password,
      }),
    );
  }

  @CanAny(
    'admin.access.users.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Put(':id/access-profiles/:profileId')
  @ApiOkResponse({ type: StaffUserDto })
  async grant(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', uuid) id: string,
    @Param('profileId', uuid) profileId: string,
  ): Promise<StaffUserDto> {
    return StaffUserDto.from(
      await this.access.grantProfile(actor.id, id, profileId),
    );
  }

  @CanAny(
    'admin.access.users.manage',
    'admin.access.consultor.manage',
    'admin.access.contabil.manage',
  )
  @Delete(':id/access-profiles/:profileId')
  @ApiOkResponse({ type: StaffUserDto })
  async revoke(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', uuid) id: string,
    @Param('profileId', uuid) profileId: string,
  ): Promise<StaffUserDto> {
    return StaffUserDto.from(
      await this.access.revokeProfile(actor.id, id, profileId),
    );
  }

  @Can('admin.access.users.manage')
  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: StaffUserDto })
  async disable(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<StaffUserDto> {
    return StaffUserDto.from(
      await this.access.setUserStatus(actor.id, id, 'DISABLED'),
    );
  }

  @Can('admin.access.users.manage')
  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: StaffUserDto })
  async enable(
    @CurrentStaff() actor: StaffPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<StaffUserDto> {
    return StaffUserDto.from(
      await this.access.setUserStatus(actor.id, id, 'ACTIVE'),
    );
  }
}

@ApiTags('Admin · Auditoria de acessos')
@Controller('admin/access-audit')
export class AdminAccessAuditController {
  constructor(private readonly access: AccessManagementService) {}

  /** Paginada, da mais recente para a mais antiga (ou o contrário, com `order=asc`). */
  @Can('admin.access.audit.view')
  @Get()
  @ApiOkResponse({ type: AuditPageDto })
  async list(@Query() query: AuditQueryDto): Promise<AuditPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const { items, total } = await this.access.auditLog({
      page,
      pageSize,
      order: query.order ?? 'desc',
      subjectId: query.subjectId,
      personId: query.personId,
      type: query.type,
      search: query.search,
      from: query.from ? new Date(`${query.from}T00:00:00Z`) : undefined,
      // `to` é o último dia, inclusive: vale até o começo do dia seguinte.
      until: query.to ? nextDay(query.to) : undefined,
    });
    return { items, total, page, pageSize };
  }
}

function nextDay(day: string): Date {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
