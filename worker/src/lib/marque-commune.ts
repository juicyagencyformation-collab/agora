// worker/src/lib/marque-commune.ts
// « Marque » de la commune (2026-11-10) : logo dans l'en-tête de l'appli, nom et icône de la
// commune sur l'écran d'accueil du téléphone (au lieu de « Agora »). Réservé aux communes à
// l'offre complète ou fondatrices (forfait ≠ Gratuit), actives, ayant envoyé un logo.
// L'icône est un carré PNG 512×512 fabriqué par le navigateur de l'élu au moment de l'envoi du
// logo (POST /commune/logo/icone), rangé à côté du logo dans R2 : son URL se déduit de celle du
// logo (même dossier, même ?v=), sans colonne en base.
export function marqueCommune(cm: any): { logo_url: string; icone_url: string | null } | null {
  if (!cm?.logo_url || !cm.forfait || cm.forfait === 'Gratuit' || cm.statut_client !== 'active') return null;
  const [base, version] = String(cm.logo_url).split('?');
  const icone = /\/logo\.(png|jpe?g)$/.test(base) ? base.replace(/logo\.(png|jpe?g)$/, 'icone.png') + (version ? `?${version}` : '') : null;
  return { logo_url: cm.logo_url, icone_url: icone };
}

// Largeur et hauteur lues dans l'en-tête PNG (signature + bloc IHDR), sans décoder l'image.
export function dimensionsPng(octets: Uint8Array): { largeur: number; hauteur: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (octets.length < 24 || signature.some((o, i) => octets[i] !== o)) return null;
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  return { largeur: vue.getUint32(16), hauteur: vue.getUint32(20) };
}
