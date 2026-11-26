import { parseTrustProxy, TRUST_PROXY_PATTERN } from './trust-proxy.js';

describe('TRUST_PROXY', () => {
  it('desligado com 0, false ou vazio', () => {
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
  });

  it('número vira quantidade de saltos', () => {
    expect(parseTrustProxy('1')).toBe(1);
  });

  it('lista de endereços confiáveis', () => {
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy(' loopback,10.0.0.0/8 ')).toBe(
      'loopback, 10.0.0.0/8',
    );
  });

  it('valida o formato', () => {
    for (const ok of [
      '0',
      '2',
      'false',
      'loopback',
      'loopback, 10.0.0.0/8',
      '::1',
      '',
    ]) {
      expect(TRUST_PROXY_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['true', '*', 'qualquer coisa', 'loopback;rm']) {
      expect(TRUST_PROXY_PATTERN.test(bad)).toBe(false);
    }
  });
});
