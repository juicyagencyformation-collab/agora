// frontend/functions/[[path]].js
//
// Routage par commune, sans dépendre de _redirects (comportement incohérent constaté sur
// le domaine personnalisé). Point important : on reconstruit toujours la réponse nous-mêmes
// avec un statut 200 explicite, pour ne jamais laisser une éventuelle redirection interne de
// Cloudflare (ex: nettoyage automatique des extensions .html) remonter jusqu'au navigateur —
// c'est ce qui causait le renvoi vers /connexion au lieu de /eaucourt/connexion.html.

const DOSSIERS_STATIQUES = ['css', 'js', 'icons', 'functions'];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return context.env.ASSETS.fetch(context.request);
  }

  const premier = segments[0];

  // Sous un dossier statique connu, ou un fichier réel isolé à la racine : jamais touché.
  if (DOSSIERS_STATIQUES.includes(premier) || (segments.length === 1 && premier.includes('.'))) {
    return context.env.ASSETS.fetch(context.request);
  }

  const dernier = segments[segments.length - 1];
  const cheminReel = dernier.includes('.') ? `/${dernier}` : '/index.html';

  const reponseAsset = await context.env.ASSETS.fetch(new URL(cheminReel, url.origin));

  // Réponse reconstruite à la main, statut 200 forcé : garantit que l'URL affichée dans
  // le navigateur ne bouge jamais, quoi que Cloudflare ait fait en interne.
  return new Response(reponseAsset.body, {
    status: 200,
    headers: reponseAsset.headers,
  });
}
