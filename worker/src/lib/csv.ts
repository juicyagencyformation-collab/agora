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

// Lecture CSV minimale, symétrique de versCsv ci-dessus (séparateur point-virgule, guillemets
// pour échapper un champ contenant le séparateur/un saut de ligne/un guillemet). Utilisé pour
// importer un fichier source externe volumineux (ex: Répertoire National des Élus, voir
// prospection.ts) — pas de dépendance externe. Renvoie un tableau de lignes (première = en-têtes).
export function depuisCsv(texte: string): string[][] {
  const contenu = texte.replace(/^﻿/, ''); // BOM éventuel
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let dansGuillemets = false;
  for (let i = 0; i < contenu.length; i++) {
    const car = contenu[i];
    if (dansGuillemets) {
      if (car === '"' && contenu[i + 1] === '"') { champ += '"'; i++; }
      else if (car === '"') { dansGuillemets = false; }
      else { champ += car; }
    } else if (car === '"') {
      dansGuillemets = true;
    } else if (car === ';') {
      ligne.push(champ); champ = '';
    } else if (car === '\n' || car === '\r') {
      if (car === '\r' && contenu[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.length > 1 || ligne[0] !== '') lignes.push(ligne);
      ligne = [];
    } else {
      champ += car;
    }
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}
