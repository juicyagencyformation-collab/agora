// worker/test/demande-contact.test.ts
// Couvre le formulaire public « Commune fondatrice » (src/backoffice/demande-contact.ts) :
// validation stricte des champs, et surtout l'échappement de tout ce qui vient du visiteur
// avant d'entrer dans l'email (route publique, donc entrée non fiable).
import { describe, it, expect } from 'vitest';
import { demandeContactSchema, emailDemandeContactHtml, sujetDemandeContact } from '../src/backoffice/demande-contact';

const valide = {
  nom: 'Claire Martin', fonction: 'Secrétaire de mairie', commune: 'Fay-les-Étangs',
  email: 'mairie@exemple.fr', telephone: '03 44 00 00 00', message: 'Rappelez-moi le matin.',
};

describe('demandeContactSchema', () => {
  it('accepte une demande complète', () => {
    expect(demandeContactSchema.safeParse(valide).success).toBe(true);
  });
  it('accepte une demande sans téléphone ni message', () => {
    const { telephone, message, ...minimal } = valide;
    expect(demandeContactSchema.safeParse(minimal).success).toBe(true);
  });
  it('refuse un email invalide, une fonction inconnue ou une commune vide', () => {
    expect(demandeContactSchema.safeParse({ ...valide, email: 'pas-un-email' }).success).toBe(false);
    expect(demandeContactSchema.safeParse({ ...valide, fonction: 'Président' }).success).toBe(false);
    expect(demandeContactSchema.safeParse({ ...valide, commune: ' ' }).success).toBe(false);
  });
  it('refuse un message démesuré', () => {
    expect(demandeContactSchema.safeParse({ ...valide, message: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('emailDemandeContactHtml', () => {
  it('contient les coordonnées du demandeur', () => {
    const d = demandeContactSchema.parse(valide);
    const html = emailDemandeContactHtml(d);
    expect(html).toContain('Fay-les-Étangs');
    expect(html).toContain('mairie@exemple.fr');
    expect(html).toContain('03 44 00 00 00');
  });
  it('échappe le contenu saisi contre l\'injection HTML', () => {
    const d = demandeContactSchema.parse({ ...valide, nom: '<img src=x onerror=alert(1)>', message: '<script>x</script>' });
    const html = emailDemandeContactHtml(d);
    expect(html).not.toContain('<script>x</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('sujetDemandeContact', () => {
  it('reste sur une seule ligne même si la commune contient des retours à la ligne', () => {
    const d = demandeContactSchema.parse({ ...valide, commune: 'Fay\r\nBcc: x@y.z' });
    expect(sujetDemandeContact(d)).not.toMatch(/[\r\n]/);
  });
});
