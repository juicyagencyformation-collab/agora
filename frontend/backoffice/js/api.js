// frontend/backoffice/js/api.js
// Petit wrapper d'appel à l'API backoffice. Same-origin via /api/backoffice/... (relayé au
// Worker par frontend/functions/[[path]].js), cookies inclus. Sur 401, tente un refresh de
// session une fois puis rejoue la requête ; si le refresh échoue, renvoie vers la connexion.
const BO_API = '/api/backoffice';

async function boFetch(chemin, options = {}, _reessai = false) {
  const res = await fetch(BO_API + chemin, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  if (res.status === 401 && !_reessai && !chemin.startsWith('/auth/')) {
    const refresh = await fetch(BO_API + '/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refresh.ok) return boFetch(chemin, options, true);
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
