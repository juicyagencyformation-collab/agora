// worker/src/lib/password.ts

// PBKDF2 (natif Web Crypto, aucune dépendance) avec sel aléatoire par utilisateur et
// 100 000 itérations — recommandation OWASP. Nettement plus résistant à la force brute
// que le SHA-256 simple utilisé initialement.
export async function hasherMotDePasse(motDePasse: string): Promise<string> {
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cleBase = await crypto.subtle.importKey('raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sel, iterations: 100000, hash: 'SHA-256' }, cleBase, 256);
  const hashHex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const selHex = [...sel].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$100000$${selHex}$${hashHex}`;
}

// Vérifie un mot de passe contre un hash stocké — gère les deux formats :
// le nouveau (PBKDF2 salé) et l'ancien (SHA-256 simple, pour les comptes créés avant
// cette mise à jour). Aucune migration forcée : la bascule se fait automatiquement et
// silencieusement à la prochaine connexion réussie (voir /login dans auth.ts).
export async function verifierMotDePasse(motDePasse: string, hashStocke: string): Promise<boolean> {
  if (hashStocke.startsWith('pbkdf2$')) {
    const [, iterationsStr, selHex, hashHex] = hashStocke.split('$');
    const sel = new Uint8Array(selHex.match(/.{2}/g)!.map((o) => parseInt(o, 16)));
    const cleBase = await crypto.subtle.importKey('raw', new TextEncoder().encode(motDePasse), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: sel, iterations: parseInt(iterationsStr, 10), hash: 'SHA-256' }, cleBase, 256,
    );
    const hashCalcule = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashCalcule === hashHex;
  }
  // Ancien format (SHA-256 sans sel)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(motDePasse));
  const hashSha256 = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashSha256 === hashStocke;
}
