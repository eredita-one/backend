import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const toBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

/**
 * Variáveis de ambiente da API. A aplicação não sobe se alguma estiver inválida:
 * nada de segredo com valor padrão no código.
 */
export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3333;

  @IsString()
  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL deve começar com postgresql://',
  })
  DATABASE_URL!: string;

  /** Origens liberadas no CORS, separadas por vírgula. Vazio = nenhuma. */
  @IsString()
  CORS_ORIGINS = '';

  /** Valor do `trust proxy` do Express (ex.: 1 atrás de um proxy reverso). 0 = desligado. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  TRUST_PROXY = 0;

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED = false;

  @IsString()
  @MinLength(1)
  JWT_ISSUER = 'api-backend';

  /** Assina os tokens da equipe interna (admin, consultor, contábil). */
  @IsString()
  @MinLength(32)
  JWT_STAFF_SECRET!: string;

  /** Assina os tokens do portal do cliente. Precisa ser diferente do da equipe. */
  @IsString()
  @MinLength(32)
  JWT_CLIENT_SECRET!: string;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  ACCESS_TOKEN_TTL_SECONDS = 900;

  /** Duração da sessão sem "Manter conectado". */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_HOURS = 12;

  /** Duração da sessão com "Manter conectado". */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_REMEMBER_DAYS = 30;

  /**
   * Janela em que um refresh token recém-trocado ainda é aceito. Cobre requisições
   * paralelas do front renovando ao mesmo tempo. Fora dela, reuso derruba a sessão.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  REFRESH_TOKEN_REUSE_GRACE_SECONDS = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_MAX_ATTEMPTS = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_LOCK_MINUTES = 15;

  /** Limite de chamadas por IP por minuto nas rotas de login/refresh. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUTH_RATE_LIMIT_PER_MINUTE = 10;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw);
  const errors = validateSync(env, { skipMissingProperties: false });

  const messages = errors.flatMap((error) =>
    Object.values(error.constraints ?? {}).map(
      (message) => `${error.property}: ${message}`,
    ),
  );

  if (env.JWT_STAFF_SECRET && env.JWT_STAFF_SECRET === env.JWT_CLIENT_SECRET) {
    messages.push(
      'JWT_CLIENT_SECRET: precisa ser diferente de JWT_STAFF_SECRET',
    );
  }

  if (messages.length > 0) {
    throw new Error(`Configuração inválida:\n  - ${messages.join('\n  - ')}`);
  }

  return env;
}
