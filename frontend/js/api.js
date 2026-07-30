// frontend/js/api.js
async function appelApi(url, options = {}) {
  const urlComplete = url.toString().startsWith('http') ? url : `${window.API_BASE}${url}`;
  const reponse = await fetch(urlComplete, { ...options, credentials: 'include' });
  if (reponse.status !== 401) return reponse;

  const refresh = await fetch(`${window.API_BASE}/${window.COMMUNE_SLUG}/auth/refresh`, {
    method: 'POST', credentials: 'include',
  });
  if (!refresh.ok) {
    document.location.href = 'connexion.html';
    throw new Error('Session expirée');
  }
  return fetch(urlComplete, { ...options, credentials: 'include' });
}
