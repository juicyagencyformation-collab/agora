// worker/test/palier-gratuit.test.ts
// Couvre la règle du bouton « Enregistrer le palier gratuit » (PUT /administration/onglets-gratuits,
// décidée avec Léandre le 2026-11-03) : un module ajouté s'active pour toutes les communes
// gratuites ; un module retiré ne se désactive que pour celles jamais utilisées ; réenregistrer
// sans changement ne touche à rien. On ne retire jamais un acquis.
import { describe, it, expect } from 'vitest';
import { differencePalier, planifierPalierGratuit } from '../src/backoffice/administration';

describe('palier gratuit', () => {
  it('calcule les modules ajoutés et retirés', () => {
    expect(differencePalier(['actualites', 'conseil'], ['actualites', 'enigmes'])).toEqual({ ajoutes: ['enigmes'], retires: ['conseil'] });
    expect(differencePalier(['actualites'], ['actualites'])).toEqual({ ajoutes: [], retires: [] });
  });

  it('active un module ajouté pour toutes les communes gratuites, utilisées ou non', () => {
    const { lignes, nbConservees } = planifierPalierGratuit(['enigmes'], [], ['c1', 'c2'], new Set(['c2']));
    expect(lignes).toEqual([
      { commune_id: 'c1', cle: 'enigmes', actif: true },
      { commune_id: 'c2', cle: 'enigmes', actif: true },
    ]);
    expect(nbConservees).toBe(0);
  });

  it('ne retire un module qu’aux communes jamais utilisées', () => {
    const { lignes, nbConservees } = planifierPalierGratuit([], ['conseil', 'lois'], ['jamais', 'utilisee'], new Set(['utilisee']));
    expect(lignes).toEqual([
      { commune_id: 'jamais', cle: 'conseil', actif: false },
      { commune_id: 'jamais', cle: 'lois', actif: false },
    ]);
    expect(nbConservees).toBe(1);
  });

  it('n’écrit rien quand rien ne change', () => {
    expect(planifierPalierGratuit([], [], ['c1', 'c2'], new Set()).lignes).toEqual([]);
  });
});
