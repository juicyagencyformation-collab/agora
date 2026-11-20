// worker/src/routes/accord-maire.ts
// Accord du maire sur les CGU / accord de sous-traitance RGPD (article 10), SANS compte : lien
// personnel envoyé à l'adresse de la mairie depuis le backoffice (preuves-cgu.ts), migration 109.
// Public, hors résolution de commune (monté sur /accord-maire dans index.ts) : la commune vient du
// jeton, jamais du client. Le GET affiche seulement la page (les messageries visitent les liens
// pour les analyser : rien ne doit s'enregistrer sans clic humain) ; le POST, au clic du bouton,
// enregistre l'accord. Lien à usage unique, 30 jours, stocké haché.
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseUpdate } from '../db';
import { hasherSha256Hex } from '../lib/hash';
import { journaliserAcceptationCgu } from '../lib/cgu';

const app = new Hono();

const echapper = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
const tokenSchema = z.string().regex(/^[a-f0-9-]{40,100}$/);
const corpsSchema = z.object({ nom: z.string().trim().min(2, 'Indiquez votre nom.').max(120) });

function page(corps: string, titre: string): string {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${titre} — Plateforme-Agora</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f8f4;margin:0;padding:32px 16px;color:#1b2a1c">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 22px;box-shadow:0 2px 12px rgba(0,0,0,.06);font-size:15px;line-height:1.55">
    <div style="font-size:22px;font-weight:800;color:#2c5f2d;margin-bottom:16px">Plateforme-Agora</div>
    ${corps}
  </div>
</body></html>`;
}

const PAGE_INVALIDE = page(`<p>Ce lien n'est plus valable.</p>
  <p style="color:#5b6b5c;font-size:14px">Pour en recevoir un nouveau, écrivez à
  <a href="mailto:contact@plateforme-agora.fr" style="color:#2c5f2d">contact@plateforme-agora.fr</a>.</p>`, 'Lien expiré');

async function chargerDemande(env: any, token: string) {
  if (!tokenSchema.safeParse(token).success) return null;
  const [demande] = await supabaseSelect(env, 'demandes_accord_maire', {
    select: 'id,commune_id,envoye_a,nom_maire,expires_at,utilise_le', token_hash: `eq.${await hasherSha256Hex(token)}`,
  });
  if (!demande) return null;
  const [commune] = await supabaseSelect(env, 'communes', { select: 'nom,slug', id: `eq.${demande.commune_id}` });
  return commune ? { demande, commune } : null;
}

const dejaFait = (commune: any, le: string) => page(`<p><strong>L'accord de la commune de ${echapper(commune.nom)} est bien enregistré</strong>
  (le ${new Date(le).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' })}).</p>
  <p style="color:#5b6b5c;font-size:14px">Un accusé de réception a été envoyé à la mairie. Vous n'avez rien d'autre à faire. Merci !</p>`, 'Accord enregistré');

function pageAccord(env: any, demande: any, commune: any, erreur = ''): string {
  const site = env.FRONTEND_URL || 'https://plateforme-agora.fr';
  const lienCgu = `${site}/${commune.slug}/conditions-utilisation.html`;
  return page(`
    <p style="margin-top:0">Commune de <strong>${echapper(commune.nom)}</strong></p>
    <p>Votre commune utilise Plateforme-Agora. Comme la loi le prévoit, même lorsque le service est gratuit,
      nous avons besoin de l'accord du maire sur la protection des données des habitants. En résumé :</p>
    <ul style="padding-left:20px">
      <li>la commune reste responsable des données, Plateforme-Agora agit seulement pour son compte ;</li>
      <li>les données sont hébergées dans l'Union européenne (base de données à Paris) ;</li>
      <li>elles ne servent qu'à faire fonctionner l'application : jamais vendues, jamais utilisées à d'autres fins ;</li>
      <li>en cas d'incident de sécurité, la mairie est prévenue sous 48 heures ;</li>
      <li>à la fin du service, les données sont rendues à la commune puis supprimées sous 30 jours.</li>
    </ul>
    <p style="font-size:14px"><a href="${echapper(lienCgu)}" target="_blank" style="color:#2c5f2d">Lire le texte complet (article 10 des conditions d'utilisation)</a>.
      Cet accord n'entraîne aucun frais.</p>
    <form method="POST" style="margin-top:20px">
      <label for="nom" style="display:block;font-weight:600;font-size:14px;margin-bottom:6px">Votre nom</label>
      <input id="nom" name="nom" required minlength="2" maxlength="120" value="${echapper(demande.nom_maire || '')}"
        style="width:100%;box-sizing:border-box;padding:12px;border:1.5px solid #dfe7df;border-radius:8px;font-size:16px">
      ${erreur ? `<p style="color:#b42318;font-size:14px;margin:6px 0 0">${echapper(erreur)}</p>` : ''}
      <button type="submit" style="margin-top:14px;width:100%;background:#2c5f2d;color:#fff;border:none;padding:15px;border-radius:8px;font-weight:600;font-size:16px;cursor:pointer">
        J'accepte au nom de la commune, en qualité de maire</button>
    </form>
    <p style="color:#5b6b5c;font-size:13px;margin-bottom:0">Vous n'êtes pas le maire ? Ne cliquez pas : transférez simplement ce message au maire.
      Une question : <a href="mailto:contact@plateforme-agora.fr" style="color:#2c5f2d">contact@plateforme-agora.fr</a>.</p>
  `, 'Accord du maire');
}

app.get('/:token', async (c) => {
  try {
    const trouve = await chargerDemande(c.env, c.req.param('token'));
    if (!trouve) return c.html(PAGE_INVALIDE, 404);
    const { demande, commune } = trouve;
    if (demande.utilise_le) return c.html(dejaFait(commune, demande.utilise_le));
    if (new Date(demande.expires_at) < new Date()) return c.html(PAGE_INVALIDE, 410);
    return c.html(pageAccord(c.env, demande, commune));
  } catch (e) {
    console.error('Accord maire (page)', e);
    return c.html(page('<p>Une erreur est survenue. Réessayez dans un instant.</p>', 'Erreur'), 500);
  }
});

app.post('/:token', async (c) => {
  try {
    const trouve = await chargerDemande(c.env, c.req.param('token'));
    if (!trouve) return c.html(PAGE_INVALIDE, 404);
    const { demande, commune } = trouve;
    if (demande.utilise_le) return c.html(dejaFait(commune, demande.utilise_le));
    if (new Date(demande.expires_at) < new Date()) return c.html(PAGE_INVALIDE, 410);

    const corps = corpsSchema.safeParse(await c.req.parseBody().catch(() => ({})));
    if (!corps.success) return c.html(pageAccord(c.env, demande, commune, corps.error.issues[0]?.message || 'Indiquez votre nom.'), 400);

    // Réserve le lien AVANT d'enregistrer (filtre utilise_le IS NULL) : deux clics simultanés
    // ne peuvent pas produire deux accords.
    const maintenant = new Date().toISOString();
    const reserves = await supabaseUpdate(c.env, 'demandes_accord_maire', { utilise_le: maintenant }, { id: `eq.${demande.id}`, utilise_le: 'is.null' });
    if (!reserves.length) return c.html(dejaFait(commune, maintenant));
    try {
      await journaliserAcceptationCgu(c, {
        commune_id: demande.commune_id, user_id: null, role: 'maire', canal: 'lien_mairie',
        nom_affiche: corps.data.nom, email: demande.envoye_a,
      });
    } catch (e) {
      await supabaseUpdate(c.env, 'demandes_accord_maire', { utilise_le: null }, { id: `eq.${demande.id}` }).catch(() => {});
      throw e;
    }
    return c.html(dejaFait(commune, maintenant));
  } catch (e) {
    console.error('Accord maire (enregistrement)', e);
    return c.html(page('<p>L\'accord n\'a pas pu être enregistré. Réessayez dans un instant.</p>', 'Erreur'), 500);
  }
});

export default app;
