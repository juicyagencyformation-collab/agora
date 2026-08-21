// worker/test/tarification.test.ts
// Couvre le nouveau barème au nombre d'habitants (voir src/backoffice/tarification.ts et
// db/migrations/050_bareme_habitant.sql) : plancher pour les petites communes, dégressivité
// au-delà du seuil, et le supplément fixe (pas par habitant) de la formule Accompagné.
import { describe, it, expect } from 'vitest';
import { calculerPrixAutonomie, calculerPrixAccompagne, type BaremeTarifaire } from '../src/backoffice/tarification';

const BAREME: BaremeTarifaire = {
  taux_base: 1, seuil_degressif: 1000, taux_degressif: 0.5,
  prix_plancher: 250, supplement_accompagne: 200, prix_patrimoine_premium: 749,
};

describe('calculerPrixAutonomie', () => {
  it('applique le plancher pour une très petite commune', () => {
    expect(calculerPrixAutonomie(50, BAREME)).toBe(250);
    expect(calculerPrixAutonomie(0, BAREME)).toBe(250);
  });

  it('applique le taux de base linéairement en dessous du seuil', () => {
    expect(calculerPrixAutonomie(500, BAREME)).toBe(500);
    expect(calculerPrixAutonomie(1000, BAREME)).toBe(1000);
  });

  it('bascule au taux dégressif seulement au-delà du seuil', () => {
    // 1000 au taux plein + 500 au taux dégressif (0,5) = 1000 + 250 = 1250
    expect(calculerPrixAutonomie(1500, BAREME)).toBe(1250);
    // 1000 + 4000*0.5 = 3000
    expect(calculerPrixAutonomie(5000, BAREME)).toBe(3000);
  });

  it('le prix ne redescend jamais quand la population augmente (fonction croissante)', () => {
    let dernier = 0;
    for (let hab = 0; hab <= 8000; hab += 137) {
      const prix = calculerPrixAutonomie(hab, BAREME);
      expect(prix).toBeGreaterThanOrEqual(dernier);
      dernier = prix;
    }
  });

  it('ignore une population négative ou invalide plutôt que de produire un prix négatif', () => {
    expect(calculerPrixAutonomie(-100, BAREME)).toBe(250);
    expect(calculerPrixAutonomie(NaN, BAREME)).toBe(250);
  });

  it('tronque une population non entière (protection basique contre une saisie erronée)', () => {
    expect(calculerPrixAutonomie(500.7, BAREME)).toBe(500);
  });
});

describe('calculerPrixAccompagne', () => {
  it('ajoute le supplément fixe, pas un multiplicateur par habitant', () => {
    expect(calculerPrixAccompagne(50, BAREME)).toBe(250 + 200);
    expect(calculerPrixAccompagne(500, BAREME)).toBe(500 + 200);
    expect(calculerPrixAccompagne(5000, BAREME)).toBe(3000 + 200);
  });

  it('reste toujours strictement supérieur au prix Autonomie de la même population', () => {
    for (const hab of [0, 100, 999, 1000, 1001, 5000]) {
      expect(calculerPrixAccompagne(hab, BAREME)).toBeGreaterThan(calculerPrixAutonomie(hab, BAREME));
    }
  });
});

describe('barème personnalisé (paramètres modifiés depuis le backoffice)', () => {
  it('un seuil ou un plancher différent change bien le résultat (rien n\'est codé en dur)', () => {
    const baremeStrict: BaremeTarifaire = {
      taux_base: 2, seuil_degressif: 200, taux_degressif: 1, prix_plancher: 500,
      supplement_accompagne: 300, prix_patrimoine_premium: 900,
    };
    expect(calculerPrixAutonomie(100, baremeStrict)).toBe(500); // plancher plus haut
    // 200*2 + 300*1 = 700
    expect(calculerPrixAutonomie(500, baremeStrict)).toBe(700);
  });
});
