// worker/test/utilisateurs-backoffice.test.ts
// Couvre le nettoyage de la recherche de l'onglet Utilisateurs (src/backoffice/administration.ts) :
// le texte tapé est inséré dans un filtre PostgREST or=(...), il ne doit jamais pouvoir en
// changer la structure.
import { describe, it, expect } from 'vitest';
import { nettoyerRecherche } from '../src/backoffice/administration';

describe('nettoyerRecherche', () => {
  it('garde une recherche normale (accents, @, tiret, point)', () => {
    expect(nettoyerRecherche('Élodie')).toBe('Élodie');
    expect(nettoyerRecherche('jean-paul.martin@mairie.fr')).toBe('jean-paul.martin@mairie.fr');
  });

  it('retire tout ce qui casserait ou détournerait le filtre or=(...)', () => {
    expect(nettoyerRecherche('Dupont, Jean')).toBe('Dupont Jean');
    expect(nettoyerRecherche('x*,role.eq.superadmin)')).toBe('x role.eq.superadmin');
    expect(nettoyerRecherche('a"b\'c\\d:e(f)')).toBe('a b c d e f');
  });

  it('borne la longueur et gère l’absence de saisie', () => {
    expect(nettoyerRecherche('a'.repeat(500))).toHaveLength(100);
    expect(nettoyerRecherche(undefined)).toBe('');
    expect(nettoyerRecherche('   ')).toBe('');
  });
});
