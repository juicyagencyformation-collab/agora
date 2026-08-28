// worker/src/lib/vigilance-meteofrance.ts
// Synchronisation automatique de la vigilance météo officielle vers la table alertes_meteo.
//
// Source : miroir public Opendatasoft du bulletin de vigilance Météo-France (dataset
// "weatherref-france-vigilance-meteo-departement"), interrogé en LECTURE ANONYME — aucune
// inscription, aucune clé, aucun jeton à gérer. Choisi après que le portail officiel
// (portail-api.meteofrance.fr, inscription + jeton OAuth) a posé problème à l'inscription
// côté Léandre (2026-08-28) — ce miroir republie les mêmes données officielles sans cette
// friction. Vérifié en direct avant intégration (champs confirmés, pas une supposition) :
//   GET https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/
//       weatherref-france-vigilance-meteo-departement/records?where=domain_id="80"
//   → { domain_id, phenomenon_id, phenomenon, color_id, color, begin_time, end_time, ... }
import { supabaseSelect, supabaseSelectTout, supabaseUpdate, supabaseUpsert } from '../db';
import { deduireDepartement } from './geo';
import { notifierNouvelleVigilance } from './notification-meteo';

export const TYPES_VIGILANCE = [
  'vent_violent', 'pluie_inondation', 'orages', 'crues',
  'neige_verglas', 'canicule', 'grand_froid', 'avalanches',
] as const;
export const NIVEAUX_VIGILANCE = ['jaune', 'orange', 'rouge'] as const;

// Numérotation officielle des phénomènes Météo-France (phenomenon_id, 1 à 9) — 9 =
// vagues-submersion, hors périmètre (littoral/DOM-TOM, pas les petites communes rurales
// visées par Agora).
const PHENOMENE_PAR_CODE: Record<number, (typeof TYPES_VIGILANCE)[number]> = {
  1: 'vent_violent', 2: 'pluie_inondation', 3: 'orages', 4: 'crues',
  5: 'neige_verglas', 6: 'canicule', 7: 'grand_froid', 8: 'avalanches',
};
// color_id : 1 = vert (aucune alerte), 2 = jaune, 3 = orange, 4 = rouge.
const NIVEAU_PAR_COULEUR: Record<number, (typeof NIVEAUX_VIGILANCE)[number] | undefined> = {
  2: 'jaune', 3: 'orange', 4: 'rouge',
};
// Le jaune ("soyez attentif") est très fréquent — l'omettre évite un bandeau quasi permanent
// et réserve l'automatique aux niveaux réellement actionnables. Un jaune reste possible à la
// main si une mairie veut vraiment le communiquer.
const NIVEAUX_AUTO_AFFICHES = new Set(['orange', 'rouge']);

const URL_JEU_DE_DONNEES = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/weatherref-france-vigilance-meteo-departement/records';

type RisqueActif = { type: (typeof TYPES_VIGILANCE)[number]; niveau: (typeof NIVEAUX_VIGILANCE)[number] };

// Un département n'a jamais plus de quelques lignes actives à la fois (8 phénomènes max) —
// limit=20 est une marge large, pas une pagination à gérer.
async function recupererRisquesDepartement(departement: string): Promise<RisqueActif[]> {
  try {
    const params = new URLSearchParams({ where: `domain_id="${departement}" and color_id>1`, limit: '20' });
    const res = await fetch(`${URL_JEU_DE_DONNEES}?${params}`);
    if (!res.ok) { console.error(`Échec vigilance département ${departement} :`, res.status); return []; }
    const data: any = await res.json();
    const maintenant = Date.now();

    const resultat: RisqueActif[] = [];
    for (const item of data.results ?? []) {
      const type = PHENOMENE_PAR_CODE[item.phenomenon_id];
      const niveau = NIVEAU_PAR_COULEUR[item.color_id];
      if (!type || !niveau || !NIVEAUX_AUTO_AFFICHES.has(niveau)) continue;
      // Le jeu de données inclut aussi les échéances à venir (J+1) — on ne garde que ce qui
      // est actif maintenant, la fenêtre à venir sera reprise au prochain passage du cron.
      const debut = new Date(item.begin_time).getTime();
      const fin = new Date(item.end_time).getTime();
      if (maintenant < debut || maintenant > fin) continue;
      resultat.push({ type, niveau });
    }
    return resultat;
  } catch (e) {
    console.error(`Erreur vigilance département ${departement} :`, e);
    return [];
  }
}

async function appliquerRisquesCommune(env: any, communeId: string, risques: RisqueActif[]) {
  // Interrogé AVANT l'upsert : sert à la fois à détecter les risques qui viennent de s'activer
  // (pour ne notifier qu'une fois, pas à chaque passage du cron tant que ça reste actif) et
  // ceux qui ne le sont plus (pour les refermer, voir plus bas).
  const enCoursAvant = await supabaseSelect(env, 'alertes_meteo', {
    select: 'id,type', commune_id: `eq.${communeId}`, origine: 'eq.auto', fin: 'is.null',
  });
  const typesDejaActifs = new Set(enCoursAvant.map((l: any) => l.type));
  const nouveaux = risques.filter((r) => !typesDejaActifs.has(r.type));

  if (risques.length) {
    await supabaseUpsert(
      env, 'alertes_meteo',
      risques.map((r) => ({ commune_id: communeId, type: r.type, niveau: r.niveau, origine: 'auto', fin: null })),
      'commune_id,type,origine',
    );
  }

  // Referme les alertes auto dont le type n'est plus (ou plus assez fort) actif.
  const typesActifs = new Set(risques.map((r) => r.type));
  for (const ligne of enCoursAvant) {
    if (!typesActifs.has(ligne.type)) {
      await supabaseUpdate(env, 'alertes_meteo', { fin: new Date().toISOString() }, { id: `eq.${ligne.id}` });
    }
  }

  for (const r of nouveaux) {
    await notifierNouvelleVigilance(env, communeId, r.type, r.niveau);
  }
}

// Point d'entrée cron (voir worker/src/index.ts, toutes les 6h) — un jeu de risques récupéré
// par département, appliqué à toutes les communes de ce département en une fois.
export async function synchroniserVigilanceMeteoFrance(env: any) {
  const communes = await supabaseSelectTout(env, 'communes', { select: 'id,departement,lat,lng' });
  if (!communes.length) return;

  // Filet de sécurité pour le stock existant : le département se déduit normalement tout seul
  // dès que les coordonnées d'une commune sont (re)posées (routes/commune.ts,
  // backoffice/administration.ts) — ceci couvre les communes dont les coordonnées existaient
  // déjà avant l'ajout de cette déduction automatique.
  for (const commune of communes) {
    if (!commune.departement && commune.lat != null && commune.lng != null) {
      const departement = await deduireDepartement(commune.lat, commune.lng);
      if (departement) {
        commune.departement = departement;
        await supabaseUpdate(env, 'communes', { departement }, { id: `eq.${commune.id}` });
      }
    }
  }

  const avecDepartement = communes.filter((c: any) => c.departement);
  if (!avecDepartement.length) return;

  const departements = [...new Set(avecDepartement.map((c: any) => c.departement))];
  const risquesParDepartement = new Map<string, RisqueActif[]>();
  for (const dep of departements) {
    risquesParDepartement.set(dep, await recupererRisquesDepartement(dep));
  }

  for (const commune of avecDepartement) {
    await appliquerRisquesCommune(env, commune.id, risquesParDepartement.get(commune.departement) ?? []);
  }
}
