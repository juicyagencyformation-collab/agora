// frontend/js/config.js
// MODIFIE CETTE LIGNE selon où tourne ton Worker :
// - Test local (wrangler dev) : 'http://localhost:8787'
// - Après déploiement Cloudflare : 'https://agora-worker.TON-SOUS-DOMAINE.workers.dev'
window.API_BASE = 'https://agora-worker.juicy-agency-formation.workers.dev';

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
