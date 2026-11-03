// worker/test/recherche-commune.test.ts
// Couvre filtreRechercheCommune (src/routes/decouverte.ts) : recherche de la page « Rejoindre »
// par code postal quand la saisie n'est faite que de chiffres, par nom sinon.
import { describe, it, expect } from 'vitest';
import { filtreRechercheCommune, motifNomCommune } from '../src/routes/decouverte';

describe('filtreRechercheCommune', () => {
  it('cherche par code postal (préfixe) pour 2 à 5 chiffres', () => {
    expect(filtreRechercheCommune('03100')).toEqual({ code_postal: 'like.03100*', order: 'code_postal.asc,nom.asc', limit: '60' });
    expect(filtreRechercheCommune('031').code_postal).toBe('like.031*');
  });

  it('cherche par nom dans tous les autres cas', () => {
    expect(filtreRechercheCommune('Montluçon').order).toBe('nom.asc');
    expect(filtreRechercheCommune('031000').nom).toBe('imatch.031000'); // 6 chiffres : pas un code postal
    expect(filtreRechercheCommune('80 132').nom).toBe('imatch.80.*132');
  });
});

// Vérifie le motif comme le ferait Postgres (~*, insensible à la casse) sur de vrais noms.
function trouve(saisie: string, nom: string): boolean {
  return new RegExp(motifNomCommune(saisie), 'i').test(nom);
}

describe('motifNomCommune', () => {
  it('accepte les noms composés tapés sans tiret ni apostrophe', () => {
    expect(trouve('fontaine sur somme', 'Fontaine-sur-Somme')).toBe(true);
    expect(trouve('fontaine somme', 'Fontaine-sur-Somme')).toBe(true);
    expect(trouve('saint ouen l aumone', "Saint-Ouen-l'Aumône")).toBe(true);
  });

  it('ignore les accents, dans la saisie comme dans le nom', () => {
    expect(trouve('fay les etangs', 'Fay-les-Étangs')).toBe(true);
    expect(trouve('Fay-les-Étangs', 'Fay-les-Étangs')).toBe(true);
    expect(trouve('montlucon', 'Montluçon')).toBe(true);
    expect(trouve('eaucourt', 'Fontaine-sur-Somme')).toBe(false);
  });

  it('ne laisse passer aucun caractère spécial de regex', () => {
    expect(motifNomCommune('a.*(b)|[c]')).toBe('[aàâäÀÂÄ].*b.*[cçÇ]');
    expect(motifNomCommune('***')).toBe('^$');
  });
});
