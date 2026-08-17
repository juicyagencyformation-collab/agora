// worker/src/lib/email.ts

// Envoie un email via l'API Resend. Échoue silencieusement (juste loggé) plutôt que de
// faire planter le flux appelant — un email non envoyé ne doit jamais bloquer une réponse
// utilisateur (ex: mot de passe oublié doit toujours répondre "ok" pour ne pas révéler
// si un compte existe, même si l'envoi réel échoue derrière).
// attachments (optionnel) : pièces jointes Resend. Pour les images INLINE (affichées sans que
// le destinataire ait à « autoriser les images »), passer un content_id et référencer l'image
// dans le HTML via src="cid:<content_id>".
// Renvoie l'id Resend de l'email envoyé (null en cas d'échec) — sert à corréler précisément les
// webhooks d'ouverture/clic à cet envoi précis (voir envois_prospection, migration 040).
export async function envoyerEmail(env: any, to: string, subject: string, html: string, attachments?: any[]): Promise<string | null> {
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
        ...(attachments && attachments.length ? { attachments } : {}),
      }),
    });
    if (!res.ok) {
      console.error('Échec envoi email Resend :', await res.text());
      return null;
    }
    const donnees = await res.json() as any;
    return donnees?.id || null;
  } catch (err) {
    console.error('Erreur réseau envoi email :', err);
    return null;
  }
}
