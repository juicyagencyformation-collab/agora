// worker/test/email-commune.test.ts
import { describe, it, expect } from 'vitest';
import { emailBienvenueHtml, genererMotDePasseTemporaire } from '../src/backoffice/email-commune';

describe('genererMotDePasseTemporaire', () => {
  it('génère 10 caractères sans symboles ambigus', () => {
    const mdp = genererMotDePasseTemporaire();
    expect(mdp).toHaveLength(10);
    expect(mdp).toMatch(/^[A-HJ-NP-Za-hj-np-z2-9]+$/); // pas de 0,O,1,l,I
  });
});

describe('emailBienvenueHtml', () => {
  const html = emailBienvenueHtml({
    nomCommune: 'Eaucourt-sur-Somme', slug: 'eaucourt',
    maireEmail: 'maire@eaucourt.fr', motDePasse: 'Abc23xyz45',
    frontendUrl: 'https://plateforme-agora.fr',
  });
  it('contient le lien de l\'app, l\'identifiant et le mot de passe', () => {
    expect(html).toContain('https://plateforme-agora.fr/eaucourt/');
    expect(html).toContain('maire@eaucourt.fr');
    expect(html).toContain('Abc23xyz45');
  });
  it('échappe le nom de la commune contre l\'injection HTML', () => {
    const mechant = emailBienvenueHtml({
      nomCommune: '<script>x</script>', slug: 'x',
      maireEmail: 'a@b.fr', motDePasse: 'zzz', frontendUrl: 'https://plateforme-agora.fr',
    });
    expect(mechant).not.toContain('<script>x</script>');
    expect(mechant).toContain('&lt;script&gt;');
  });
});
