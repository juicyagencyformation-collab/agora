// worker/src/lib/hash.ts
// SHA-256 hexadécimal — utilisé pour ne jamais stocker un jeton en clair (refresh tokens,
// jetons de réinitialisation, liens de connexion directe...). Fonction partagée pour éviter
// d'avoir une énième copie locale à chaque nouvel endroit qui en a besoin.
export async function hasherSha256Hex(valeur: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valeur));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
