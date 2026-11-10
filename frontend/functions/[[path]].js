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
const PAGES_RACINE = ['connexion', 'reinitialiser', 'decouverte', 'rejoindre', 'mentions-legales', 'confidentialite', 'conditions-utilisation', 'jouer', 'guide-communes'];

// Origine réelle du Worker. Le frontend appelle /api/... en same-origin (voir
// frontend/js/config.js) et cette fonction relaie vers le Worker en coulisses : ainsi les
// cookies de session sont posés sur plateforme-agora.fr et non sur un domaine tiers, ce qui
// contourne le blocage des cookies tiers de Safari/iOS (ITP) — voir CLAUDE.md.
const WORKER_ORIGIN = 'https://agora-worker.juicy-agency-formation.workers.dev';

async function relayerVersWorker(request, segments, env) {
  const url = new URL(request.url);
  const cheminApi = '/' + segments.slice(1).join('/');
  const cible = new URL(cheminApi + url.search, WORKER_ORIGIN);

  const entetes = new Headers(request.headers);
  entetes.delete('host');
  // IP réelle du visiteur pour la limite de tentatives du Worker (voir worker/src/lib/securite.ts) :
  // sans ça, le Worker ne voit que l'IP de sortie de Cloudflare, commune à tous. Prouvée par le
  // secret partagé RELAIS_SECRET ; toute valeur envoyée par le navigateur est écrasée.
  entetes.delete('x-agora-relais');
  entetes.delete('x-agora-client-ip');
  if (env?.RELAIS_SECRET) {
    entetes.set('x-agora-relais', env.RELAIS_SECRET);
    entetes.set('x-agora-client-ip', request.headers.get('CF-Connecting-IP') || '');
  }

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

// ===================== Page publique d'un article : /lire/<id> (2026-11-10) =====================
// Lien à partager sur Facebook/Instagram pour les articles de la commune éditoriale
// Plateforme-Agora (le Worker refuse tout autre article, voir GET /decouverte/articles/:id).
// HTML construit ICI, côté serveur : le robot de Facebook n'exécute pas le JavaScript, il ne
// lit que les balises og: présentes dans la page reçue. Aucun script sur la page (CSP
// script-src 'none'), le partage passe par un simple lien. En bas : « Rejoindre l'appli de VOTRE
// commune » vers /rejoindre — jamais vers l'appli d'une commune précise.
function echapperHtml(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function resumeTexte(html, longueur = 200) {
  const texte = String(html ?? '')
    .replace(/<br\s*\/?>|<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
  return texte.length > longueur ? `${texte.slice(0, longueur - 1).trimEnd()}…` : texte;
}

const ENTETES_PAGE_PUBLIQUE = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function gabaritPagePublique({ titre, metas = '', corps }) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${titre}</title>
  ${metas}
  <link rel="icon" type="image/png" href="/icons/icon-192.png">
  <meta name="theme-color" content="#1B2A4A">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:wght@700&family=Inter:wght@400;600&display=swap">
  <style>
    :root { --navy: #1B2A4A; --green: #2EAB7B; --green-light: #e8f7f1; --cream: #F8F7F4; --muted: #6b7280; --bord: #e8e6e1; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--cream); color: var(--navy); font-family: 'Inter', system-ui, sans-serif; font-size: 17px; line-height: 1.65; -webkit-font-smoothing: antialiased; }
    .page { max-width: 680px; margin: 0 auto; padding: 20px 16px 48px; }
    .marque { display: flex; align-items: center; gap: 10px; color: var(--navy); text-decoration: none; font-family: 'Fraunces', Georgia, serif; font-weight: 700; font-size: 18px; }
    .marque img { width: 34px; height: 34px; }
    article { background: #fff; border: 1px solid var(--bord); border-radius: 18px; overflow: hidden; margin-top: 18px; }
    .image-une { display: block; width: 100%; max-height: 420px; object-fit: cover; }
    .texte { padding: 22px 22px 26px; }
    h1 { font-family: 'Fraunces', Georgia, serif; font-size: 1.75rem; line-height: 1.2; margin: 0 0 6px; text-wrap: balance; }
    .date { color: var(--muted); font-size: 14px; margin: 0 0 18px; }
    .contenu { overflow-wrap: anywhere; }
    .contenu a { color: var(--green); }
    .images-suite img { display: block; width: 100%; border-radius: 12px; margin-top: 14px; }
    .partage { display: inline-block; margin-top: 22px; font-size: 15px; color: var(--navy); font-weight: 600; }
    .appel { background: var(--navy); color: #fff; border-radius: 18px; padding: 24px 22px; margin-top: 22px; }
    .appel h2 { font-family: 'Fraunces', Georgia, serif; font-size: 1.3rem; line-height: 1.25; margin: 0 0 8px; }
    .appel p { margin: 0 0 16px; color: #d6dbe7; font-size: 15.5px; }
    .bouton { display: inline-block; background: var(--green); color: #fff; text-decoration: none; font-weight: 600; padding: 12px 20px; border-radius: 100px; }
    .pied { text-align: center; color: var(--muted); font-size: 13px; margin-top: 26px; }
    .pied a { color: var(--muted); }
  </style>
</head>
<body>
  <div class="page">
    <a class="marque" href="/"><img src="/icons/icon-192.png" alt="">Plateforme-Agora</a>
    ${corps}
    <div class="appel">
      <h2>Et dans votre commune ?</h2>
      <p>Actualités de la mairie, agenda, signalements, entraide entre voisins : retrouvez la vie de votre commune dans une application gratuite pour les habitants.</p>
      <a class="bouton" href="/rejoindre">Trouver ma commune →</a>
    </div>
    <p class="pied"><a href="/">plateforme-agora.fr</a> · <a href="/mentions-legales">Mentions légales</a> · <a href="/confidentialite">Confidentialité</a></p>
  </div>
</body>
</html>`;
}

async function pageArticlePublic(id, url) {
  const introuvable = () => new Response(gabaritPagePublique({
    titre: 'Article introuvable — Plateforme-Agora',
    metas: '<meta name="robots" content="noindex">',
    corps: '<article><div class="texte"><h1>Cet article n\'est plus disponible</h1><p class="date">Il a peut-être été retiré ou le lien est incomplet.</p></div></article>',
  }), { status: 404, headers: ENTETES_PAGE_PUBLIQUE });

  if (!/^[0-9a-f-]{36}$/i.test(id)) return introuvable();
  let article;
  try {
    const res = await fetch(`${WORKER_ORIGIN}/decouverte/articles/${id}`);
    if (res.status === 404) return introuvable();
    if (!res.ok) throw new Error(`Worker ${res.status}`);
    ({ article } = await res.json());
  } catch {
    return new Response(gabaritPagePublique({
      titre: 'Plateforme-Agora',
      metas: '<meta name="robots" content="noindex">',
      corps: '<article><div class="texte"><h1>Article momentanément indisponible</h1><p class="date">Réessayez dans quelques minutes.</p></div></article>',
    }), { status: 503, headers: ENTETES_PAGE_PUBLIQUE });
  }

  const adresse = `${url.origin}/lire/${article.id}`;
  const images = (article.images || []).filter((u) => /^https:\/\//i.test(u));
  const imageUne = images[0] || `${url.origin}/icons/icon-512.png`;
  const resume = resumeTexte(article.contenu_html);
  const date = new Date(article.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

  const metas = `
  <meta name="description" content="${echapperHtml(resume)}">
  <link rel="canonical" href="${echapperHtml(adresse)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Plateforme-Agora">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:title" content="${echapperHtml(article.titre)}">
  <meta property="og:description" content="${echapperHtml(resume)}">
  <meta property="og:url" content="${echapperHtml(adresse)}">
  <meta property="og:image" content="${echapperHtml(imageUne)}">
  <meta name="twitter:card" content="${images.length ? 'summary_large_image' : 'summary'}">`;

  const corps = `
    <article>
      ${images.length ? `<img class="image-une" src="${echapperHtml(images[0])}" alt="">` : ''}
      <div class="texte">
        <h1>${echapperHtml(article.titre)}</h1>
        <p class="date">Publié le ${echapperHtml(date)}</p>
        <div class="contenu">${article.contenu_html}</div>
        ${images.length > 1 ? `<div class="images-suite">${images.slice(1).map((u) => `<img src="${echapperHtml(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
        <a class="partage" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(adresse)}" target="_blank" rel="noopener">Partager sur Facebook</a>
      </div>
    </article>`;

  return new Response(gabaritPagePublique({ titre: `${echapperHtml(article.titre)} — Plateforme-Agora`, metas, corps }), {
    status: 200,
    headers: { ...ENTETES_PAGE_PUBLIQUE, 'Cache-Control': 'public, max-age=300' },
  });
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

  // Racine du domaine (plateforme-agora.fr) : page marketing publique (frontend/accueil.html),
  // distincte de index.html qui reste la coquille de l'appli servie sous /<slug>/.
  if (segments.length === 0) {
    const page = await recupererAssetSansRedirection(context.env, new URL('/accueil.html', url.origin));
    if (page) return new Response(page.body, { status: page.status, headers: page.headers });
    return context.env.ASSETS.fetch(context.request);
  }

  const premier = segments[0];

  if (premier === 'api') {
    return relayerVersWorker(context.request, segments, context.env);
  }

  if (premier === 'lire' && segments.length === 2) {
    return pageArticlePublic(segments[1], url);
  }

  // Liens courts pour QR code (voir worker/src/routes/liens_courts.ts) : contrairement à /api/...
  // ci-dessus, le chemin /q/<code> est relayé TEL QUEL (le Worker monte ces routes directement
  // sur /q, pas sur /api/q) — pas de segment à retirer avant de transmettre.
  if (premier === 'q') {
    const cible = new URL(url.pathname + url.search, WORKER_ORIGIN);
    const entetes = new Headers(context.request.headers);
    entetes.delete('host');
    return fetch(cible, { method: context.request.method, headers: entetes, redirect: 'manual' });
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
    const pageCible = ['index', 'connexion', 'fiche', 'document', 'affiche-citoyens', 'dossier-conseil', 'stickers'].includes(nom) ? nom : 'index';
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
