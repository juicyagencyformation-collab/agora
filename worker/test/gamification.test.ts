// worker/test/gamification.test.ts
import { describe, it, expect } from 'vitest';
import { xpRequisPourNiveau, niveauDepuisXp } from '../src/lib/gamification';

describe('xpRequisPourNiveau / niveauDepuisXp', () => {
  it('0 XP correspond au niveau 1', () => {
    expect(niveauDepuisXp(0)).toBe(1);
  });

  it('le seuil du niveau 2 est bien atteint pile à la bonne valeur', () => {
    const seuil = xpRequisPourNiveau(1); // XP nécessaire pour dépasser le niveau 1
    expect(niveauDepuisXp(seuil)).toBeGreaterThanOrEqual(2);
    expect(niveauDepuisXp(seuil - 1)).toBe(1);
  });

  it('le niveau ne peut jamais reculer avec plus d\'XP (fonction croissante)', () => {
    let dernierNiveau = 1;
    for (let xp = 0; xp <= 2000; xp += 50) {
      const niveau = niveauDepuisXp(xp);
      expect(niveau).toBeGreaterThanOrEqual(dernierNiveau);
      dernierNiveau = niveau;
    }
  });

  it('les seuils de niveaux sont bien strictement croissants', () => {
    for (let n = 1; n < 20; n++) {
      expect(xpRequisPourNiveau(n + 1)).toBeGreaterThan(xpRequisPourNiveau(n));
    }
  });
});
