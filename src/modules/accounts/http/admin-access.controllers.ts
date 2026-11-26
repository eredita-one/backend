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
  AuditEntryDto,
  AuditQueryDto,
  CreateAccessProfileDto,
  CreateStaffUserDto,
  PermissionDto,
  StaffUserDto,
  UpdateAccessProfileDto,
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

  @Can('admin.access.audit.view')
  @Get()
  @ApiOkResponse({ type: [AuditEntryDto] })
  list(@Query() query: AuditQueryDto): Promise<AuditEntryDto[]> {
    return this.access.auditLog({
      limit: query.limit ?? 50,
      subjectId: query.subjectId,
    });
  }
}
