// worker/src/backoffice/quota-resend.ts
// Suivi presque en direct du quota Resend (migration 113, demandé par Léandre le 2026-11-20),
// affiché en tête de la page « Aujourd'hui ». À chaque lecture : une requête à Resend (liste des
// domaines, sans rien envoyer) pour relever ses en-têtes de quota, et une lecture d'etat_resend
// (dernière valeur notée par lib/email.ts) si Resend ne les renvoie pas. 2 requêtes au plus.
// Plafonds du plan gratuit (mémoire « Resend en plan gratuit ») : à ajuster si le plan change.
// Le quota du jour suit le jour UTC (remise à zéro à minuit UTC, 1 h ou 2 h à Paris).
import { Hono } from 'hono';
import { supabaseSelect } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { noterQuotaResend } from '../lib/email';

export const LIMITE_JOUR_RESEND = 100;
export const LIMITE_MOIS_RESEND = 3000;

const app = new Hono();
app.use('*', backofficeMiddleware);

app.get('/', async (c) => {
  let direct = false;
  if (c.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${c.env.RESEND_API_KEY}` } });
      if (res.headers.get('x-resend-daily-quota') !== null || res.headers.get('x-resend-monthly-quota') !== null) {
        await noterQuotaResend(c.env, res, { forcer: true });
        direct = true;
      }
    } catch (e) {
      console.error('Relevé du quota Resend', e);
    }
  }
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
      direct,
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
