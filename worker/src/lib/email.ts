// worker/src/lib/email.ts
import { supabaseUpsert } from '../db';

// Envoie un email via l'API Resend. Échoue silencieusement (juste loggé) plutôt que de
// faire planter le flux appelant — un email non envoyé ne doit jamais bloquer une réponse
// utilisateur (ex: mot de passe oublié doit toujours répondre "ok" pour ne pas révéler
// si un compte existe, même si l'envoi réel échoue derrière).
// attachments (optionnel) : pièces jointes Resend. Pour les images INLINE (affichées sans que
// le destinataire ait à « autoriser les images »), passer un content_id et référencer l'image
// dans le HTML via src="cid:<content_id>".
// Renvoie l'id Resend de l'email envoyé (null en cas d'échec) — sert à corréler précisément les
// webhooks d'ouverture/clic à cet envoi précis (voir envois_prospection, migration 040).
export async function envoyerEmail(
  env: any, to: string, subject: string, html: string, attachments?: any[], replyTo?: string,
  headersPersonnalises?: Record<string, string>,
): Promise<string | null> {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY manquant — email non envoyé.');
    return null;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM || 'Agora <onboarding@resend.dev>',
        to, subject, html,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(attachments && attachments.length ? { attachments } : {}),
        // In-Reply-To/References (voir POST /prospection/emails-recus/:id/repondre) : threade la
        // réponse dans la conversation existante côté client mail du destinataire, au lieu
        // qu'elle arrive comme un email tout neuf sans rapport apparent.
        ...(headersPersonnalises && Object.keys(headersPersonnalises).length ? { headers: headersPersonnalises } : {}),
      }),
    });
    if (!res.ok) {
      const texte = await res.text();
      console.error('Échec envoi email Resend :', texte);
      // Quota atteint (429 daily_quota_exceeded / monthly_quota_exceeded) : toujours noté, pour
      // que le backoffice l'affiche tout de suite.
      const refus = res.status === 429 ? (texte.match(/(daily|monthly)_quota_exceeded/)?.[0] ?? null) : null;
      await noterQuotaResend(env, res, { refus });
      return null;
    }
    await noterQuotaResend(env, res);
    const donnees = await res.json() as any;
    return donnees?.id || null;
  } catch (err) {
    console.error('Erreur réseau envoi email :', err);
    return null;
  }
}

// Consommation du quota Resend (migration 113, demandé par Léandre le 2026-11-20) : Resend la
// renvoie dans les en-têtes x-resend-daily-quota (plan gratuit seulement) et x-resend-monthly-quota.
// Gardée dans etat_resend pour le backoffice (backoffice/quota-resend.ts). Pour ne pas doubler les
// requêtes d'un envoi en lot (bilans mensuels, limite de 50 sous-requêtes par exécution), au plus
// une écriture par minute et par instance, sauf refus pour quota ou relevé forcé.
let derniereNoteQuota = 0;

export async function noterQuotaResend(env: any, res: Response, options: { refus?: string | null; forcer?: boolean } = {}) {
  const jour = res.headers.get('x-resend-daily-quota');
  const mois = res.headers.get('x-resend-monthly-quota');
  if (jour === null && mois === null && !options.refus) return;
  if (!options.refus && !options.forcer && Date.now() - derniereNoteQuota < 60_000) return;
  derniereNoteQuota = Date.now();
  const maintenant = new Date().toISOString();
  try {
    await supabaseUpsert(env, 'etat_resend', [{
      id: 1, maj_le: maintenant,
      ...(jour !== null ? { quota_jour: parseInt(jour, 10) || 0 } : {}),
      ...(mois !== null ? { quota_mois: parseInt(mois, 10) || 0 } : {}),
      ...(options.refus ? { dernier_refus: options.refus, dernier_refus_le: maintenant } : {}),
    }], 'id');
  } catch (e) {
    console.error('Quota Resend non enregistré', e);
  }
}
