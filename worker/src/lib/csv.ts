// worker/src/lib/csv.ts
// Génération CSV minimale (séparateur point-virgule, convention Excel FR), réutilisée par les
// exports du backoffice (communes, prospects). Pas de dépendance externe.
export function versCsv(lignes: Record<string, unknown>[], colonnes: { cle: string; titre: string }[]): string {
  const echapper = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const entete = colonnes.map((c) => echapper(c.titre)).join(';');
  const corps = lignes.map((ligne) => colonnes.map((c) => echapper((ligne as Record<string, unknown>)[c.cle])).join(';'));
  // BOM UTF-8 : Excel (Windows) ouvre sinon les accents en charabia.
  return '﻿' + [entete, ...corps].join('\r\n');
}
