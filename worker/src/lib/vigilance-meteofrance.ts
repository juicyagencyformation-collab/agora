// worker/src/lib/vigilance-meteofrance.ts
// Synchronisation automatique de la vigilance météo officielle (API Vigilance Météo-France,
// gratuite avec compte : https://portail-api.meteofrance.fr) vers la table alertes_meteo.
// No-op silencieux tant que METEOFRANCE_CLIENT_ID/METEOFRANCE_CLIENT_SECRET ne sont pas
// configurés (wrangler secret put) — la fonctionnalité manuelle (worker/src/routes/alertes_meteo.ts)
// fonctionne sans ça.
//
// ⚠️ Le détail exact du JSON retourné par l'API (noms de champs) n'est documenté que dans le
// Swagger accessible après connexion au portail — non consultable sans compte réel. Le parsing
// ci-dessous est basé sur la doc publique (produit "textesvigilance", phénomènes numérotés 1-9,
// couleurs 1=vert à 4=rouge) et devra être vérifié/ajusté au premier vrai appel avec un compte.
import { supabaseSelect, supabaseSelectTout, supabaseUpdate, supabaseUpsert } from '../db';

export const TYPES_VIGILANCE = [
  'vent_violent', 'pluie_inondation', 'orages', 'crues',
  'neige_verglas', 'canicule', 'grand_froid', 'avalanches',
] as const;
export const NIVEAUX_VIGILANCE = ['jaune', 'orange', 'rouge'] as const;

// Numérotation officielle des phénomènes Météo-France (1 à 9) — 9 = vagues-submersion, hors
// périmètre (littoral/DOM-TOM, pas les petites communes rurales visées par Agora).
const PHENOMENE_PAR_CODE: Record<string, (typeof TYPES_VIGILANCE)[number]> = {
  '1': 'vent_violent', '2': 'pluie_inondation', '3': 'orages', '4': 'crues',
  '5': 'neige_verglas', '6': 'canicule', '7': 'grand_froid', '8': 'avalanches',
};
// 1 = vert (aucune alerte), 2 = jaune, 3 = orange, 4 = rouge.
const NIVEAU_PAR_COULEUR: Record<string, (typeof NIVEAUX_VIGILANCE)[number] | undefined> = {
  '2': 'jaune', '3': 'orange', '4': 'rouge',
};
// Le jaune ("soyez attentif") est très fréquent — l'omettre évite un bandeau quasi permanent
// et réserve l'automatique aux niveaux réellement actionnables. Un jaune reste possible à la
// main si une mairie veut vraiment le communiquer.
const NIVEAUX_AUTO_AFFICHES = new Set(['orange', 'rouge']);

async function obtenirTokenMeteoFrance(env: any): Promise<string | null> {
  if (!env.METEOFRANCE_CLIENT_ID || !env.METEOFRANCE_CLIENT_SECRET) return null;
  try {
    const identifiants = btoa(`${env.METEOFRANCE_CLIENT_ID}:${env.METEOFRANCE_CLIENT_SECRET}`);
    const res = await fetch('https://portail-api.meteofrance.fr/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${identifiants}` },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) { console.error('Échec authentification Météo-France :', res.status, await res.text()); return null; }
    const data: any = await res.json();
    return data.access_token ?? null;
  } catch (e) {
    console.error('Erreur authentification Météo-France :', e);
    return null;
  }
}

async function recupererBulletinDepartement(token: string, departement: string): Promise<any | null> {
  try {
    const res = await fetch(
      `https://public-api.meteofrance.fr/public/DPVigilance/v1/textesvigilance/encours?domain=${encodeURIComponent(departement)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    );
    if (!res.ok) { console.error(`Échec bulletin vigilance département ${departement} :`, res.status); return null; }
    return await res.json();
  } catch (e) {
    console.error(`Erreur bulletin vigilance département ${departement} :`, e);
    return null;
  }
}

// Extrait {type, niveau}[] d'un bulletin — isolé dans sa propre fonction pour que le seul
// endroit à corriger, une fois le vrai format connu, soit ici.
function extrairePhenomenesActifs(bulletin: any): { type: (typeof TYPES_VIGILANCE)[number]; niveau: string }[] {
  const items: any[] = bulletin?.product?.text_bloc_items ?? bulletin?.phenomenes ?? [];
  const resultat: { type: (typeof TYPES_VIGILANCE)[number]; niveau: string }[] = [];
  for (const item of items) {
    const type = PHENOMENE_PAR_CODE[String(item.phenomenon_id ?? item.code)];
    const niveau = NIVEAU_PAR_COULEUR[String(item.phenomenon_max_color_id ?? item.niveau)];
    if (type && niveau && NIVEAUX_AUTO_AFFICHES.has(niveau)) resultat.push({ type, niveau });
  }
  return resultat;
}

async function appliquerBulletinCommune(env: any, communeId: string, bulletin: any) {
  const actifs = extrairePhenomenesActifs(bulletin);

  if (actifs.length) {
    await supabaseUpsert(
      env, 'alertes_meteo',
      actifs.map((a) => ({ commune_id: communeId, type: a.type, niveau: a.niveau, origine: 'auto', fin: null })),
      'commune_id,type,origine',
    );
  }

  // Referme les alertes auto dont le type n'est plus (ou plus assez fort) dans le bulletin.
  const typesActifs = new Set(actifs.map((a) => a.type));
  const enCours = await supabaseSelect(env, 'alertes_meteo', {
    select: 'id,type', commune_id: `eq.${communeId}`, origine: 'eq.auto', fin: 'is.null',
  });
  for (const ligne of enCours) {
    if (!typesActifs.has(ligne.type)) {
      await supabaseUpdate(env, 'alertes_meteo', { fin: new Date().toISOString() }, { id: `eq.${ligne.id}` });
    }
  }
}

// Point d'entrée cron (voir worker/src/cron.ts) — un bulletin récupéré par département, appliqué
// à toutes les communes de ce département en une fois.
export async function synchroniserVigilanceMeteoFrance(env: any) {
  const token = await obtenirTokenMeteoFrance(env);
  if (!token) return; // identifiants pas encore configurés : fonctionnalité auto pas activée

  const communes = await supabaseSelectTout(env, 'communes', { select: 'id,departement', departement: 'not.is.null' });
  if (!communes.length) return;

  const departements = [...new Set(communes.map((c: any) => c.departement))];
  const bulletins = new Map<string, any>();
  for (const dep of departements) {
    const bulletin = await recupererBulletinDepartement(token, dep);
    if (bulletin) bulletins.set(dep, bulletin);
  }

  for (const commune of communes) {
    const bulletin = bulletins.get(commune.departement);
    if (bulletin) await appliquerBulletinCommune(env, commune.id, bulletin);
  }
}
