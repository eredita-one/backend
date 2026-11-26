import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Realm } from '../domain/apps.js';
import { AUTH_CONFIG, type AuthConfig } from '../domain/auth-config.js';

export type AccessTokenClaims = {
  /** Id da conta (`users.id` ou `client_accounts.id`, conforme o domínio). */
  sub: string;
  /** App para o qual o token foi emitido (`ADMIN`, `CONSULTOR`, `CONTABIL` ou `CLIENTE`). */
  aud: string;
  realm: Realm;
};

/**
 * Tokens de acesso (JWT HS256, curtos). Cada domínio assina com o próprio segredo,
 * e o claim `realm` é conferido de novo: um token de cliente nunca passa como da equipe.
 * Permissões não vão no token: o guard as relê a cada requisição, então revogar vale na hora.
 */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  sign(realm: Realm, subject: string, audience: string): Promise<string> {
    return this.jwt.signAsync(
      { realm },
      {
        secret: this.config.secrets[realm],
        algorithm: 'HS256',
        issuer: this.config.issuer,
        subject,
        audience,
        expiresIn: this.config.accessTokenTtlSeconds,
      },
    );
  }

  /** Claims do token, ou `null` se assinatura, emissor, validade ou domínio não conferem. */
  async verify(realm: Realm, token: string): Promise<AccessTokenClaims | null> {
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(
        token,
        {
          secret: this.config.secrets[realm],
          algorithms: ['HS256'],
          issuer: this.config.issuer,
        },
      );
      const { sub, aud } = payload;
      if (
        payload.realm !== realm ||
        typeof sub !== 'string' ||
        typeof aud !== 'string'
      ) {
        return null;
      }
      return { sub, aud, realm };
    } catch {
      return null;
    }
  }
}
