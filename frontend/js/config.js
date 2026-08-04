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
  const segments = window.location.pathname.split('/').filter(Boolean);
  const fichiersConnus = [
    'index.html', 'connexion.html', 'manifest.json', 'sw.js',
    'reinitialiser.html', 'confidentialite.html', 'mentions-legales.html', 'decouverte.html',
  ];
  const premier = segments[0];
  if (premier && !fichiersConnus.includes(premier) && !premier.includes('.')) {
    localStorage.setItem('agora_derniere_commune', premier);
    return premier;
  }
  return localStorage.getItem('agora_derniere_commune') || 'eaucourt';
})();

// Clé publique VAPID pour les notifications push (la clé privée reste secrète côté Worker)
window.VAPID_PUBLIC_KEY = 'BP4VsbzEaz9CFIXy14keOhwtC-ws3RecrNmU75wjHW_r9HWxsghXI1PoYopDNI2GX4ghozXzNZTtllXAaSBTt_8';

// Renseignés dynamiquement après initCommune() dans navigation.js
window.USER_ID = null;
window.ROLE = null;
