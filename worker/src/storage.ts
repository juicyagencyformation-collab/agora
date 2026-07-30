// worker/src/storage.ts
// Le fichier transite par le Worker (pas d'URL présignée à signer nous-mêmes) :
// le client envoie les octets, le Worker écrit dans R2 via son binding natif,
// et retourne l'URL publique reconstruite à partir de R2_PUBLIC_BASE.

export async function uploaderFichier(env: any, key: string, donnees: ArrayBuffer, contentType: string): Promise<string> {
  if (!env.BUCKET_R2) {
    throw new Error('R2 non configuré : binding BUCKET_R2 absent de wrangler.toml');
  }
  await env.BUCKET_R2.put(key, donnees, { httpMetadata: { contentType } });
  return `${env.R2_PUBLIC_BASE}/${key}`;
}

export async function deleteObject(env: any, key: string): Promise<void> {
  if (!env.BUCKET_R2) return;
  await env.BUCKET_R2.delete(key);
}
