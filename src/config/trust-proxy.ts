/**
 * Converte `TRUST_PROXY` no valor do `trust proxy` do Express.
 *
 *  - `0`, `false` ou vazio: desligado. O IP é o da conexão.
 *  - número (`1`, `2`): quantos proxies à frente da API são confiáveis.
 *  - lista (`loopback`, `10.0.0.0/8`, `loopback, 172.16.0.0/12`): só confia no
 *    X-Forwarded-For quando a conexão vem desses endereços. É o caso do front (Next):
 *    ele chama a API do servidor e repassa o IP de quem está no navegador, e ninguém de
 *    fora consegue forjar esse cabeçalho.
 */
export function parseTrustProxy(value: string): number | string | false {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '0' || trimmed.toLowerCase() === 'false') {
    return false;
  }
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

/** Formatos aceitos: número, ou lista de `loopback`/`linklocal`/`uniquelocal`/IP/CIDR. */
export const TRUST_PROXY_PATTERN =
  /^\s*(\d+|false|(loopback|linklocal|uniquelocal|[0-9a-fA-F.:]+(\/\d{1,3})?)(\s*,\s*(loopback|linklocal|uniquelocal|[0-9a-fA-F.:]+(\/\d{1,3})?))*)?\s*$/;
