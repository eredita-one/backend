import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccessEventType,
  AUDIT_TRAIL,
  type AuditTrail,
} from '../domain/access/access-events.js';
import type { Realm } from '../domain/apps.js';
import { AUTH_CONFIG, type AuthConfig } from '../domain/auth-config.js';
import { AuthErrors } from '../domain/auth-errors.js';
import { CLOCK, type Clock } from '../domain/clock.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  type NewRefreshToken,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '../domain/refresh-tokens.js';
import { AccessTokenService } from '../infrastructure/jwt-access-tokens.js';

export type TokenPair = {
  accessToken: string;
  /** Validade do access token, em segundos. */
  accessTokenExpiresIn: number;
  refreshToken: string;
  /** Fim da sessão: as rotações não estendem esse prazo. */
  refreshTokenExpiresAt: Date;
};

export type RequestMeta = { userAgent: string | null; ip: string | null };

type OpenParams<TScope extends object> = {
  realm: Realm;
  store: RefreshTokenStore<TScope>;
  subjectId: string;
  audience: string;
  scope: TScope;
  remember: boolean;
  meta: RequestMeta;
};

type RefreshParams<TScope extends object> = {
  realm: Realm;
  store: RefreshTokenStore<TScope>;
  rawToken: string;
  meta: RequestMeta;
  /**
   * Revalida a conta antes de renovar e devolve a audiência do novo access token,
   * ou `null` para recusar (conta desativada, acesso ao app removido...).
   */
  resolveAudience: (
    record: RefreshTokenRecord<TScope>,
  ) => Promise<string | null>;
};

/**
 * Sessões com refresh token rotativo: cada uso troca o token por um novo. Se um token já
 * trocado reaparece depois da janela de tolerância, alguém o copiou, e a sessão inteira
 * (família) é revogada.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly accessTokens: AccessTokenService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  async open<TScope extends object>(
    params: OpenParams<TScope>,
  ): Promise<TokenPair> {
    const now = this.clock.now();
    const ttl = params.remember
      ? this.config.refreshTokenRememberTtlMs
      : this.config.refreshTokenTtlMs;
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(now.getTime() + ttl);

    await params.store.create({
      ...params.scope,
      subjectId: params.subjectId,
      familyId: randomUUID(),
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      ...params.meta,
    });

    return this.pair(
      params.realm,
      params.subjectId,
      params.audience,
      refreshToken,
      expiresAt,
    );
  }

  async refresh<TScope extends object>(
    params: RefreshParams<TScope>,
  ): Promise<TokenPair> {
    const { store, realm } = params;
    const now = this.clock.now();
    const record = await store.findByHash(hashRefreshToken(params.rawToken));

    if (!record || record.expiresAt <= now) throw AuthErrors.refreshInvalid();

    if (record.revokedAt) {
      await this.assertRecentRotation(
        store,
        realm,
        record,
        record.revokedAt,
        now,
      );
    }

    const audience = await params.resolveAudience(record);
    if (!audience) {
      await store.revokeFamily(record.familyId, now);
      throw AuthErrors.refreshInvalid();
    }

    const refreshToken = generateRefreshToken();
    // `lineage` = conta, família e escopo do domínio (ex.: app), herdados pelo novo token.
    const {
      id,
      tokenHash: _previous,
      revokedAt,
      expiresAt,
      ...lineage
    } = record;
    const next = {
      ...lineage,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      ...params.meta,
    } as NewRefreshToken<TScope>;

    if (revokedAt) {
      // Dentro da tolerância: outra requisição paralela acabou de trocar este token.
      await store.create(next);
    } else if (!(await store.rotate(id, now, next))) {
      // Revogado por outra requisição entre a leitura e a escrita: pode ter sido uma
      // rotação paralela (aceita) ou um logout (recusa).
      await this.assertRecentRotation(store, realm, record, now, now);
      await store.create(next);
    }

    return this.pair(
      realm,
      record.subjectId,
      audience,
      refreshToken,
      expiresAt,
    );
  }

  /** Encerra a sessão do refresh token informado. Token desconhecido não é erro. */
  async close<TScope extends object>(
    store: RefreshTokenStore<TScope>,
    rawToken: string,
  ): Promise<void> {
    const record = await store.findByHash(hashRefreshToken(rawToken));
    if (record) await store.revokeFamily(record.familyId, this.clock.now());
  }

  /**
   * Um token revogado só é aceito se foi trocado há pouco por rotação (requisições
   * paralelas do front). Caso contrário:
   *  - sessão já encerrada (logout, ou reuso detectado antes): recusa, sem alarde. É o
   *    caso normal de um refresh atrasado depois do logout.
   *  - sessão viva, mas o token foi trocado há mais tempo que a tolerância: alguém está
   *    usando uma cópia antiga. Derruba a sessão e registra na auditoria.
   */
  private async assertRecentRotation<TScope extends object>(
    store: RefreshTokenStore<TScope>,
    realm: Realm,
    record: RefreshTokenRecord<TScope>,
    revokedAt: Date,
    now: Date,
  ): Promise<void> {
    if (!(await store.hasActiveInFamily(record.familyId))) {
      throw AuthErrors.refreshInvalid();
    }
    const grace = this.config.refreshReuseGraceMs;
    if (grace === 0 || now.getTime() - revokedAt.getTime() > grace) {
      await this.revokeOnReuse(store, realm, record, now);
    }
  }

  private async revokeOnReuse<TScope extends object>(
    store: RefreshTokenStore<TScope>,
    realm: Realm,
    record: RefreshTokenRecord<TScope>,
    now: Date,
  ): Promise<never> {
    this.logger.warn(
      `Refresh token reutilizado (domínio ${realm}, sessão ${record.familyId}): sessão revogada`,
    );
    await store.revokeFamily(record.familyId, now);
    await this.audit.append([
      {
        type: AccessEventType.SESSION_REUSE_DETECTED,
        actorId: null,
        subjectType: realm === 'staff' ? 'staff_user' : 'client_account',
        subjectId: record.subjectId,
        data: { sessionId: record.familyId },
        occurredAt: now,
      },
    ]);
    throw AuthErrors.refreshInvalid();
  }

  private async pair(
    realm: Realm,
    subjectId: string,
    audience: string,
    refreshToken: string,
    refreshTokenExpiresAt: Date,
  ): Promise<TokenPair> {
    return {
      accessToken: await this.accessTokens.sign(realm, subjectId, audience),
      accessTokenExpiresIn: this.config.accessTokenTtlSeconds,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }
}
