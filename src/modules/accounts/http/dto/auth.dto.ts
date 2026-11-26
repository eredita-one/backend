import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { STAFF_APPS, type StaffApp } from '../../domain/apps.js';

/** E-mail colado com espaço ou em maiúsculas ainda deve entrar. */
export const normalizeEmailInput = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// ─── Entrada ──────────────────────────────────────────────────────────────────

export class LoginDto {
  @ApiProperty({ example: 'pessoa@empresa.com' })
  @Transform(normalizeEmailInput)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 256)
  password!: string;

  @ApiPropertyOptional({
    description: '"Manter conectado": sessão longa em vez da sessão curta.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class StaffLoginDto extends LoginDto {
  @ApiProperty({
    enum: STAFF_APPS,
    description:
      'App em que o usuário está entrando. O token só vale para ele.',
  })
  @IsIn(STAFF_APPS)
  app!: StaffApp;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @Length(32, 128)
  refreshToken!: string;
}

// ─── Saída ────────────────────────────────────────────────────────────────────

export class TokenPairDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({ description: 'Validade do access token, em segundos.' })
  accessTokenExpiresIn!: number;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({
    description: 'Fim da sessão. Renovar não estende este prazo.',
  })
  refreshTokenExpiresAt!: Date;
}

export class StaffProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: STAFF_APPS, description: 'App da sessão atual.' })
  app!: StaffApp;

  @ApiProperty({
    enum: STAFF_APPS,
    isArray: true,
    description: 'Todos os apps que o usuário pode acessar.',
  })
  apps!: StaffApp[];

  @ApiProperty({
    type: [String],
    description:
      'Permissões no app atual. Use para montar menus; a API confere de novo em cada rota.',
  })
  permissions!: string[];
}

export class ClientProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  name!: string;
}

export class StaffSessionDto extends TokenPairDto {
  @ApiProperty({ type: StaffProfileDto })
  user!: StaffProfileDto;
}

export class ClientSessionDto extends TokenPairDto {
  @ApiProperty({ type: ClientProfileDto })
  client!: ClientProfileDto;
}
