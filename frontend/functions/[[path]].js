// frontend/functions/[[path]].js
//
// Remplace le fichier _redirects, qui se comportait de façon incohérente sur le domaine
// personnalisé plateforme-agora.fr (une règle aussi simple que "/:slug/*" y interceptait à
// tort les vrais fichiers statiques comme /css/base.css, alors que la même règle fonctionnait
// normalement sur l'adresse .pages.dev — comportement confirmé par test direct).
//
// Ici, le contrôle est total et explicite, sans dépendre du système de règles opaque de
// Cloudflare : on ne réécrit QUE ce qui ressemble vraiment à un slug de commune.

const DOSSIERS_STATIQUES = ['css', 'js', 'icons', 'functions'];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return context.env.ASSETS.fetch(context.request);
  }

  const premier = segments[0];

  // Sous un dossier statique connu (css/js/icons) ou un fichier réel isolé à la racine
  // (ex: /manifest.json, /sw.js, /decouverte.html) : jamais interprété comme un slug.
  if (DOSSIERS_STATIQUES.includes(premier) || (segments.length === 1 && premier.includes('.'))) {
    return context.env.ASSETS.fetch(context.request);
  }

  // Le dernier segment ressemble à un vrai fichier (ex: /eaucourt/connexion.html) :
  // on sert précisément ce fichier, peu importe le préfixe de commune devant.
  const dernier = segments[segments.length - 1];
  if (dernier.includes('.')) {
    return context.env.ASSETS.fetch(new URL(`/${dernier}`, url.origin));
  }

  // Sinon (ex: /eaucourt, /eaucourt/) : un slug de commune — sert l'accueil, en gardant
  // l'URL affichée intacte pour que la détection de commune côté JS (config.js) fonctionne.
  return context.env.ASSETS.fetch(new URL('/', url.origin));
}
