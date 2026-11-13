// worker/test/reponse-enigme.test.ts
import { describe, it, expect } from 'vitest';
import { normaliserReponse } from '../src/routes/chasses_tresor';

const pareil = (a: string, b: string) => normaliserReponse(a) === normaliserReponse(b);

describe("normaliserReponse (énigmes de chasse et de balade)", () => {
  it('ignore casse, accents et espaces en trop', () => {
    expect(pareil('  GÉNÉRAUX ', 'generaux')).toBe(true);
    expect(pareil('Sans   Ayde', 'sans ayde')).toBe(true);
  });
  it('traite tirets et apostrophes (droites ou typographiques) comme des espaces', () => {
    expect(pareil('pont-levis', 'PONT LEVIS')).toBe(true);
    expect(pareil('pont‑levis', 'pont levis')).toBe(true); // tiret insécable
    expect(pareil('l’église', "l'eglise")).toBe(true);
    expect(pareil("l'eglise", 'l eglise')).toBe(true);
    expect(pareil('Saint-Valery-sur-Somme', 'saint valery sur somme')).toBe(true);
  });
  it('ignore la ponctuation autour de la réponse et les ligatures', () => {
    expect(pareil('« Marais ! »', 'marais')).toBe(true);
    expect(pareil('cœur', 'COEUR')).toBe(true);
  });
  it('reste strict sur les lettres et les chiffres', () => {
    expect(pareil('pontlevis', 'pont levis')).toBe(false);
    expect(pareil('1919', '1918')).toBe(false);
    expect(pareil('bon', 'le bon')).toBe(false);
  });
});
