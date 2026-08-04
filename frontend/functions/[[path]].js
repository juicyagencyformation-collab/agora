// frontend/functions/[[path]].js
//
// Routage par commune, sans dépendre de _redirects (comportement incohérent constaté sur
// le domaine personnalisé). On suit nous-mêmes toute redirection interne que Cloudflare
// pourrait renvoyer, pour être certain qu'aucune redirection ne remonte au navigateur.

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
