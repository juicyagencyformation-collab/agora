// frontend/js/config.js
// API_BASE pointe vers le proxy same-origin (frontend/functions/[[path]].js), qui relaie
// vers le vrai Worker. Nécessaire car Safari/iOS (ITP) bloque les cookies de session quand
// le frontend et l'API sont sur des domaines différents — voir CLAUDE.md.
// En test local (wrangler dev sans Pages Function), remplace temporairement par
// 'http://localhost:8787'.
window.API_BASE = '/api';

// Commune détectée automatiquement depuis l'URL (ex: plateforme-agora.fr/eaucourt/ -> "eaucourt").
// Fonctionne pour toute commune future sans jamais retoucher ce fichier. Si l'URL ne contient
// aucun slug (ex: PWA réouverte depuis l'écran d'accueil sur l'adresse racine), on retombe sur
// la dernière commune connue de cet appareil, sinon on redirige vers la recherche de commune —
// PLUS JAMAIS de commune réelle choisie au hasard comme repli (avant le 2026-10-12, retombait
// en dur sur "eaucourt" : un lien générique comme plateforme-agora.fr/connexion.html, sans
// slug, inscrivait silencieusement des gens n'ayant aucun lien avec Eaucourt-sur-Somme — faille
// repérée via un signalement réel de Léandre, pas une supposition).
window.COMMUNE_SLUG = (() => {
  // Pages/fichiers servis à la racine — jamais des slugs de commune. Comparaison SANS extension
  // car Cloudflare retire le .html (/connexion.html servi comme /connexion) : sans ça, "connexion"
  // serait pris pour un slug, l'API appelée sur /api/connexion/... et le serveur répondrait
  // "Commune introuvable". On s'en sert aussi pour ignorer une valeur polluée déjà en localStorage.
  const pagesNonCommune = ['index', 'connexion', 'reinitialiser', 'confidentialite', 'mentions-legales', 'conditions-utilisation', 'decouverte', 'rejoindre', 'manifest', 'sw'];
  const estPage = (s) => !!s && pagesNonCommune.includes(s.replace(/\.[a-z0-9]+$/i, ''));

  const segments = window.location.pathname.split('/').filter(Boolean);
  const premier = segments[0];
  if (premier && !premier.includes('.') && !estPage(premier)) {
    localStorage.setItem('agora_derniere_commune', premier);
    return premier;
  }
  const memorisee = localStorage.getItem('agora_derniere_commune');
  if (memorisee && !estPage(memorisee)) return memorisee;

  // Aucune commune déterminable : on redirige vers la recherche plutôt que de deviner — sauf
  // si on y est déjà (rejoindre/découverte servent justement à choisir une commune, jamais de
  // boucle de redirection sur elles-mêmes), et sauf reinitialiser.html, qui détermine SA
  // commune via le paramètre ?slug= de l'URL (lu par son propre script juste après ce
  // fichier) plutôt que par le chemin — rediriger ici couperait tout lien de réinitialisation
  // de mot de passe reçu par email tant que la bonne commune n'est pas déjà en mémoire locale.
  const pageActuelle = premier ? premier.replace(/\.[a-z0-9]+$/i, '') : 'index';
  if (!['rejoindre', 'decouverte', 'reinitialiser'].includes(pageActuelle)) {
    window.location.href = '/rejoindre.html';
  }
  return 'eaucourt'; // valeur transitoire, jamais réellement utilisée : la page change avant tout appel API
})();

// Clé publique VAPID pour les notifications push (la clé privée reste secrète côté Worker)
window.VAPID_PUBLIC_KEY = 'BP4VsbzEaz9CFIXy14keOhwtC-ws3RecrNmU75wjHW_r9HWxsghXI1PoYopDNI2GX4ghozXzNZTtllXAaSBTt_8';

// Renseignés dynamiquement après initCommune() dans navigation.js
window.USER_ID = null;
window.ROLE = null;
