import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('gera argon2id e confere a senha', async () => {
    const hashed = await hasher.hash('uma senha qualquer');
    expect(hashed).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(hasher.verify('uma senha qualquer', hashed)).resolves.toBe(
      true,
    );
    await expect(hasher.verify('outra', hashed)).resolves.toBe(false);
  });

  it('sem hash (e-mail inexistente ou convite pendente) sempre recusa', async () => {
    await expect(hasher.verify('qualquer', null)).resolves.toBe(false);
    await expect(hasher.verify('', undefined)).resolves.toBe(false);
  });

  it('hash malformado recusa em vez de lançar', async () => {
    await expect(hasher.verify('x', 'nao-e-um-hash')).resolves.toBe(false);
  });
});
