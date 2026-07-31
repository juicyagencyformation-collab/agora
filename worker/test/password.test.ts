// worker/test/password.test.ts
import { describe, it, expect } from 'vitest';
import { hasherMotDePasse, verifierMotDePasse } from '../src/lib/password';

describe('hasherMotDePasse / verifierMotDePasse', () => {
  it('un mot de passe haché puis vérifié avec la bonne valeur doit réussir', async () => {
    const hash = await hasherMotDePasse('MotDePasseTest123');
    expect(await verifierMotDePasse('MotDePasseTest123', hash)).toBe(true);
  });

  it('un mauvais mot de passe doit échouer', async () => {
    const hash = await hasherMotDePasse('MotDePasseTest123');
    expect(await verifierMotDePasse('MauvaisMotDePasse', hash)).toBe(false);
  });

  it('deux hachages du même mot de passe doivent être différents (sel aléatoire)', async () => {
    const hash1 = await hasherMotDePasse('MemeMotDePasse');
    const hash2 = await hasherMotDePasse('MemeMotDePasse');
    expect(hash1).not.toBe(hash2);
  });

  it('le hash a bien le format attendu (pbkdf2$itérations$sel$hash)', async () => {
    const hash = await hasherMotDePasse('test');
    const parts = hash.split('$');
    expect(parts[0]).toBe('pbkdf2');
    expect(parts[1]).toBe('100000');
    expect(parts.length).toBe(4);
  });

  it('reste compatible avec l\'ancien format SHA-256 (comptes créés avant la mise à jour)', async () => {
    // Reproduit l'ancien format : SHA-256 simple, sans sel, tel qu'utilisé avant la migration.
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('AncienMotDePasse'));
    const ancienHash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

    expect(await verifierMotDePasse('AncienMotDePasse', ancienHash)).toBe(true);
    expect(await verifierMotDePasse('MauvaisMotDePasse', ancienHash)).toBe(false);
  });
});
