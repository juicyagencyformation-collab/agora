// frontend/functions/[[path]].js
//
// Routage par commune, sans dépendre de _redirects (comportement incohérent constaté sur
// le domaine personnalisé). On suit nous-mêmes toute redirection interne que Cloudflare
// pourrait renvoyer, pour être certain qu'aucune redirection ne remonte au navigateur.

const DOSSIERS_STATIQUES = ['css', 'js', 'icons', 'functions'];

// Pages HTML servies à la racine (pas dans un dossier de commune). Cloudflare leur retire
// automatiquement l'extension (/connexion.html -> /connexion) : le navigateur arrive donc sur
// un chemin sans point, que le routeur prendrait pour un slug de commune et servirait avec
// index.html (l'appli) à la place. On mappe ces noms "propres" vers leur vrai fichier .html.
const PAGES_RACINE = ['connexion', 'reinitialiser', 'decouverte', 'mentions-legales', 'confidentialite'];

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

  // Backoffice interne (frontend/backoffice/*) : outil séparé de l'app citoyenne, avec son
  // propre routage. Les fichiers (js/css/vendor, tout ce qui contient un point) sont servis
  // tels quels ; les chemins "propres" sont mappés vers leur .html (/backoffice -> index,
  // /backoffice/connexion -> connexion.html). Rien ici ne passe par la logique de commune.
  if (premier === 'backoffice') {
    const dernierSeg = segments[segments.length - 1];
    if (dernierSeg.includes('.')) {
      const asset = await recupererAssetSansRedirection(context.env, url);
      if (asset) return new Response(asset.body, { status: asset.status, headers: asset.headers });
      return context.env.ASSETS.fetch(context.request);
    }
    const nom = segments.length === 1 ? 'index' : dernierSeg;
    const pageCible = ['index', 'connexion', 'fiche'].includes(nom) ? nom : 'index';
    const page = await recupererAssetSansRedirection(context.env, new URL(`/backoffice/${pageCible}.html`, url.origin));
    if (page) return new Response(page.body, { status: page.status, headers: page.headers });
    return context.env.ASSETS.fetch(context.request);
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

  // Page racine dont Cloudflare a retiré le .html (ex: /connexion, /reinitialiser) : on sert
  // le vrai fichier .html plutôt que de retomber sur index.html. La query string éventuelle
  // (?token=...) reste dans l'URL du navigateur, lue côté client — on ne fait que servir le
  // contenu, sans redirection.
  const nomSansHtml = dernier.replace(/\.html$/, '');
  if (PAGES_RACINE.includes(nomSansHtml)) {
    const page = await recupererAssetSansRedirection(context.env, new URL(`/${nomSansHtml}.html`, url.origin));
    if (page) return new Response(page.body, { status: page.status, headers: page.headers });
  }

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
