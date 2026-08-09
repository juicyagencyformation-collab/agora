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
// la dernière commune connue de cet appareil, puis sur "eaucourt" en tout dernier recours.
window.COMMUNE_SLUG = (() => {
  // Pages/fichiers servis à la racine — jamais des slugs de commune. Comparaison SANS extension
  // car Cloudflare retire le .html (/connexion.html servi comme /connexion) : sans ça, "connexion"
  // serait pris pour un slug, l'API appelée sur /api/connexion/... et le serveur répondrait
  // "Commune introuvable". On s'en sert aussi pour ignorer une valeur polluée déjà en localStorage.
  const pagesNonCommune = ['index', 'connexion', 'reinitialiser', 'confidentialite', 'mentions-legales', 'decouverte', 'manifest', 'sw'];
  const estPage = (s) => !!s && pagesNonCommune.includes(s.replace(/\.[a-z0-9]+$/i, ''));

  const segments = window.location.pathname.split('/').filter(Boolean);
  const premier = segments[0];
  if (premier && !premier.includes('.') && !estPage(premier)) {
    localStorage.setItem('agora_derniere_commune', premier);
    return premier;
  }
  const memorisee = localStorage.getItem('agora_derniere_commune');
  return (memorisee && !estPage(memorisee)) ? memorisee : 'eaucourt';
})();

// Clé publique VAPID pour les notifications push (la clé privée reste secrète côté Worker)
window.VAPID_PUBLIC_KEY = 'BP4VsbzEaz9CFIXy14keOhwtC-ws3RecrNmU75wjHW_r9HWxsghXI1PoYopDNI2GX4ghozXzNZTtllXAaSBTt_8';

// Renseignés dynamiquement après initCommune() dans navigation.js
window.USER_ID = null;
window.ROLE = null;
