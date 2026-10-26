// worker/test/nom-public.test.ts
import { describe, it, expect } from 'vitest';
import { nomPublic } from '../src/lib/nom-public';

const lea = { id: 'u1', prenom: 'Léa', nom: 'martin', affichage_nom: 'initiale' };

describe('nomPublic', () => {
  it('affiche prénom + initiale du nom par défaut', () => {
    expect(nomPublic(lea, 'autre')).toEqual({ prenom: 'Léa', nom: 'M.' });
  });
  it("respecte l'anonymat choisi, sans fuite du prénom ni du nom", () => {
    expect(nomPublic({ ...lea, affichage_nom: 'anonyme' }, 'autre')).toEqual({ prenom: 'Anonyme', nom: '' });
  });
  it("montre toujours son nom complet à l'intéressé lui-même", () => {
    expect(nomPublic({ ...lea, affichage_nom: 'anonyme' }, 'u1')).toEqual({ prenom: 'Léa', nom: 'martin' });
  });
  it('reste sûr sans utilisateur ou sans nom', () => {
    expect(nomPublic(undefined, 'u1')).toEqual({ prenom: '?', nom: '' });
    expect(nomPublic({ id: 'u2', prenom: 'Paul', nom: '' }, 'u1')).toEqual({ prenom: 'Paul', nom: '' });
  });
});
