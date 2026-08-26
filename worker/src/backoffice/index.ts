// worker/src/backoffice/index.ts
// Point d'entrée du backoffice interne Juicy Solutions. Monté sur /backoffice, AVANT la
// résolution de tenant (/:slug/*) dans worker/src/index.ts — sinon "backoffice" serait pris
// pour un slug de commune. Aucune route ici ne dépend d'un commune_id : périmètre transverse.
import { Hono } from 'hono';
import auth from './auth';
import administration from './administration';
import prospection from './prospection';
import onboarding from './onboarding';
import facturation from './facturation';
import { chargerFiche } from './modele-fiche';
import { chargerAfficheCitoyens } from './modele-affiche';
import { chargerBareme } from './tarification';
import { chargerContenuTexte } from './contenu-texte';
import { supabaseSelect, supabaseInsert, supabaseUpdate } from '../db';
import { verifierSignatureSvix } from '../lib/svix';
import { traiterEmailRecu } from './emails-recus';

const app = new Hono();

// Contenu de la fiche de présentation — PUBLIC (pas d'auth) : la fiche est consultable par les
// communes via le lien de l'email. Contenu marketing uniquement, rien de sensible. L'édition,
// elle, passe par /administration/modele-fiche (protégée).
app.get('/fiche-contenu', async (c) => {
  return c.json(await chargerFiche(c.env));
});

// Contenu de l'affiche citoyenne (voir modele-affiche.ts) — PUBLIC (pas d'auth) : imprimée par
// une commune DÉJÀ cliente pour ses administrés, lien envoyé dans l'email de bienvenue. Rien de
// sensible (nom + logo de la commune, tous deux déjà publics sur son app).
app.get('/affiche-citoyens-contenu', async (c) => {
  const slug = c.req.query('slug') || '';
  return c.json(await chargerAfficheCitoyens(c.env, slug));
});

// Barème tarifaire au nombre d'habitants (voir tarification.ts) — PUBLIC (pas d'auth) : consommé
// par la landing page (accueil.html) pour calculer le prix en direct selon la population saisie
// par le visiteur. Rien de sensible, ce sont les mêmes chiffres affichés sur le site.
app.get('/tarifs-contenu', async (c) => {
  return c.json(await chargerBareme(c.env));
});

// Petits textes citoyen éditables sans déploiement (popup module verrouillé, checklist de
// démarrage — voir contenu-texte.ts) — PUBLIC (pas d'auth) : consommé par l'app citoyenne
// (frontend/js/navigation.js, dashboard.js) une fois le tenant résolu. Rien de sensible, ce sont
// des textes d'aide identiques pour toutes les communes.
app.get('/contenu-texte', async (c) => {
  return c.json(await chargerContenuTexte(c.env));
});

// Webhook Resend (bounces / plaintes / ouvertures / clics / réponses reçues) — PUBLIC mais
// authentifié par SIGNATURE Svix. Enregistre l'email rejeté et signale l'adresse sur le prospect ;
// alimente aussi le suivi structuré des envois de prospection (envois_prospection, migration 040)
// pour le funnel envoyé → ouvert → cliqué → rejeté par variante A/B ; et capture (sans IA, voir
// emails-recus.ts) les réponses reçues des mairies dans une boîte de réception triée par mots-clés.
app.post('/webhook-resend', async (c) => {
  const corpsBrut = await c.req.text();
  const svixId = c.req.header('svix-id');
  const svixTs = c.req.header('svix-timestamp');
  const svixSig = c.req.header('svix-signature');

  // Resend impose un webhook (donc un secret distinct) par type d'événement. On accepte
  // plusieurs secrets : la signature est valide si elle correspond à L'UN d'eux.
  // RESEND_WEBHOOK_SECRET_ENGAGEMENT : webhook dédié à email.opened/email.clicked.
  // RESEND_WEBHOOK_SECRET_RECEIVED : webhook dédié à email.received ("Receiving", nécessite un
  // enregistrement MX sur le domaine — voir Resend → Domains). Les deux se créent dans Resend et
  // pointent vers cette même URL.
  const secrets = [
    c.env.RESEND_WEBHOOK_SECRET, c.env.RESEND_WEBHOOK_SECRET_COMPLAINED, c.env.RESEND_WEBHOOK_SECRET_ENGAGEMENT,
    c.env.RESEND_WEBHOOK_SECRET_RECEIVED,
  ].filter(Boolean);
  let ok = false;
  for (const secret of secrets) {
    if (await verifierSignatureSvix(secret, svixId, svixTs, svixSig, corpsBrut)) { ok = true; break; }
  }
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
      // Même signal côté communes CLIENTES (rappels d'échéance, email de présentation) —
      // jusqu'ici seuls les prospects étaient tracés. Alimente le badge de santé du backoffice.
      await supabaseUpdate(c.env, 'communes', { email_invalide: true }, { contact_email: `eq.${email}` });
      await supabaseUpdate(c.env, 'communes', { email_invalide: true }, { email_mairie: `eq.${email}` });
    }

    const emailIdRejete = evt?.data?.email_id;
    if (emailIdRejete) {
      await supabaseUpdate(c.env, 'envois_prospection', { rejete_le: new Date().toISOString() }, {
        resend_email_id: `eq.${emailIdRejete}`, rejete_le: 'is.null',
      });
    }
  } else if (evt?.type === 'email.opened' || evt?.type === 'email.clicked') {
    // Corrélation précise par resend_email_id (voir prospecterUn) — ne concerne que les envois
    // de prospection, pas tous les emails de la plateforme (les autres n'ont pas de ligne
    // envois_prospection, l'update ci-dessous est alors un no-op silencieux).
    const emailId = evt?.data?.email_id;
    if (emailId) {
      const [envoi] = await supabaseSelect(c.env, 'envois_prospection', {
        select: 'id,ouvert_le,clique_le', resend_email_id: `eq.${emailId}`,
      });
      if (envoi) {
        // Ne garde que la PREMIÈRE ouverture/premier clic (des relectures répétées ne doivent
        // pas fausser la date du premier signal d'intérêt).
        if (evt.type === 'email.opened' && !envoi.ouvert_le) {
          await supabaseUpdate(c.env, 'envois_prospection', { ouvert_le: new Date().toISOString() }, { id: `eq.${envoi.id}` });
        }
        if (evt.type === 'email.clicked' && !envoi.clique_le) {
          await supabaseUpdate(c.env, 'envois_prospection', {
            clique_le: new Date().toISOString(), lien_clique: evt?.data?.click?.link || null,
          }, { id: `eq.${envoi.id}` });
        }
      }
    }
  } else if (evt?.type === 'email.received') {
    // Le webhook ne porte que les métadonnées (email_id, from...), jamais le corps du message —
    // le rappel à l'API Resend pour le récupérer est déporté en arrière-plan pour renvoyer 200
    // tout de suite (sinon Resend, faute de réponse rapide, retente l'envoi — voir traiterEmailRecu
    // pour la protection anti-doublon par event_id, qui couvre ce cas).
    const emailId = evt?.data?.email_id;
    const fromMeta = evt?.data?.from;
    const sujet = evt?.data?.subject || null;
    const eventId = c.req.header('svix-id');
    if (emailId && fromMeta && eventId) c.executionCtx.waitUntil(traiterEmailRecu(c.env, eventId, emailId, fromMeta, sujet));
  }
  return c.json({ ok: true });
});

app.route('/auth', auth);
app.route('/administration', administration);
app.route('/administration', facturation);
app.route('/prospection', prospection);
app.route('/onboarding', onboarding);

export default app;
