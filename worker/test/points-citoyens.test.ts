// worker/test/points-citoyens.test.ts
import { describe, it, expect } from 'vitest';
import {
  multiplicateurPourOccurrence, trouverPalier, moisPrecedent, calculerStreakMensuel,
} from '../src/lib/points-citoyens';

describe('multiplicateurPourOccurrence — dégressivité anti-farming', () => {
  it('100% pour les 3 premières fois', () => {
    expect(multiplicateurPourOccurrence(1)).toBe(1);
    expect(multiplicateurPourOccurrence(2)).toBe(1);
    expect(multiplicateurPourOccurrence(3)).toBe(1);
  });

  it('70% de la 4e à la 6e fois', () => {
    expect(multiplicateurPourOccurrence(4)).toBe(0.7);
    expect(multiplicateurPourOccurrence(5)).toBe(0.7);
    expect(multiplicateurPourOccurrence(6)).toBe(0.7);
  });

  it('40% (plancher) à partir de la 7e fois, jamais 0', () => {
    expect(multiplicateurPourOccurrence(7)).toBe(0.4);
    expect(multiplicateurPourOccurrence(50)).toBe(0.4);
    expect(multiplicateurPourOccurrence(1000)).toBeGreaterThan(0);
  });

  it('est une fonction décroissante (ou stable), jamais croissante avec l\'occurrence', () => {
    let dernier = multiplicateurPourOccurrence(1);
    for (let occurrence = 2; occurrence <= 30; occurrence++) {
      const courant = multiplicateurPourOccurrence(occurrence);
      expect(courant).toBeLessThanOrEqual(dernier);
      dernier = courant;
    }
  });
});

describe('trouverPalier — progression vers le palier suivant', () => {
  const paliers = [
    { nom: 'Premier pas citoyen', seuil: 1 },
    { nom: 'Citoyen engagé', seuil: 150 },
    { nom: 'Citoyen actif', seuil: 400 },
  ];

  it('aucun palier configuré → tout est nul, progression à 0', () => {
    const resultat = trouverPalier([], 500);
    expect(resultat.actuel).toBeNull();
    expect(resultat.suivant).toBeNull();
    expect(resultat.progression_pct).toBe(0);
  });

  it('score sous le premier seuil → pas encore de palier actuel', () => {
    const resultat = trouverPalier(paliers, 0);
    expect(resultat.actuel).toBeNull();
    expect(resultat.suivant?.nom).toBe('Premier pas citoyen');
  });

  it('score pile au seuil d\'un palier → ce palier devient l\'actuel (inclusif)', () => {
    const resultat = trouverPalier(paliers, 150);
    expect(resultat.actuel?.nom).toBe('Citoyen engagé');
    expect(resultat.suivant?.nom).toBe('Citoyen actif');
  });

  it('score entre deux paliers → progression cohérente (0-100)', () => {
    // à mi-chemin entre 150 (Citoyen engagé) et 400 (Citoyen actif)
    const resultat = trouverPalier(paliers, 275);
    expect(resultat.actuel?.nom).toBe('Citoyen engagé');
    expect(resultat.suivant?.nom).toBe('Citoyen actif');
    expect(resultat.progression_pct).toBe(50);
  });

  it('score au-delà du dernier palier → palier maximum, progression à 100, aucun suivant', () => {
    const resultat = trouverPalier(paliers, 10000);
    expect(resultat.actuel?.nom).toBe('Citoyen actif');
    expect(resultat.suivant).toBeNull();
    expect(resultat.progression_pct).toBe(100);
  });

  it('la progression ne dépasse jamais 100, même en cas d\'arrondi', () => {
    for (let score = 0; score <= 500; score += 7) {
      const resultat = trouverPalier(paliers, score);
      expect(resultat.progression_pct).toBeLessThanOrEqual(100);
      expect(resultat.progression_pct).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('moisPrecedent — calcul de mois avec gestion du changement d\'année', () => {
  it('mois normal, pas de changement d\'année', () => {
    expect(moisPrecedent('2026-08')).toBe('2026-07');
  });

  it('changement d\'année (janvier → décembre de l\'année précédente)', () => {
    expect(moisPrecedent('2026-01')).toBe('2025-12');
  });
});

describe('calculerStreakMensuel — série de mois consécutifs avec au moins une action', () => {
  it('première action jamais enregistrée (dernierMois null) → démarre à 1', () => {
    expect(calculerStreakMensuel(null, '2026-08', 0)).toBe(1);
  });

  it('déjà une action ce mois-ci → le streak ne change pas', () => {
    expect(calculerStreakMensuel('2026-08', '2026-08', 4)).toBe(4);
  });

  it('mois précédent consécutif → incrémente', () => {
    expect(calculerStreakMensuel('2026-07', '2026-08', 4)).toBe(5);
  });

  it('mois précédent consécutif avec changement d\'année → incrémente quand même', () => {
    expect(calculerStreakMensuel('2025-12', '2026-01', 5)).toBe(6);
  });

  it('trou d\'au moins un mois → réinitialise à 1', () => {
    expect(calculerStreakMensuel('2026-05', '2026-08', 9)).toBe(1);
  });
});
