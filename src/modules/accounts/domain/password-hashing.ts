import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id (algoritmo padrão da lib) com os parâmetros mínimos recomendados pela OWASP:
 * 19 MiB de memória, 2 iterações, 1 thread. Funções soltas (sem Nest) para o seed usar.
 */
export const PASSWORD_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, PASSWORD_HASH_OPTIONS);
}

/** `false` também para hash malformado: nunca lança. */
export async function verifyPassword(
  hashed: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
