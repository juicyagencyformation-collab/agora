// worker/src/lib/eml.ts
// Brouillon d'email au format .eml (RFC 5322 + MIME), prêt à s'ouvrir dans Outlook (2026-11-25) :
// l'en-tête « X-Unsent: 1 » fait ouvrir le fichier en mode RÉDACTION (destinataire, objet, mise en
// forme HTML exacte et pièces jointes), Léandre n'a plus qu'à relire et cliquer Envoyer depuis son
// propre compte. Aucune dépendance : MIME écrit à la main, en base64 pour tout ce qui n'est pas ASCII.

export type PieceJointe = { nom: string; type: string; contenu: Uint8Array };

const CRLF = '\r\n';

function base64Octets(octets: Uint8Array): string {
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}
const base64Texte = (texte: string) => base64Octets(new TextEncoder().encode(texte));
// Lignes de 76 caractères au plus (RFC 2045).
const enLignes = (b64: string) => (b64.match(/.{1,76}/g) ?? ['']).join(CRLF);

// En-tête lisible tel quel s'il est en ASCII simple, sinon encodé (RFC 2047) — accents de l'objet.
export function encoderEnTete(texte: string): string {
  const propre = texte.replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(propre) ? propre : `=?UTF-8?B?${base64Texte(propre)}?=`;
}

// Nom de fichier ASCII de secours (« Plaquette - Fay-les-Etangs.pdf »), la version UTF-8 exacte
// étant donnée à côté (RFC 2231) pour les messageries qui la comprennent.
function nomAscii(nom: string): string {
  return nom.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}

// Version texte de secours (messageries sans HTML) : balises retirées, paragraphes conservés.
export function texteDepuisHtml(html: string): string {
  return html
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function construireEml(m: {
  de: string; a: string; repondreA?: string; objet: string; html: string; pieces?: PieceJointe[];
}): string {
  const frontiere = (n: string) => `----=_Agora_${n}_${crypto.randomUUID().replace(/-/g, '')}`;
  const mixte = frontiere('mixte');
  const alternative = frontiere('alt');
  const enTetes = [
    'X-Unsent: 1',
    `From: ${m.de}`,
    `To: ${m.a}`,
    ...(m.repondreA ? [`Reply-To: ${m.repondreA}`] : []),
    `Subject: ${encoderEnTete(m.objet)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixte}"`,
  ];
  const html = /<html[\s>]/i.test(m.html) ? m.html : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${m.html}</body></html>`;
  const parties = [
    `--${mixte}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    '',
    `--${alternative}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    enLignes(base64Texte(texteDepuisHtml(m.html))),
    `--${alternative}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    enLignes(base64Texte(html)),
    `--${alternative}--`,
  ];
  for (const p of m.pieces ?? []) {
    parties.push(
      `--${mixte}`,
      `Content-Type: ${p.type}; name="${nomAscii(p.nom)}"`,
      `Content-Disposition: attachment; filename="${nomAscii(p.nom)}"; filename*=UTF-8''${encodeURIComponent(p.nom)}`,
      'Content-Transfer-Encoding: base64',
      '',
      enLignes(base64Octets(p.contenu)),
    );
  }
  parties.push(`--${mixte}--`, '');
  return enTetes.join(CRLF) + CRLF + CRLF + parties.join(CRLF);
}
