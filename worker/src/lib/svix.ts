// worker/src/lib/svix.ts
// Vérification de la signature des webhooks au format Svix (utilisé par Resend). Le secret est
// de la forme `whsec_<base64>`. La signature attendue = HMAC-SHA256(base64decode(secret),
// `${id}.${timestamp}.${body}`), encodée en base64, à comparer aux signatures `v1,<sig>` de
// l'en-tête `svix-signature` (séparées par des espaces). Aucune dépendance externe.

function base64VersOctets(b64: string): Uint8Array {
  const bin = atob(b64);
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  return octets;
}

function octetsVersBase64(octets: Uint8Array): string {
  let bin = '';
  for (const o of octets) bin += String.fromCharCode(o);
  return btoa(bin);
}

export async function verifierSignatureSvix(
  secret: string,
  svixId: string | undefined,
  svixTimestamp: string | undefined,
  svixSignature: string | undefined,
  corpsBrut: string,
): Promise<boolean> {
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return false;

  const cleOctets = base64VersOctets(secret.replace(/^whsec_/, ''));
  const cle = await crypto.subtle.importKey('raw', cleOctets, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const donnees = new TextEncoder().encode(`${svixId}.${svixTimestamp}.${corpsBrut}`);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cle, donnees));
  const attendue = octetsVersBase64(signature);

  // L'en-tête peut contenir plusieurs signatures « v1,<sig> » séparées par des espaces.
  const fournies = svixSignature.split(' ').map((partie) => partie.split(',')[1]).filter(Boolean);
  return fournies.includes(attendue);
}
