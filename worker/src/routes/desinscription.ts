// worker/src/routes/desinscription.ts
// Page publique de désinscription des emails de suivi (voir lib/desinscription.ts). Hors commune
// (montée avant la résolution du slug), sans compte : l'adresse et sa signature HMAC suffisent.
// GET  → page de confirmation avec un bouton (aucun effet : les antivirus visitent les liens).
// POST → enregistre la désinscription. Sert aussi au bouton « Se désabonner » des messageries
//        (RFC 8058, POST direct sans en-tête Origin — laissé passer par protectionCsrf).
import { Hono } from 'hono';
import { z } from 'zod';
import { signatureValide, enregistrerDesinscription, normaliserEmail } from '../lib/desinscription';

const app = new Hono();

const parametresSchema = z.object({
  e: z.string().trim().email().max(320),
  s: z.string().regex(/^[a-f0-9]{32}$/),
});

function echapper(s: string): string {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}

function page(titre: string, corps: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${titre} — Plateforme-Agora</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f8f4;margin:0;padding:48px 20px;text-align:center;color:#1b2a1c">
  <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 24px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <div style="font-size:22px;font-weight:800;color:#1b2a4a;margin-bottom:18px">Plateforme-Agora</div>
    ${corps}
  </div>
</body></html>`;
}

const LIEN_INVALIDE = page('Lien invalide', `<p style="font-size:15px;line-height:1.5">Ce lien de désinscription n'est pas valable.</p>
  <p style="font-size:14px;color:#5b6b5c">Écrivez-nous à <a href="mailto:contact@plateforme-agora.fr">contact@plateforme-agora.fr</a> : nous vous retirerons à la main.</p>`);

async function lireParametres(c: any): Promise<{ email: string; signature: string } | null> {
  const parse = parametresSchema.safeParse({ e: c.req.query('e'), s: c.req.query('s') });
  if (!parse.success) return null;
  const email = normaliserEmail(parse.data.e);
  return (await signatureValide(c.env, email, parse.data.s)) ? { email, signature: parse.data.s } : null;
}

app.get('/', async (c) => {
  const p = await lireParametres(c);
  if (!p) return c.html(LIEN_INVALIDE, 400);
  const action = `/api/desinscription?e=${encodeURIComponent(p.email)}&s=${p.signature}`;
  return c.html(page('Se désinscrire', `
    <p style="font-size:15px;line-height:1.5;margin-bottom:6px">Ne plus recevoir les emails de suivi de Plateforme-Agora à l'adresse :</p>
    <p style="font-size:15px;font-weight:600;margin:0 0 22px">${echapper(p.email)}</p>
    <form method="POST" action="${echapper(action)}">
      <button type="submit" style="background:#1b2a4a;color:#fff;border:none;padding:14px 26px;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;width:100%">Confirmer la désinscription</button>
    </form>
    <p style="font-size:12.5px;color:#5b6b5c;margin-top:16px">Vous continuerez à recevoir les emails nécessaires au service (liens de connexion, mot de passe oublié, convention).</p>`));
});

app.post('/', async (c) => {
  const p = await lireParametres(c);
  if (!p) return c.html(LIEN_INVALIDE, 400);
  // Corps « List-Unsubscribe=One-Click » = bouton intégré d'une messagerie (RFC 8058).
  const corps = await c.req.text().catch(() => '');
  try {
    await enregistrerDesinscription(c.env, p.email, corps.includes('List-Unsubscribe=One-Click') ? 'messagerie' : 'lien');
  } catch (e) {
    console.error('Désinscription impossible à enregistrer :', e);
    return c.html(page('Erreur', `<p style="font-size:15px;line-height:1.5">Un problème technique nous empêche d'enregistrer votre demande.</p>
      <p style="font-size:14px;color:#5b6b5c">Écrivez-nous à <a href="mailto:contact@plateforme-agora.fr">contact@plateforme-agora.fr</a> : nous vous retirerons à la main.</p>`), 500);
  }
  return c.html(page('Désinscription confirmée', `<p style="font-size:15px;line-height:1.5">C'est noté : <strong>${echapper(p.email)}</strong> ne recevra plus nos emails de suivi.</p>
    <p style="font-size:12.5px;color:#5b6b5c;margin-top:12px">Vous pouvez fermer cette page.</p>`));
});

export default app;
