// worker/test/prospection-annuaire.test.ts
// Les champs contact de l'API annuaire service-public sont des CHAÎNES contenant du JSON
// (tableaux d'objets). Ce parsing est fragile : on couvre les cas réels et dégradés.
import { describe, it, expect } from 'vitest';
import { premiereValeur, formaterAdresse } from '../src/backoffice/prospection';

describe('premiereValeur', () => {
  it('extrait la valeur du premier élément', () => {
    expect(premiereValeur('[{"valeur": "03 22 27 17 22", "description": ""}]')).toBe('03 22 27 17 22');
    expect(premiereValeur('[{"libelle": "", "valeur": "https://eaucourt-sur-somme.fr"}]')).toBe('https://eaucourt-sur-somme.fr');
  });
  it('renvoie null sur entrée vide, nulle ou JSON invalide', () => {
    expect(premiereValeur(null)).toBeNull();
    expect(premiereValeur('')).toBeNull();
    expect(premiereValeur('[]')).toBeNull();
    expect(premiereValeur('pas du json')).toBeNull();
    expect(premiereValeur('[{"description": "sans valeur"}]')).toBeNull();
  });
});

describe('formaterAdresse', () => {
  it('reconstruit une adresse lisible', () => {
    const brut = '[{"numero_voie": "Rue du Pont", "complement1": "", "code_postal": "80580", "nom_commune": "Eaucourt-sur-Somme"}]';
    expect(formaterAdresse(brut)).toBe('Rue du Pont, 80580 Eaucourt-sur-Somme');
  });
  it('renvoie null sur entrée vide ou invalide', () => {
    expect(formaterAdresse(null)).toBeNull();
    expect(formaterAdresse('[]')).toBeNull();
    expect(formaterAdresse('oups')).toBeNull();
  });
});
