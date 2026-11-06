// worker/src/lib/anti-robots.ts
// Protection des formulaires d'inscription contre la création de comptes en masse (2026-11-06) :
// inscription habitant et Explorateur (auth.ts, POST /:slug/auth/register) et « Rejoindre ma
// commune » (decouverte.ts). S'ajoute au piège à robots (champ caché) et à la limite par IP
// (lib/securite.ts) déjà en place.
import { supabaseCount, supabaseSelect, journaliser } from '../db';
import { ipClient } from './securite';

// Cloudflare Turnstile (captcha invisible, exception à la règle n°3 validée par Léandre le
// 2026-11-06). Inactif tant que le secret TURNSTILE_SECRET n'est pas posé sur le Worker (tests,
// avant la création du widget) ; dès qu'il l'est, refus SANS EXCEPTION si le jeton manque, est
// invalide, vise une autre action ou vient d'un autre site — y compris si Cloudflare ne répond pas.
export async function jetonTurnstileValide(c: any, jeton: unknown, action: string): Promise<boolean> {
  const secret = c.env.TURNSTILE_SECRET;
  if (!secret) return true;
  const sitesAutorises = new Set(String(c.env.TURNSTILE_HOSTNAMES ?? '').split(',').map((h) => h.trim()).filter(Boolean));
  if (typeof jeton !== 'string' || !jeton || jeton.length > 2048 || !sitesAutorises.size) return false;
  try {
    const ip = ipClient(c);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret, response: jeton, ...(ip ? { remoteip: ip } : {}) }),
    });
    if (!res.ok) return false;
    const resultat: any = await res.json();
    return resultat.success === true && resultat.action === action && sitesAutorises.has(resultat.hostname);
  } catch {
    return false;
  }
}

// Un humain met plusieurs secondes à remplir un formulaire ; un robot, quelques millisecondes.
// La durée est mesurée par la page (champ duree_saisie_ms) : facile à falsifier pour un robot
// ciblé, mais elle écarte gratuitement les robots génériques. Absente = pas de verdict.
export const saisieTropRapide = (duree: unknown) => typeof duree === 'number' && duree >= 0 && duree < 2500;

// Plafond d'inscriptions : au-delà, on refuse et on alerte le backoffice (anomalie « haute »,
// voir suivi-communes.ts) — une seule alerte par heure et par motif, pour ne pas inonder le journal.
async function alerter(env: any, details: string) {
  const depuis = new Date(Date.now() - 3600_000).toISOString();
  const [deja] = await supabaseSelect(env, 'journal_activite', {
    select: 'id', action: 'eq.plafond_inscriptions', details: `eq.${details}`, created_at: `gte.${depuis}`, limit: '1',
  }).catch(() => [] as any[]);
  if (!deja) await journaliser(env, null, 'plafond_inscriptions', details);
}

// Inscriptions par commune et par heure : large pour un vrai lancement (affiche, réunion
// publique), un car de touristes côté Explorateurs, mais un robot l'atteint vite.
export const PLAFOND_INSCRIPTIONS_HEURE = 40;
export const PLAFOND_INSCRIPTIONS_HEURE_EXPLORATEURS = 150;

export async function plafondInscriptionsAtteint(env: any, communeId: string, nomCommune: string, max: number): Promise<boolean> {
  const n = await supabaseCount(env, 'users', {
    commune_id: `eq.${communeId}`, created_at: `gte.${new Date(Date.now() - 3600_000).toISOString()}`,
  });
  if (n < max) return false;
  await alerter(env, `${nomCommune} : ${max} inscriptions en moins d'une heure`);
  return true;
}

// « Rejoindre ma commune » envoie un email de confirmation : plafond GLOBAL sur 24 h, pour garder
// le quota du plan gratuit de Resend (100/jour) aux emails essentiels (mot de passe oublié…).
export const PLAFOND_DEMANDES_REJOINDRE_JOUR = 50;

export async function plafondDemandesRejoindreAtteint(env: any): Promise<boolean> {
  const n = await supabaseCount(env, 'activations_libres', { created_at: `gte.${new Date(Date.now() - 24 * 3600_000).toISOString()}` });
  if (n < PLAFOND_DEMANDES_REJOINDRE_JOUR) return false;
  await alerter(env, `« Rejoindre ma commune » : ${PLAFOND_DEMANDES_REJOINDRE_JOUR} demandes en 24 h`);
  return true;
}
