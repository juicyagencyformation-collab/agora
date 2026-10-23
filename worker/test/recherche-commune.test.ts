// worker/test/recherche-commune.test.ts
// Couvre filtreRechercheCommune (src/routes/decouverte.ts) : recherche de la page « Rejoindre »
// par code postal quand la saisie n'est faite que de chiffres, par nom sinon.
import { describe, it, expect } from 'vitest';
import { filtreRechercheCommune } from '../src/routes/decouverte';

describe('filtreRechercheCommune', () => {
  it('cherche par code postal (préfixe) pour 2 à 5 chiffres', () => {
    expect(filtreRechercheCommune('03100')).toEqual({ code_postal: 'like.03100*', order: 'code_postal.asc,nom.asc', limit: '30' });
    expect(filtreRechercheCommune('031').code_postal).toBe('like.031*');
  });

  it('cherche par nom dans tous les autres cas', () => {
    expect(filtreRechercheCommune('Montluçon')).toEqual({ nom: 'ilike.*Montluçon*', order: 'nom.asc', limit: '10' });
    expect(filtreRechercheCommune('031000').nom).toBe('ilike.*031000*'); // 6 chiffres : pas un code postal
    expect(filtreRechercheCommune('80 132').nom).toBe('ilike.*80 132*');
  });
});
