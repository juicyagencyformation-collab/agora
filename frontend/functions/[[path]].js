// frontend/functions/[[path]].js
//
// Routage par commune, sans dépendre de _redirects (comportement incohérent constaté sur
// le domaine personnalisé). On suit nous-mêmes toute redirection interne que Cloudflare
// pourrait renvoyer, pour être certain qu'aucune redirection ne remonte au navigateur.

const DOSSIERS_STATIQUES = ['css', 'js', 'icons', 'functions'];

// Origine réelle du Worker. Le frontend appelle /api/... en same-origin (voir
// frontend/js/config.js) et cette fonction relaie vers le Worker en coulisses : ainsi les
// cookies de session sont posés sur plateforme-agora.fr et non sur un domaine tiers, ce qui
// contourne le blocage des cookies tiers de Safari/iOS (ITP) — voir CLAUDE.md.
const WORKER_ORIGIN = 'https://agora-worker.juicy-agency-formation.workers.dev';

async function relayerVersWorker(request, segments) {
  const url = new URL(request.url);
  const cheminApi = '/' + segments.slice(1).join('/');
  const cible = new URL(cheminApi + url.search, WORKER_ORIGIN);

  const entetes = new Headers(request.headers);
  entetes.delete('host');

  const estAvecCorps = !['GET', 'HEAD'].includes(request.method);
  const init = {
    method: request.method,
    headers: entetes,
    body: estAvecCorps ? request.body : undefined,
    redirect: 'manual',
  };
  if (estAvecCorps) init.duplex = 'half';

  return fetch(cible, init);
}

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

  if (premier === 'api') {
    return relayerVersWorker(context.request, segments);
  }

  if (DOSSIERS_STATIQUES.includes(premier) || (segments.length === 1 && premier.includes('.'))) {
    // Comme pour le reste du fichier : on absorbe nous-mêmes toute redirection interne que
    // Cloudflare pourrait renvoyer (ex: /reinitialiser.html → /reinitialiser sans extension),
    // sinon elle remonte telle quelle au navigateur, qui atterrit sur un chemin sans point —
    // non reconnu plus bas comme un fichier statique, et sert index.html par erreur à la place.
    const reponseAsset = await recupererAssetSansRedirection(context.env, url);
    if (!reponseAsset) return context.env.ASSETS.fetch(context.request);
    return new Response(reponseAsset.body, { status: reponseAsset.status, headers: reponseAsset.headers });
  }

  const dernier = segments[segments.length - 1];

  // Manifest propre à la commune : start_url et scope pointent vers /<slug>/, et les
  // icônes sont forcées en chemin absolu (/icons/...) pour ne jamais se résoudre par
  // erreur relativement à /<slug>/, quel que soit le contenu du fichier statique d'origine.
  if (dernier === 'manifest.json' && segments.length > 1) {
    const manifestReel = await recupererAssetSansRedirection(context.env, new URL('/manifest.json', url.origin));
    if (manifestReel) {
      try {
        const manifestJson = await manifestReel.json();
        manifestJson.start_url = `/${premier}/index.html`;
        manifestJson.scope = `/${premier}/`;
        if (Array.isArray(manifestJson.icons)) {
          manifestJson.icons = manifestJson.icons.map((icone) => ({
            ...icone,
            src: icone.src.startsWith('/') ? icone.src : `/${icone.src.replace(/^\.?\//, '')}`,
          }));
        }
        return new Response(JSON.stringify(manifestJson), {
          status: 200,
          headers: { 'Content-Type': 'application/manifest+json' },
        });
      } catch {
        // En cas de souci de lecture, on retombe sur le manifest générique plutôt que casser.
      }
    }
  }

  const cheminReel = dernier.includes('.') ? `/${dernier}` : '/index.html';
  const reponseAsset = await recupererAssetSansRedirection(context.env, new URL(cheminReel, url.origin));
  if (!reponseAsset) return context.env.ASSETS.fetch(context.request);

  return new Response(reponseAsset.body, {
    status: 200,
    headers: reponseAsset.headers,
  });
}
