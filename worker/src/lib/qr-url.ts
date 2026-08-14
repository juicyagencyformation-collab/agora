// worker/src/lib/qr-url.ts
// Génère un QR code SVG pour une URL quelconque, côté serveur (Worker) — jamais côté client :
// le générateur maison worker/src/lib/qrcode.ts est plafonné à 42 caractères (pensé pour un
// UUID), largement insuffisant pour une URL de commune. Ici on utilise qrcode-generator (npm,
// dépendance serveur — donc AUCUNE entorse à la règle "zéro lib côté client" du frontend
// citoyen) qui gère nativement les URL de longueur quelconque (choix de version + correction
// d'erreur Reed-Solomon déjà implémentés dans la lib).
import qrcode from 'qrcode-generator';

export function genererQrSvgUrl(texte: string): string {
  const qr = qrcode(0, 'M'); // typeNumber 0 = taille auto-détectée selon la longueur du texte
  qr.addData(texte);
  qr.make();

  const nbModules = qr.getModuleCount();
  const taillePixel = 4;
  const marge = 4; // en modules
  const taille = (nbModules + marge * 2) * taillePixel;

  let carres = '';
  for (let ligne = 0; ligne < nbModules; ligne++) {
    for (let colonne = 0; colonne < nbModules; colonne++) {
      if (!qr.isDark(ligne, colonne)) continue;
      const x = (colonne + marge) * taillePixel;
      const y = (ligne + marge) * taillePixel;
      carres += `<rect x="${x}" y="${y}" width="${taillePixel}" height="${taillePixel}"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${taille} ${taille}" width="${taille}" height="${taille}" role="img">`
    + `<rect width="${taille}" height="${taille}" fill="#fff"/>`
    + `<g fill="#000">${carres}</g>`
    + `</svg>`;
}
