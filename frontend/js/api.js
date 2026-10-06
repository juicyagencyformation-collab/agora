// frontend/js/api.js
let rafraichissementEnCours = null;
let tentativeDemoEnCours = null;

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

// Pour une commune de démo publique (acces_libre=true en base, voir migration 076) : si la
// session a expiré/n'existe pas, on ouvre une session "visiteur" partagée plutôt que de renvoyer
// vers connexion.html — voir POST /:slug/auth/entrer-demo. Sans effet (403, demo.ok === false)
// sur une commune normale, qui retombe alors sur le renvoi habituel ci-dessous. Mutualisé comme
// rafraichirSession() : mêmes rafales d'appels concurrents au réveil de l'app.
function entrerEnModeDemo() {
  if (!tentativeDemoEnCours) {
    tentativeDemoEnCours = fetch(`${window.API_BASE}/${window.COMMUNE_SLUG}/auth/entrer-demo`, {
      method: 'POST', credentials: 'include',
    }).finally(() => { tentativeDemoEnCours = null; });
  }
  return tentativeDemoEnCours;
}

async function appelApi(url, options = {}) {
  const urlComplete = url.toString().startsWith('http') ? url : `${window.API_BASE}${url}`;
  const reponse = await fetch(urlComplete, { ...options, credentials: 'include' });
  if (reponse.status !== 401) return reponse;

  const refresh = await rafraichirSession();
  if (!refresh.ok) {
    const demo = await entrerEnModeDemo();
    if (!demo.ok) {
      document.location.href = 'connexion.html';
      throw new Error('Session expirée');
    }
    return fetch(urlComplete, { ...options, credentials: 'include' });
  }
  return fetch(urlComplete, { ...options, credentials: 'include' });
}
