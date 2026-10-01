// frontend/js/api.js
let rafraichissementEnCours = null;

// Un seul rafraîchissement de session à la fois. Au réveil de l'app, une bonne dizaine
// d'appels partent en parallèle (voir dashboard.js) : si le jeton de 15 minutes vient
// d'expirer, ils reçoivent tous un 401 au même instant. Le jeton de rafraîchissement étant à
// usage unique côté serveur (rotation), des rafraîchissements concurrents se marchent dessus —
// un seul réussit, les autres trouvent le leur déjà révoqué et le serveur supprime alors le
// cookie de session, cassant une session qui aurait dû se renouveler normalement (voir
// auth.ts, POST /refresh). En mutualisant la même promesse entre tous les appels simultanés,
// une seule requête de rafraîchissement part réellement.
function rafraichirSession() {
  if (!rafraichissementEnCours) {
    rafraichissementEnCours = fetch(`${window.API_BASE}/${window.COMMUNE_SLUG}/auth/refresh`, {
      method: 'POST', credentials: 'include',
    }).finally(() => { rafraichissementEnCours = null; });
  }
  return rafraichissementEnCours;
}

async function appelApi(url, options = {}) {
  const urlComplete = url.toString().startsWith('http') ? url : `${window.API_BASE}${url}`;
  const reponse = await fetch(urlComplete, { ...options, credentials: 'include' });
  if (reponse.status !== 401) return reponse;

  const refresh = await rafraichirSession();
  if (!refresh.ok) {
    document.location.href = 'connexion.html';
    throw new Error('Session expirée');
  }
  return fetch(urlComplete, { ...options, credentials: 'include' });
}
