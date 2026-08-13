// worker/src/backoffice/index.ts
// Point d'entrée du backoffice interne Juicy Solutions. Monté sur /backoffice, AVANT la
// résolution de tenant (/:slug/*) dans worker/src/index.ts — sinon "backoffice" serait pris
// pour un slug de commune. Aucune route ici ne dépend d'un commune_id : périmètre transverse.
import { Hono } from 'hono';
import auth from './auth';
import administration from './administration';
import prospection from './prospection';
import onboarding from './onboarding';
import { chargerFiche } from './modele-fiche';
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';
import { verifierSignatureSvix } from '../lib/svix';

const app = new Hono();

// Contenu de la fiche de présentation — PUBLIC (pas d'auth) : la fiche est consultable par les
// communes via le lien de l'email. Contenu marketing uniquement, rien de sensible. L'édition,
// elle, passe par /administration/modele-fiche (protégée).
app.get('/fiche-contenu', async (c) => {
  return c.json(await chargerFiche(c.env));
});

// Webhook Resend (bounces / plaintes) — PUBLIC mais authentifié par SIGNATURE Svix (secret
// RESEND_WEBHOOK_SECRET). Enregistre l'email rejeté et signale l'adresse sur le prospect.
app.post('/webhook-resend', async (c) => {
  const corpsBrut = await c.req.text();
  const ok = await verifierSignatureSvix(
    c.env.RESEND_WEBHOOK_SECRET,
    c.req.header('svix-id'), c.req.header('svix-timestamp'), c.req.header('svix-signature'),
    corpsBrut,
  );
  if (!ok) return c.json({ erreur: 'Signature invalide' }, 401);

  let evt: any;
  try { evt = JSON.parse(corpsBrut); } catch { return c.json({ erreur: 'Corps invalide' }, 400); }

  if (evt?.type === 'email.bounced' || evt?.type === 'email.complained') {
    const eventId = c.req.header('svix-id') || null;
    const to = evt?.data?.to;
    const destinataires: string[] = Array.isArray(to) ? to : (to ? [to] : []);
    const sujet = evt?.data?.subject || null;
    const raison = evt?.data?.bounce?.message || evt?.data?.bounce?.subType || evt?.data?.reason || evt.type;

    for (const email of destinataires) {
      if (!email) continue;
      const [prospect] = await supabaseSelect(c.env, 'prospects', { select: 'nom', contact_email: `eq.${email}` });
      const existant = eventId
        ? await supabaseSelect(c.env, 'emails_rejetes', { select: 'id', event_id: `eq.${eventId}`, email: `eq.${email}` })
        : [];
      if (!existant.length) {
        await supabaseInsert(c.env, 'emails_rejetes', {
          event_id: eventId, email, commune_nom: prospect?.nom || null, sujet, type: evt.type, raison,
        });
      }
      await supabaseUpdate(c.env, 'prospects', { email_invalide: true }, { contact_email: `eq.${email}` });
    }
  }
  return c.json({ ok: true });
});

app.route('/auth', auth);
app.route('/administration', administration);
app.route('/prospection', prospection);
app.route('/onboarding', onboarding);

export default app;
