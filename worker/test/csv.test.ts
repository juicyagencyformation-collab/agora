// worker/test/csv.test.ts
// depuisCsv() lit le format produit par versCsv (point-virgule, guillemets pour échapper) et
// aussi des fichiers externes comme le Répertoire National des Élus (voir prospection.ts) —
// vérifie les cas qui cassent facilement un parseur écrit à la main : guillemets, CRLF, BOM.
import { describe, it, expect } from 'vitest';
import { versCsv, depuisCsv } from '../src/lib/csv';

describe('depuisCsv', () => {
  it('lit des lignes simples séparées par des points-virgules', () => {
    expect(depuisCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('gère les fins de ligne CRLF et LF', () => {
    expect(depuisCsv('a;b\r\n1;2\n3;4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('retire un BOM UTF-8 en tête de fichier', () => {
    expect(depuisCsv('﻿a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('déséchappe un champ entre guillemets contenant le séparateur', () => {
    expect(depuisCsv('a;b\n"1;1";2')).toEqual([['a', 'b'], ['1;1', '2']]);
  });

  it('déséchappe un guillemet doublé à l\'intérieur d\'un champ guilleté', () => {
    expect(depuisCsv('a\n"il dit ""bonjour"""')).toEqual([['a'], ['il dit "bonjour"']]);
  });

  it('gère un champ vide en fin de ligne', () => {
    expect(depuisCsv('a;b\n1;')).toEqual([['a', 'b'], ['1', '']]);
  });

  it('ignore une ligne finale totalement vide (pas de ligne fantôme après le dernier retour)', () => {
    expect(depuisCsv('a;b\n1;2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('round-trip avec versCsv pour un jeu de données réaliste', () => {
    const lignes = [{ nom: 'Eaucourt-sur-Somme', maire: 'Léandre "Le Maire" Sallé' }, { nom: 'Ailly; le-Haut-Clocher', maire: 'Un Nom' }];
    const csv = versCsv(lignes, [{ cle: 'nom', titre: 'Nom' }, { cle: 'maire', titre: 'Maire' }]);
    const relu = depuisCsv(csv);
    expect(relu).toEqual([
      ['Nom', 'Maire'],
      ['Eaucourt-sur-Somme', 'Léandre "Le Maire" Sallé'],
      ['Ailly; le-Haut-Clocher', 'Un Nom'],
    ]);
  });
});
