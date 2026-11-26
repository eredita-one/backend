import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { StaffUser } from '../../domain/access/staff-user.js';
import { STAFF_APPS, type StaffApp } from '../../domain/apps.js';
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

// ─── Auditoria ────────────────────────────────────────────────────────────────

export class AuditQueryDto {
  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Só eventos deste usuário ou perfil.' })
  @IsOptional()
  @IsUUID('all')
  subjectId?: string;
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
