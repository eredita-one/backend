import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AccessEventType } from '../../domain/access/access-events.js';
import type { StaffUser } from '../../domain/access/staff-user.js';
import { STAFF_APPS, type StaffApp } from '../../domain/apps.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../domain/password-policy.js';
import { normalizeEmailInput } from './auth.dto.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ─── Catálogo ─────────────────────────────────────────────────────────────────

export class PermissionDto {
  @ApiProperty({ example: 'admin.clients.view' })
  key!: string;

  @ApiProperty({ enum: STAFF_APPS })
  app!: StaffApp;

  @ApiProperty({
    description: 'Texto padrão em português; o front pode traduzir pela chave.',
  })
  description!: string;
}

// ─── Perfis ───────────────────────────────────────────────────────────────────

export class AccessProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: STAFF_APPS })
  app!: StaffApp;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({
    description: 'Perfil do sistema: não pode ser editado nem apagado.',
  })
  isSystem!: boolean;

  @ApiProperty({ type: [String] })
  permissions!: string[];

  @ApiProperty({ description: 'Quantos usuários têm este perfil.' })
  userCount!: number;
}

export class CreateAccessProfileDto {
  @ApiProperty({ enum: STAFF_APPS })
  @IsIn(STAFF_APPS)
  app!: StaffApp;

  @ApiProperty({ example: 'Operações' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({
    type: [String],
    example: ['admin.clients.view', 'admin.requests.handle'],
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions!: string[];
}

export class UpdateAccessProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '`null` apaga a descrição.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @ApiPropertyOptional({
    type: [String],
    description: 'Conjunto completo de permissões (substitui o atual).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  permissions?: string[];
}

// ─── Usuários da equipe ───────────────────────────────────────────────────────

export class AccessProfileRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: STAFF_APPS })
  app!: StaffApp;

  @ApiProperty()
  name!: string;
}

export class StaffUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED';

  @ApiProperty({
    description: 'Sem senha definida: ainda não consegue entrar.',
  })
  invitePending!: boolean;

  @ApiProperty({ type: Date, nullable: true })
  lastLoginAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: [AccessProfileRefDto] })
  profiles!: AccessProfileRefDto[];

  @ApiProperty({
    enum: STAFF_APPS,
    isArray: true,
    description: 'Apps liberados pelos perfis.',
  })
  apps!: StaffApp[];

  static from(user: StaffUser): StaffUserDto {
    const apps = new Set(user.profiles.map(({ app }) => app));
    return { ...user, apps: STAFF_APPS.filter((app) => apps.has(app)) };
  }
}

export class CreateStaffUserDto {
  @ApiProperty({ example: 'pessoa@eredita.com' })
  @Transform(normalizeEmailInput)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiPropertyOptional({ type: [String], description: 'Perfis iniciais.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  profileIds?: string[];
}

/** Só os campos enviados mudam. */
export class UpdateStaffUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ example: 'pessoa@eredita.com' })
  @IsOptional()
  @Transform(normalizeEmailInput)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({
    description: `Senha nova, de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres. Encerra as sessões da pessoa.`,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  password?: string;
}

// ─── Auditoria ────────────────────────────────────────────────────────────────

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @ApiPropertyOptional({
    enum: ['desc', 'asc'],
    default: 'desc',
    description: '`desc`: mais recentes primeiro.',
  })
  @IsOptional()
  @IsIn(['desc', 'asc'])
  order?: 'desc' | 'asc';

  @ApiPropertyOptional({
    description: 'Só eventos sobre este usuário ou perfil.',
  })
  @IsOptional()
  @IsUUID('all')
  subjectId?: string;

  @ApiPropertyOptional({
    description: 'Eventos em que a pessoa aparece: quem fez ou sobre quem.',
  })
  @IsOptional()
  @IsUUID('all')
  personId?: string;

  @ApiPropertyOptional({ enum: Object.values(AccessEventType) })
  @IsOptional()
  @IsIn(Object.values(AccessEventType))
  type?: AccessEventType;

  @ApiPropertyOptional({
    description:
      'Nome ou e-mail de quem fez ou sobre quem, ou nome do perfil (sem diferenciar maiúsculas).',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  search?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'Primeiro dia do período (UTC).',
  })
  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Último dia do período, inclusive (UTC).',
  })
  @IsOptional()
  @Matches(DAY)
  @IsISO8601({ strict: true })
  to?: string;
}

export class AuditEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'AccessProfileGranted' })
  type!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nulo quando foi o sistema.',
  })
  actorId!: string | null;

  @ApiProperty({ enum: ['staff_user', 'client_account', 'access_profile'] })
  subjectType!: string;

  @ApiProperty()
  subjectId!: string;

  @ApiProperty({ type: Object })
  data!: Record<string, unknown>;

  @ApiProperty()
  occurredAt!: Date;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditEntryDto] })
  items!: AuditEntryDto[];

  @ApiProperty({
    description: 'Total de eventos com os filtros (todas as páginas).',
  })
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}
