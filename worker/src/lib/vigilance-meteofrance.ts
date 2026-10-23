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

type RisqueActif = {
  type: (typeof TYPES_VIGILANCE)[number];
  niveau: (typeof NIVEAUX_VIGILANCE)[number];
  debut: string;
  fin: string;
};
type Fenetre = RisqueActif & { debutMs: number; finMs: number };

// Récupère en UNE requête tous les orange/rouge de France (toutes échéances), regroupés par
// département. Même en pleine tempête le volume reste faible (24 lignes pour toute la France le
// 2026-10-23, vent orange sur 8 départements) — la pagination n'est qu'un filet de sécurité.
// Renvoie null si la source est injoignable : l'appelant ne doit alors RIEN toucher (sinon une
// panne d'Opendatasoft refermerait à tort de vraies vigilances en cours).
async function recupererRisquesFrance(): Promise<Map<string, RisqueActif[]> | null> {
  const lignes: any[] = [];
  try {
    for (let offset = 0; offset < 1000; offset += 100) {
      const params = new URLSearchParams({ where: 'color_id>2', limit: '100', offset: String(offset) });
      const res = await fetch(`${URL_JEU_DE_DONNEES}?${params}`);
      if (!res.ok) { console.error('Échec récupération vigilance :', res.status); return null; }
      const data: any = await res.json();
      lignes.push(...(data.results ?? []));
      if ((data.results ?? []).length < 100) break;
    }
  } catch (e) {
    console.error('Erreur récupération vigilance :', e);
    return null;
  }

  const fenetres = new Map<string, Fenetre[]>(); // clé : "departement|type"
  for (const item of lignes) {
    const type = PHENOMENE_PAR_CODE[item.phenomenon_id];
    const niveau = NIVEAU_PAR_COULEUR[item.color_id];
    if (!item.domain_id || !type || !niveau || !NIVEAUX_AUTO_AFFICHES.has(niveau)) continue;
    const debutMs = new Date(item.begin_time).getTime();
    const finMs = new Date(item.end_time).getTime();
    if (Number.isNaN(debutMs) || Number.isNaN(finMs)) continue;
    const cle = `${item.domain_id}|${type}`;
    fenetres.set(cle, [...(fenetres.get(cle) ?? []), { type, niveau, debut: item.begin_time, fin: item.end_time, debutMs, finMs }]);
  }

  // Le bulletin découpe un même épisode en tranches (ex. orange 10h-18h puis orange 18h-22h,
  // ou J puis J+1) : on garde la tranche active maintenant et on prolonge sa fin tant que la
  // suivante (orange/rouge) s'enchaîne sans trou — sinon le bandeau disparaîtrait à la fin
  // de chaque tranche en attendant le prochain passage du cron. Le niveau affiché reste celui
  // de la tranche en cours. Les tranches pas encore commencées sont reprises au cron suivant.
  const maintenant = Date.now();
  const parDepartement = new Map<string, RisqueActif[]>();
  for (const [cle, liste] of fenetres) {
    liste.sort((a, b) => a.debutMs - b.debutMs);
    const active = liste.find((f) => f.debutMs <= maintenant && maintenant < f.finMs);
    if (!active) continue;
    let finMs = active.finMs;
    let fin = active.fin;
    for (const f of liste) {
      if (f.debutMs <= finMs && f.finMs > finMs) { finMs = f.finMs; fin = f.fin; }
    }
    const departement = cle.split('|')[0];
    parDepartement.set(departement, [
      ...(parDepartement.get(departement) ?? []),
      { type: active.type, niveau: active.niveau, debut: active.debut, fin },
    ]);
  }
  return parDepartement;
}

