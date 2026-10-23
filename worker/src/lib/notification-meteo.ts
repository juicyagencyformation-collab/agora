// worker/src/lib/notification-meteo.ts
// Résumé météo du matin, envoyé une fois par jour (cron, voir worker/src/index.ts) aux
// citoyens ayant activé notif_meteo (opt-in, voir migration 056). Une notification par
// commune (même météo pour tout le monde), pas par utilisateur.
import { supabaseSelect, supabaseSelectTout } from '../db';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from './push';

const LABELS_METEO: Record<number, string> = {
  0: 'Ciel dégagé ☀️', 1: 'Plutôt dégagé 🌤️', 2: 'Partiellement nuageux ⛅', 3: 'Couvert ☁️',
  45: 'Brouillard 🌫️', 48: 'Brouillard givrant 🌫️',
  51: 'Bruine légère 🌦️', 53: 'Bruine 🌦️', 55: 'Bruine dense 🌦️',
  61: 'Pluie légère 🌧️', 63: 'Pluie 🌧️', 65: 'Forte pluie 🌧️',
  71: 'Neige légère 🌨️', 73: 'Neige 🌨️', 75: 'Forte neige ❄️',
  80: 'Averses 🌦️', 81: 'Averses fortes 🌧️', 82: 'Averses violentes ⛈️',
  95: 'Orage ⛈️', 96: 'Orage avec grêle ⛈️', 99: 'Orage violent ⛈️',
};

export const LABELS_TYPE_VIGILANCE: Record<string, string> = {
  vent_violent: 'vent violent', pluie_inondation: 'pluie-inondation', orages: 'orages',
  crues: 'crues', neige_verglas: 'neige-verglas', canicule: 'canicule',
  grand_froid: 'grand froid', avalanches: 'avalanches',
};

// Notification immédiate au déclenchement d'une vigilance orange/rouge — ne pas attendre le
// résumé du lendemain matin pour une info potentiellement urgente. Appelée à la fois par la
// création manuelle (routes/alertes_meteo.ts) et par la synchro auto, mais seulement pour un
// risque qui vient de s'activer (pas à chaque passage du cron tant qu'il reste actif — voir
// l'appelant). Préférence SÉPARÉE de notif_meteo (le digest quotidien) : rare et important,
// donc opt-out (true par défaut) plutôt qu'opt-in — quelqu'un peut vouloir être alerté d'une
// vigilance sans pour autant recevoir un bulletin météo tous les matins.
// abonnes : déjà récupérés en lot par la synchro auto (une requête pour toutes les communes) —
// omis par la route manuelle, qui ne concerne qu'une commune.
export async function notifierNouvelleVigilance(env: any, communeId: string, type: string, niveau: string, abonnes?: string[]) {
  const userIds = abonnes ?? await utilisateursAbonnesA(env, communeId, 'notif_vigilance');
  if (!userIds.length) return;
  await envoyerNotificationAUtilisateurs(
    env, communeId, userIds,
    `⚠️ Vigilance ${niveau} — ${LABELS_TYPE_VIGILANCE[type] ?? type}`,
    'Consultez les détails et les horaires dans l\'application.',
    '/index.html?onglet=accueil',
  );
}

async function resumeMeteoDuJour(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min` +
      `&timezone=Europe%2FParis&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    const label = LABELS_METEO[data.current.weathercode] ?? 'Météo du jour';
    const min = Math.round(data.daily.temperature_2m_min[0]);
    const max = Math.round(data.daily.temperature_2m_max[0]);
    return `${label} · ↓${min}° ↑${max}°`;
  } catch {
    return null;
  }
}

// Abonnés lus en UNE requête puis regroupés par commune : la table communes contient des
// milliers de prospects sans utilisateur, une requête par commune dépasserait la limite de
// sous-requêtes Cloudflare (même piège que lib/vigilance-meteofrance.ts, constaté 2026-10-23).
export async function envoyerResumeMeteoMatinal(env: any) {
  const abonnes = await supabaseSelectTout(env, 'users', { select: 'id,commune_id', notif_meteo: 'eq.true' });
  if (!abonnes.length) return;
  const abonnesParCommune = new Map<string, string[]>();
  for (const u of abonnes) {
    abonnesParCommune.set(u.commune_id, [...(abonnesParCommune.get(u.commune_id) ?? []), u.id]);
  }

  const communes = await supabaseSelect(env, 'communes', {
    select: 'id,lat,lng', id: `in.(${[...abonnesParCommune.keys()].join(',')})`,
    lat: 'not.is.null', lng: 'not.is.null',
  });

  for (const commune of communes) {
    const userIds = abonnesParCommune.get(commune.id) ?? [];

    const resumeMeteo = await resumeMeteoDuJour(commune.lat, commune.lng);
    if (!resumeMeteo) continue;

    // Vigilance active (orange/rouge uniquement, comme le bandeau accueil) : si présente,
    // elle prend le pas sur le titre — c'est l'info la plus importante du jour.
    const [vigilance] = await supabaseSelect(env, 'alertes_meteo', {
      select: 'type,niveau', commune_id: `eq.${commune.id}`,
      or: `(fin.is.null,fin.gt.${new Date().toISOString()})`,
      order: 'niveau.desc', limit: '1',
    });

    const titre = vigilance
      ? `⚠️ Vigilance ${vigilance.niveau} — ${LABELS_TYPE_VIGILANCE[vigilance.type] ?? vigilance.type}`
      : 'Bonjour ! 👋';
    const corps = vigilance ? `Et sinon côté météo : ${resumeMeteo}` : resumeMeteo;

    await envoyerNotificationAUtilisateurs(env, commune.id, userIds, titre, corps, '/index.html?onglet=accueil');
  }
}
