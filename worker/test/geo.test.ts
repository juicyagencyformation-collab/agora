// worker/test/geo.test.ts
import { describe, it, expect } from 'vitest';
import { distanceMetres } from '../src/lib/geo';

describe('distanceMetres', () => {
  it('la distance d\'un point à lui-même est nulle', () => {
    expect(distanceMetres(50.0, 2.0, 50.0, 2.0)).toBe(0);
  });

  it('calcule correctement une distance connue (Paris → Lyon, environ 392 km)', () => {
    const distance = distanceMetres(48.8566, 2.3522, 45.7640, 4.8357);
    const distanceKm = distance / 1000;
    expect(distanceKm).toBeGreaterThan(380);
    expect(distanceKm).toBeLessThan(400);
  });

  it('reste symétrique (A→B == B→A)', () => {
    const aVersB = distanceMetres(50.1, 1.8, 50.2, 1.9);
    const bVersA = distanceMetres(50.2, 1.9, 50.1, 1.8);
    expect(aVersB).toBeCloseTo(bVersA, 5);
  });

  it('une petite distance réaliste entre deux communes voisines reste sous 50 km', () => {
    // Eaucourt-sur-Somme et une commune voisine fictive à quelques centièmes de degré
    const distance = distanceMetres(50.0, 1.85, 50.05, 1.90);
    expect(distance / 1000).toBeLessThan(50);
  });
});
