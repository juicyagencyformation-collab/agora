// frontend/functions/[[path]].js
const DOSSIERS_STATIQUES = ['css', 'js', 'icons', 'functions'];

async function recupererAssetSansRedirection(env, urlCible, profondeur = 0) {
  if (profondeur > 5) return null;
  const reponse = await env.ASSETS.fetch(urlCible);
  if (reponse.status >= 300 && reponse.status < 400) {
    const location = reponse.headers.get('Location');
    console.log(`[fonction] redirection interne suivie : ${urlCible} -> ${location}`);
    if (!location) return reponse;
    const prochaineUrl = new URL(location, urlCible);
    return recupererAssetSansRedirection(env, prochaineUrl, profondeur + 1);
  }
  return reponse;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const segments = url.pathname.split('/').filter(Boolean);

  console.log(`[fonction] requête reçue : ${url.pathname} (segments: ${JSON.stringify(segments)})`);

  if (segments.length === 0) {
    console.log('[fonction] segments vides -> passthrough direct');
    return context.env.ASSETS.fetch(context.request);
  }

  const premier = segments[0];

  if (DOSSIERS_STATIQUES.includes(premier) || (segments.length === 1 && premier.includes('.'))) {
    console.log(`[fonction] ${url.pathname} -> passthrough (dossier statique ou fichier racine)`);
    return context.env.ASSETS.fetch(context.request);
  }

  const dernier = segments[segments.length - 1];
  const cheminReel = dernier.includes('.') ? `/${dernier}` : '/index.html';
  console.log(`[fonction] ${url.pathname} -> je vais chercher : ${cheminReel}`);

  const reponseAsset = await recupererAssetSansRedirection(context.env, new URL(cheminReel, url.origin));
  if (!reponseAsset) {
    console.log('[fonction] échec de récupération après 5 redirections -> passthrough de secours');
    return context.env.ASSETS.fetch(context.request);
  }

  console.log(`[fonction] ${url.pathname} -> réponse finale statut ${reponseAsset.status}, je force 200`);
  return new Response(reponseAsset.body, {
    status: 200,
    headers: reponseAsset.headers,
  });
}