// Point d'entrée cron (voir worker/src/index.ts, toutes les heures).
//
// ⚠️ Nombre de requêtes CONSTANT, indépendant du nombre de communes : la table communes contient
// aussi des milliers de prospects (import 2026-10), et l'ancienne version (plusieurs requêtes
// Supabase PAR commune) se faisait couper par la limite de sous-requêtes Cloudflare au bout de
// quelques communes — constaté le 2026-10-23 : vigilance orange vent sur la Somme, seules 4
// communes servies, Eaucourt jamais atteinte. Ne jamais réintroduire de boucle de requêtes par
// commune ici. Coût : 2 requêtes les jours calmes (sortie anticipée), une dizaine un jour de
// vigilance, + les envois push. Historique : docs/journal-correctifs.md.
export async function synchroniserVigilanceMeteoFrance(env: any) {
  const risquesParDepartement = await recupererRisquesFrance();
  if (!risquesParDepartement) return;

  // Alertes auto encore affichées (fin future, ou fin nulle = ancien format d'avant 2026-10-23).
  const maintenantIso = new Date().toISOString();
  const enCours = await supabaseSelectTout(env, 'alertes_meteo', {
    select: 'id,commune_id,type', origine: 'eq.auto', or: `(fin.is.null,fin.gt.${maintenantIso})`,
  });

  // Sortie anticipée — la grande majorité des passages : rien d'actif en France, rien à refermer.
  if (!risquesParDepartement.size && !enCours.length) return;

  const communes = await supabaseSelectTout(env, 'communes', { select: 'id,departement', departement: 'not.is.null' });

  // Filet de sécurité : le département se déduit normalement tout seul dès que les coordonnées
  // d'une commune sont (re)posées (routes/commune.ts, backoffice/administration.ts). Plafonné à
  // 5 par passage pour ne jamais faire exploser le nombre de requêtes — le reste suivra aux
  // passages suivants.
  const sansDepartement = await supabaseSelect(env, 'communes', {
    select: 'id,lat,lng', departement: 'is.null', lat: 'not.is.null', lng: 'not.is.null', limit: '5',
  });
  for (const commune of sansDepartement) {
    const departement = await deduireDepartement(commune.lat, commune.lng);
    if (departement) {
      await supabaseUpdate(env, 'communes', { departement }, { id: `eq.${commune.id}` });
      communes.push({ id: commune.id, departement });
    }
  }

  const enCoursParCle = new Set(enCours.map((l: any) => `${l.commune_id}|${l.type}`));

  const lignes: object[] = [];
  const actives = new Set<string>();
  const nouvelles: { communeId: string; type: string; niveau: string }[] = [];
  for (const commune of communes) {
    for (const r of risquesParDepartement.get(commune.departement) ?? []) {
      const cle = `${commune.id}|${r.type}`;
      actives.add(cle);
      lignes.push({ commune_id: commune.id, type: r.type, niveau: r.niveau, origine: 'auto', debut: r.debut, fin: r.fin });
      if (!enCoursParCle.has(cle)) nouvelles.push({ communeId: commune.id, type: r.type, niveau: r.niveau });
    }
  }

  // Upsert d'abord : l'affichage ne doit jamais dépendre de la réussite des notifications.
  if (lignes.length) await supabaseUpsert(env, 'alertes_meteo', lignes, 'commune_id,type,origine');

  // Referme celles qui ne sont plus actives (levée anticipée par Météo-France, ou ancien format).
  const aFermer = enCours.filter((l: any) => !actives.has(`${l.commune_id}|${l.type}`)).map((l: any) => l.id);
  if (aFermer.length) {
    await supabaseUpdate(env, 'alertes_meteo', { fin: maintenantIso }, { id: `in.(${aFermer.join(',')})` });
  }

  if (!nouvelles.length) return;
  const communesConcernees = [...new Set(nouvelles.map((n) => n.communeId))];
  const abonnes = await supabaseSelect(env, 'users', {
    select: 'id,commune_id', notif_vigilance: 'eq.true', commune_id: `in.(${communesConcernees.join(',')})`,
  });
  const abonnesParCommune = new Map<string, string[]>();
  for (const u of abonnes) {
    abonnesParCommune.set(u.commune_id, [...(abonnesParCommune.get(u.commune_id) ?? []), u.id]);
  }
  for (const n of nouvelles) {
    const userIds = abonnesParCommune.get(n.communeId);
    if (!userIds) continue;
    try {
      await notifierNouvelleVigilance(env, n.communeId, n.type, n.niveau, userIds);
    } catch (e) {
      console.error(`Notification vigilance ${n.communeId} :`, e);
    }
  }
}
