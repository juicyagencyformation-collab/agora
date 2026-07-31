// frontend/functions/[[path]].js
//
// Routage par commune : /eaucourt/... sert l'app normalement, en gardant l'URL affichée
// intacte pour que la détection de commune côté JS (config.js) fonctionne. Toute
// redirection interne éventuelle de Cloudflare est suivie nous-mêmes, pour ne jamais
// laisser une adresse inattendue remonter jusqu'au navigateur.

const DOSSIERS_STATIQUES = ['css', 'js', 'icons', 'functions'];

async function recupererAssetSansRedirection(env, urlCible, profondeur = 0) {
  if (profondeur > 5) return null;
  const reponse = await env.ASSETS.fetch(urlCible);
  if (reponse.status >= 300 && reponse.status < 400) {
    const location = reponse.headers.get('Location');
    if (!location) return reponse;
    const prochaineUrl = new URL(location, urlCible);
    return recupererAssetSansRedirection(env, prochaineUrl, profondeur + 1);
  }
  return reponse;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return context.env.ASSETS.fetch(context.request);
  }

  const premier = segments[0];

  if (DOSSIERS_STATIQUES.includes(premier) || (segments.length === 1 && premier.includes('.'))) {
    return context.env.ASSETS.fetch(context.request);
  }

  const dernier = segments[segments.length - 1];
  const cheminReel = dernier.includes('.') ? `/${dernier}` : '/index.html';

  const reponseAsset = await recupererAssetSansRedirection(context.env, new URL(cheminReel, url.origin));
  if (!reponseAsset) return context.env.ASSETS.fetch(context.request);

  return new Response(reponseAsset.body, {
    status: 200,
    headers: reponseAsset.headers,
  });
}
