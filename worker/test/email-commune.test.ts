// worker/test/email-commune.test.ts
import { describe, it, expect } from 'vitest';
import {
  emailBienvenueHtml, genererMotDePasseTemporaire,
  rendrePresentation, contextePresentation, MODELE_PRESENTATION_DEFAUT,
} from '../src/backoffice/email-commune';

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

describe('rendrePresentation (modèle + variables)', () => {
  it('substitue commune / url / lien_fiche depuis le contexte', () => {
    const ctx = contextePresentation('https://plateforme-agora.fr', 'Ailly-le-Haut-Clocher', 'eaucourt');
    const html = rendrePresentation(MODELE_PRESENTATION_DEFAUT.corps_html, ctx);
    expect(html).toContain('https://plateforme-agora.fr/eaucourt/');
    expect(html).toContain('/backoffice/fiche?slug=eaucourt&nom=Ailly-le-Haut-Clocher');
    expect(html).toContain('Ailly-le-Haut-Clocher');
    expect(html).not.toContain('{{commune}}');
    expect(html).not.toContain('{{url}}');
  });
  it('échappe le nom de commune contre l\'injection HTML', () => {
    const ctx = contextePresentation('https://plateforme-agora.fr', '<b>x</b>', 'y');
    const html = rendrePresentation('Bonjour {{commune}}', ctx);
    expect(html).toBe('Bonjour &lt;b&gt;x&lt;/b&gt;');
  });
});
