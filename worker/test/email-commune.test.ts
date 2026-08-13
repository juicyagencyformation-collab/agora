// worker/test/email-commune.test.ts
import { describe, it, expect } from 'vitest';
import { emailBienvenueHtml, emailProspectionHtml, genererMotDePasseTemporaire } from '../src/backoffice/email-commune';

describe('genererMotDePasseTemporaire', () => {
  it('génère 10 caractères sans symboles ambigus', () => {
    const mdp = genererMotDePasseTemporaire();
    expect(mdp).toHaveLength(10);
    expect(mdp).toMatch(/^[A-Za-z2-9]+$/);     // lettres (hors caractères retirés) + chiffres 2-9
    expect(mdp).not.toMatch(/[0O1Ilio]/);       // aucun caractère ambigu
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

describe('emailProspectionHtml', () => {
  const html = emailProspectionHtml({
    nomCommune: 'Ailly-le-Haut-Clocher', contactEmail: 'mairie@ailly.fr',
    frontendUrl: 'https://plateforme-agora.fr',
  });
  it('renvoie vers la démo et la fiche personnalisée, sans exposer d\'identifiants', () => {
    expect(html).toContain('https://plateforme-agora.fr/eaucourt/'); // démo
    expect(html).toContain('/backoffice/fiche?slug=eaucourt&nom=Ailly-le-Haut-Clocher');
    expect(html).toContain('Ailly-le-Haut-Clocher');
    expect(html).not.toContain('Mot de passe');
  });
});
