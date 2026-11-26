import {
  isStaffApp,
  type StaffApp,
} from '../src/modules/accounts/domain/apps.js';

export type ProfileRef = { app: StaffApp | null; name: string };
export type KnownProfile = { id: string; app: StaffApp; name: string };

/**
 * Lê `SEED_ADMIN_EXTRA_PROFILES`: nomes de perfis separados por vírgula, ex.:
 *   "Consultor, Commercialista"
 * Use "APP:Nome" quando o mesmo nome existir em mais de um app, ex.: "CONTABIL:Leitura".
 */
export function parseProfileRefs(value: string | undefined): ProfileRef[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator > 0) {
        const prefix = entry.slice(0, separator).trim().toUpperCase();
        if (isStaffApp(prefix)) {
          return { app: prefix, name: entry.slice(separator + 1).trim() };
        }
      }
      return { app: null, name: entry };
    });
}

/** Para quem escreve o .env: ignora maiúsculas e acentos ("lider" acha "Líder"). */
const sameName = (a: string, b: string) =>
  a.localeCompare(b, 'pt', { sensitivity: 'base' }) === 0;

/**
 * Troca nomes por ids. Falha (sem criar nada) se algum nome não existir ou for ambíguo,
 * listando todos os problemas de uma vez.
 */
export function resolveProfileRefs(
  refs: ProfileRef[],
  known: KnownProfile[],
): string[] {
  const problems: string[] = [];
  const ids = refs.flatMap((ref) => {
    const label = ref.app ? `${ref.app}:${ref.name}` : ref.name;
    const matches = known.filter(
      (profile) =>
        sameName(profile.name, ref.name) &&
        (ref.app === null || profile.app === ref.app),
    );
    if (matches.length === 0) {
      problems.push(`perfil "${label}" não existe`);
      return [];
    }
    if (matches.length > 1) {
      const apps = matches.map((m) => m.app).join(', ');
      problems.push(
        `"${label}" existe em mais de um app (${apps}); use APP:Nome`,
      );
      return [];
    }
    return [matches[0]!.id];
  });

  if (problems.length > 0) {
    throw new Error(
      `SEED_ADMIN_EXTRA_PROFILES inválido: ${problems.join('; ')}`,
    );
  }
  return [...new Set(ids)];
}
