// frontend/backoffice/js/api.js
// Petit wrapper d'appel à l'API backoffice. Same-origin via /api/backoffice/... (relayé au
// Worker par frontend/functions/[[path]].js), cookies inclus. Sur 401, tente un refresh de
// session une fois puis rejoue la requête ; si le refresh échoue, renvoie vers la connexion.
const BO_API = '/api/backoffice';

// Le token d'accès dure 15 min (worker/src/backoffice/auth.ts) et cette page lance souvent
// plusieurs boFetch en parallèle (ex. init()) : s'il expire pendant que plusieurs appels sont
// en vol, ils tentent chacun leur propre /auth/refresh avec le MÊME refresh token — or celui-ci
// est à usage unique (rotation, voir POST /refresh). Un seul réussit, les autres se voient
// refuser un token pourtant valide l'instant d'avant, et échouent silencieusement (bug constaté
// le 2026-08-18 : une action semble "ne pas marcher" sans erreur visible). On partage donc un
// seul rafraîchissement en cours entre tous les appels simultanés.
let rafraichissementEnCours = null;

async function boFetch(chemin, options = {}, _reessai = false) {
  const res = await fetch(BO_API + chemin, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (res.status === 401 && !_reessai && !chemin.startsWith('/auth/')) {
    if (!rafraichissementEnCours) {
      rafraichissementEnCours = fetch(BO_API + '/auth/refresh', { method: 'POST', credentials: 'include' })
        .then((r) => r.ok)
        .finally(() => { rafraichissementEnCours = null; });
    }
    const ok = await rafraichissementEnCours;
    if (ok) return boFetch(chemin, options, true);
    redirigerVersConnexion();
    throw new Error('Session expirée');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const erreur = new Error(data.erreur ? (typeof data.erreur === 'string' ? data.erreur : 'Erreur') : 'Erreur');
    erreur.status = res.status; // permet aux appelants de distinguer un échec "attendu" (ex: 422) d'une vraie panne
    throw erreur;
  }
  return data;
}

function redirigerVersConnexion() {
  if (!location.pathname.endsWith('/connexion') && !location.pathname.endsWith('/connexion.html')) {
    location.href = '/backoffice/connexion';
  }
}

window.boFetch = boFetch;
window.redirigerVersConnexion = redirigerVersConnexion;
