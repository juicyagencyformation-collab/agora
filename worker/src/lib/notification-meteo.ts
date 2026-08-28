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

const LABELS_TYPE_VIGILANCE: Record<string, string> = {
  vent_violent: 'vent violent', pluie_inondation: 'pluie-inondation', orages: 'orages',
  crues: 'crues', neige_verglas: 'neige-verglas', canicule: 'canicule',
  grand_froid: 'grand froid', avalanches: 'avalanches',
};

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

export async function envoyerResumeMeteoMatinal(env: any) {
  const communes = await supabaseSelectTout(env, 'communes', { select: 'id,lat,lng' });

  for (const commune of communes) {
    if (commune.lat == null || commune.lng == null) continue;

    const userIds = await utilisateursAbonnesA(env, commune.id, 'notif_meteo');
    if (!userIds.length) continue;

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
