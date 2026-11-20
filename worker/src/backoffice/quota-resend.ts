// worker/src/backoffice/quota-resend.ts
// Suivi du quota Resend (migration 113, demandé par Léandre le 2026-11-20), affiché en tête de la
// page « Aujourd'hui ». Une seule lecture en base : la dernière consommation notée par lib/email.ts
// à l'envoi (ou à la lecture d'un email reçu). Resend ne la renvoie pas sur une simple consultation
// (essayé avec GET /domains le 2026-11-20 : aucun en-tête de quota), d'où ce relevé à l'usage, qui
// suit pourtant la vraie valeur puisque le quota ne bouge qu'à l'envoi ou à la réception.
// Plafonds du plan gratuit (mémoire « Resend en plan gratuit ») : à ajuster si le plan change.
// Le quota du jour suit le jour UTC (remise à zéro à minuit UTC, 1 h ou 2 h à Paris).
import { Hono } from 'hono';
import { supabaseSelect } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';

export const LIMITE_JOUR_RESEND = 100;
export const LIMITE_MOIS_RESEND = 3000;

const app = new Hono();
app.use('*', backofficeMiddleware);

app.get('/', async (c) => {
  try {
    const [etat] = await supabaseSelect(c.env, 'etat_resend', {
      select: 'quota_jour,quota_mois,dernier_refus,dernier_refus_le,maj_le', id: 'eq.1',
    });
    const minuitUtc = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    // Relevé d'avant minuit UTC : le compteur du jour est déjà revenu à zéro chez Resend.
    const jourPerime = !etat?.maj_le || new Date(etat.maj_le) < minuitUtc;
    return c.json({
      jour: etat?.quota_jour == null ? null : jourPerime ? 0 : etat.quota_jour,
      mois: etat?.quota_mois ?? null,
      limite_jour: LIMITE_JOUR_RESEND,
      limite_mois: LIMITE_MOIS_RESEND,
      maj_le: etat?.maj_le ?? null,
      // Refus pour quota du jour en cours seulement (un refus d'hier n'est plus d'actualité).
      refus: etat?.dernier_refus_le && new Date(etat.dernier_refus_le) >= minuitUtc
        ? { type: etat.dernier_refus, le: etat.dernier_refus_le } : null,
      remise_a_zero: new Date(minuitUtc.getTime() + 24 * 3600 * 1000).toISOString(),
    });
  } catch (e) {
    console.error('Quota Resend', e);
    return c.json({ erreur: 'Suivi du quota indisponible.' }, 500);
  }
});

export default app;
