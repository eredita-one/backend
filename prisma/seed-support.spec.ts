import {
  type KnownProfile,
  parseProfileRefs,
  resolveProfileRefs,
} from './seed-support.js';

const known: KnownProfile[] = [
  { id: 'p-cons', app: 'CONSULTOR', name: 'Consultor' },
  { id: 'p-lider', app: 'CONSULTOR', name: 'Líder de rede' },
  { id: 'p-comm', app: 'CONTABIL', name: 'Commercialista' },
  { id: 'p-leit-adm', app: 'ADMIN', name: 'Leitura' },
  { id: 'p-leit-cont', app: 'CONTABIL', name: 'Leitura' },
];

const resolve = (value: string | undefined) =>
  resolveProfileRefs(parseProfileRefs(value), known);

describe('SEED_ADMIN_EXTRA_PROFILES', () => {
  it('vazio ou ausente: nenhum perfil extra', () => {
    expect(resolve(undefined)).toEqual([]);
    expect(resolve(' , ')).toEqual([]);
  });

  it('resolve nomes, ignorando espaços, maiúsculas e acentos', () => {
    expect(resolve(' consultor ,COMMERCIALISTA, lider de rede')).toEqual([
      'p-cons',
      'p-comm',
      'p-lider',
    ]);
  });

  it('APP:Nome desfaz a ambiguidade', () => {
    expect(resolve('contabil:Leitura')).toEqual(['p-leit-cont']);
  });

  it('prefixo que não é app faz parte do nome', () => {
    expect(parseProfileRefs('Operações: manhã')).toEqual([
      { app: null, name: 'Operações: manhã' },
    ]);
  });

  it('nome ambíguo ou inexistente falha, listando todos os problemas', () => {
    expect(() => resolve('Leitura, Inexistente')).toThrow(
      /"Leitura" existe em mais de um app \(ADMIN, CONTABIL\); use APP:Nome; perfil "Inexistente" não existe/,
    );
  });

  it('repetido conta uma vez', () => {
    expect(resolve('Consultor, CONSULTOR:consultor')).toEqual(['p-cons']);
  });
});
