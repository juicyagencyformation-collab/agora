// worker/src/lib/qrcode.ts
// Implémentation autonome de la norme QR (ISO/IEC 18004), Version 3, EC niveau M.
// Capacité mode octet V3-M : 42 caractères — un UUID (36 caractères) tient large.

const TAILLE = 29;
const CODEMOTS_DONNEES = 44;
const CODEMOTS_EC = 26;

const GF_EXP = new Array(512).fill(0);
const GF_LOG = new Array(256).fill(0);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

function gfPolyMul(a: number[], b: number[]): number[] {
  const res = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) res[i + j] ^= gfMul(a[i], b[j]);
  }
  return res;
}

function polynomeGenerateur(ecLen: number): number[] {
  let gen = [1];
  for (let i = 0; i < ecLen; i++) gen = gfPolyMul(gen, [1, GF_EXP[i]]);
  return gen;
}

function encoderReedSolomon(donnees: number[], ecLen: number): number[] {
  const gen = polynomeGenerateur(ecLen);
  const msg = [...donnees, ...new Array(ecLen).fill(0)];
  for (let i = 0; i < donnees.length; i++) {
    const facteur = msg[i];
    if (facteur !== 0) {
      for (let j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], facteur);
    }
  }
  return msg.slice(donnees.length);
}

function encoderDonnees(texte: string): number[] {
  const octets = new TextEncoder().encode(texte);
  const bits: number[] = [];
  const pousserBits = (valeur: number, nb: number) => {
    for (let i = nb - 1; i >= 0; i--) bits.push((valeur >> i) & 1);
  };

  pousserBits(0b0100, 4);
  pousserBits(octets.length, 8);
  octets.forEach((o) => pousserBits(o, 8));

  const capaciteBits = CODEMOTS_DONNEES * 8;
  const bitsRestants = capaciteBits - bits.length;
  pousserBits(0, Math.min(4, bitsRestants));
  while (bits.length % 8 !== 0) bits.push(0);

  const codemots: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codemots.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }

  const octetsPadding = [0xec, 0x11];
  let idx = 0;
  while (codemots.length < CODEMOTS_DONNEES) codemots.push(octetsPadding[idx++ % 2]);

  return codemots;
}

function calculerInfoFormat(masque: number): number[] {
  const ecLevelM = 0b00;
  const donnees5bits = (ecLevelM << 3) | masque;
  let valeur = donnees5bits << 10;
  const generateur = 0b10100110111;
  for (let i = 14; i >= 10; i--) {
    if ((valeur >> i) & 1) valeur ^= generateur << (i - 10);
  }
  const brut = (donnees5bits << 10) | valeur;
  const masqueXor = 0b101010000010010;
  const final = brut ^ masqueXor;
  return Array.from({ length: 15 }, (_, i) => (final >> (14 - i)) & 1);
}

export function genererMatriceQr(texte: string): boolean[][] {
  const matrice: (boolean | null)[][] = Array.from({ length: TAILLE }, () => new Array(TAILLE).fill(null));
  const reserve: boolean[][] = Array.from({ length: TAILLE }, () => new Array(TAILLE).fill(false));

  const poserMotif = (r0: number, c0: number, motif: number[][]) => {
    for (let r = 0; r < motif.length; r++) {
      for (let c = 0; c < motif[r].length; c++) {
        matrice[r0 + r][c0 + c] = motif[r][c] === 1;
        reserve[r0 + r][c0 + c] = true;
      }
    }
  };

  const MOTIF_FINDER = [
    [1,1,1,1,1,1,1],[1,0,0,0,0,0,1],[1,0,1,1,1,0,1],
    [1,0,1,1,1,0,1],[1,0,1,1,1,0,1],[1,0,0,0,0,0,1],[1,1,1,1,1,1,1],
  ];
  [[0,0],[0,TAILLE-7],[TAILLE-7,0]].forEach(([r,c]) => poserMotif(r, c, MOTIF_FINDER));
  for (let i = 0; i < 8; i++) {
    reserve[7][i] = reserve[i][7] = true;
    reserve[7][TAILLE-8+i] = reserve[i][TAILLE-8] = true;
    reserve[TAILLE-8][i] = reserve[TAILLE-8+i][7] = true;
  }

  const MOTIF_ALIGNEMENT = [[1,1,1,1,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,0,0,1],[1,1,1,1,1]];
  poserMotif(20, 20, MOTIF_ALIGNEMENT);

  for (let i = 8; i < TAILLE - 8; i++) {
    matrice[6][i] = i % 2 === 0; reserve[6][i] = true;
    matrice[i][6] = i % 2 === 0; reserve[i][6] = true;
  }

  matrice[4 * 3 + 9][8] = true; reserve[4 * 3 + 9][8] = true;

  for (let i = 0; i < 9; i++) { reserve[8][i] = true; reserve[i][8] = true; }
  for (let i = 0; i < 8; i++) { reserve[8][TAILLE-1-i] = true; reserve[TAILLE-1-i][8] = true; }

  const MASQUE = 0;
  const donneesBase = encoderDonnees(texte);
  const codemots = [...donneesBase, ...encoderReedSolomon(donneesBase, CODEMOTS_EC)];
  const bits: number[] = [];
  codemots.forEach((o) => { for (let i = 7; i >= 0; i--) bits.push((o >> i) & 1); });

  let bitIdx = 0;
  let montant = true;
  for (let colDroite = TAILLE - 1; colDroite > 0; colDroite -= 2) {
    if (colDroite === 6) colDroite--;
    for (let i = 0; i < TAILLE; i++) {
      const r = montant ? TAILLE - 1 - i : i;
      for (const c of [colDroite, colDroite - 1]) {
        if (reserve[r][c]) continue;
        const bit = bitIdx < bits.length ? bits[bitIdx++] : 0;
        const inverser = (r + c) % 2 === MASQUE;
        matrice[r][c] = inverser ? bit === 0 : bit === 1;
      }
    }
    montant = !montant;
  }

  const formatBits = calculerInfoFormat(MASQUE);
  for (let i = 0; i < 6; i++) matrice[8][i] = formatBits[i] === 1;
  matrice[8][7] = formatBits[6] === 1;
  matrice[8][8] = formatBits[7] === 1;
  matrice[7][8] = formatBits[8] === 1;
  for (let i = 9; i < 15; i++) matrice[14 - i][8] = formatBits[i] === 1;
  for (let i = 0; i < 8; i++) matrice[TAILLE-1-i][8] = formatBits[i] === 1;
  for (let i = 8; i < 15; i++) matrice[8][TAILLE-15+i] = formatBits[i] === 1;

  return matrice.map((ligne) => ligne.map((v) => v === true));
}

export function genererQrSvg(texte: string, taillePx = 290): string {
  const matrice = genererMatriceQr(texte);
  const module = taillePx / TAILLE;
  let rects = '';
  matrice.forEach((ligne, r) => {
    ligne.forEach((sombre, c) => {
      if (sombre) rects += `<rect x="${c * module}" y="${r * module}" width="${module}" height="${module}"/>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${taillePx} ${taillePx}" width="${taillePx}" height="${taillePx}"><rect width="${taillePx}" height="${taillePx}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
