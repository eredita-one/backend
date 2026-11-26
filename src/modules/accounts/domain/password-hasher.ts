import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './password-hashing.js';

@Injectable()
export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  /**
   * Sem hash (e-mail inexistente ou convite pendente), compara com um hash descartável,
   * para que o tempo de resposta não revele se o e-mail está cadastrado.
   */
  async verify(
    plain: string,
    hashed: string | null | undefined,
  ): Promise<boolean> {
    if (!hashed) {
      await verifyPassword(await this.getDummyHash(), plain);
      return false;
    }
    return verifyPassword(hashed, plain);
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
    return this.dummyHash;
  }
}
