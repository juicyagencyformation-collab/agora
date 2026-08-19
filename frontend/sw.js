// frontend/sw.js
// ⚠️ CACHE_NAME DOIT être bumpé à CHAQUE déploiement (même date que le ?v= des HTML). Sinon
// sw.js reste identique d'un déploiement à l'autre, le navigateur ne détecte aucune mise à
// jour du service worker, et l'ancien cache n'est jamais purgé — une app installée (surtout
// iOS/PWA) peut alors rester bloquée sur une version cassée (page d'accueil vide, etc.). Le
// changement de nom force la ré-installation du SW puis la suppression des anciens caches
// dans l'événement 'activate' ci-dessous. Voir CLAUDE.md (pièges de cache).
const CACHE_NAME = 'agora-shell-20260819-1';
const FICHIERS_A_METTRE_EN_CACHE = [
  '/index.html',
  '/connexion.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FICHIERS_A_METTRE_EN_CACHE)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((noms) => Promise.all(
      noms.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
    )),
  );
  self.clients.claim();
});

// Réseau d'abord (toujours la dernière version en ligne — important vu la fréquence des mises
// à jour de cette app), le cache ne sert que de secours quand il n'y a pas de réseau du tout.
// Ne s'applique jamais aux appels vers l'API (/api/...) : ceux-ci doivent toujours échouer
// proprement hors-ligne plutôt que de servir une réponse mise en cache potentiellement fausse
// (données citoyennes, votes, etc.). Depuis le passage de l'API en proxy same-origin (voir
// frontend/functions/[[path]].js), le test sur l'origine ne suffit plus à les exclure — d'où
// le test explicite sur le chemin /api/.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((reponseReseau) => {
        const copie = reponseReseau.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copie));
        return reponseReseau;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Agora', body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/index.html' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const cible = event.notification.data || {};
  const url = cible.url || '/index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsArr) => {
      const dejaOuvert = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (dejaOuvert) {
        // App déjà ouverte : on lui transmet la cible en message plutôt que de recharger
        // la page (préserve la session/l'état déjà chargé côté client).
        dejaOuvert.postMessage({ type: 'notification-click', url });
        return dejaOuvert.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
