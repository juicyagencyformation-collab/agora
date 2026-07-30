// worker/src/lib/email.ts

// Envoie un email via l'API Resend. Échoue silencieusement (juste loggé) plutôt que de
// faire planter le flux appelant — un email non envoyé ne doit jamais bloquer une réponse
// utilisateur (ex: mot de passe oublié doit toujours répondre "ok" pour ne pas révéler
// si un compte existe, même si l'envoi réel échoue derrière).
export async function envoyerEmail(env: any, to: string, subject: string, html: string) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY manquant — email non envoyé.');
    return;
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
      }),
    });
    if (!res.ok) console.error('Échec envoi email Resend :', await res.text());
  } catch (err) {
    console.error('Erreur réseau envoi email :', err);
  }
}
