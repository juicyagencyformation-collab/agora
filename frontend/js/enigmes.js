// frontend/js/enigmes.js
let enigmesCache = [];
let idEnigmeDetailOuverte = null;

async function chargerEnigmes() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/enigmes`);
  if (!res.ok) return;
  const { enigmes } = await res.json();
  enigmesCache = enigmes;
  const compte = document.getElementById('compte-enigmes');
  if (compte) compte.textContent = enigmes.length;

  if (idEnigmeDetailOuverte) {
    const enigme = enigmes.find((e) => e.id === idEnigmeDetailOuverte);
    if (enigme) { renderDetailEnigme(enigme); return; }
    idEnigmeDetailOuverte = null; // supprimée entre-temps
  }
  renderListeEnigmes(enigmes);
}

function renderListeEnigmes(enigmes) {
  document.getElementById('vue-liste-enigmes').hidden = false;
  document.getElementById('vue-detail-enigme').hidden = true;
  const conteneur = document.getElementById('liste-enigmes');
  conteneur.innerHTML = '';
  if (!enigmes.length) {
    conteneur.innerHTML = `<p class="dechets-vide">Aucune énigme pour l'instant — sois le premier à en poser une !</p>`;
  }
  enigmes.forEach((e) => conteneur.appendChild(renderCarteEnigmeCompacte(e)));
}

function renderCarteEnigmeCompacte(enigme) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'carte-enigme-compacte';
  el.innerHTML = `
    <img src="${enigme.url}" loading="lazy">
    <div class="texte-carte-enigme-compacte">
      ${enigme.est_moi ? '<span class="badge-ma-photo">Votre énigme</span>' : ''}
      ${enigme.deja_trouve ? '<span class="trouve-enigme">🎉 Trouvée</span>' : `<span class="meta-enigme">${enigme.total_trouveurs} trouveur(s)</span>`}
    </div>
  `;
  el.addEventListener('click', () => ouvrirDetailEnigme(enigme.id));
  return el;
}

// ── Écran de détail dédié — reste stable pendant tout le flux GPS/validation. ──

function ouvrirDetailEnigme(id) {
  idEnigmeDetailOuverte = id;
  const enigme = enigmesCache.find((e) => e.id === id);
  if (enigme) renderDetailEnigme(enigme);
}

function fermerDetailEnigme() {
  idEnigmeDetailOuverte = null;
  renderListeEnigmes(enigmesCache);
}

function renderDetailEnigme(enigme) {
  document.getElementById('vue-liste-enigmes').hidden = true;
  const zone = document.getElementById('vue-detail-enigme');
  zone.hidden = false;

  zone.innerHTML = `
    <button type="button" class="btn-retour-detail">← Retour aux énigmes</button>
    <img src="${enigme.url}" class="image-detail-enigme">
    ${enigme.indice ? `<p class="indice-enigme">💡 ${escapeAttr(enigme.indice)}</p>` : ''}
    <p class="meta-enigme">${enigme.total_trouveurs} personne(s) ont trouvé</p>
    ${enigme.est_moi ? '<span class="badge-ma-photo">Votre énigme</span>' : ''}
    ${enigme.deja_trouve ? `<p class="trouve-enigme">🎉 Trouvée ! (à ${enigme.distance_metres} m près)</p>` : ''}
    ${!enigme.est_moi && !enigme.deja_trouve ? '<button class="btn-je-suis-ici">📍 Je suis ici !</button>' : ''}
    <div class="actions-admin" style="margin-top:10px;">
      ${!enigme.est_moi ? `<button class="btn-signaler-enigme" ${enigme.deja_signale ? 'disabled' : ''}>${enigme.deja_signale ? 'Signalée' : '🚩 Signaler'}</button>` : ''}
      ${enigme.est_moi || ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE) ? '<button class="btn-supprimer-enigme">Supprimer</button>' : ''}
    </div>
  `;

  zone.querySelector('.btn-retour-detail').addEventListener('click', () => fermerDetailEnigme());
  zone.querySelector('.image-detail-enigme').addEventListener('click', () => ouvrirLightbox(enigme.url));

  zone.querySelector('.btn-je-suis-ici')?.addEventListener('click', (e) => tenterEnigme(enigme.id, e.target));
  zone.querySelector('.btn-signaler-enigme')?.addEventListener('click', async () => {
    if (!confirm('Signaler cette énigme comme inappropriée ? Elle sera masquée en attente de revue par la mairie.')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/enigmes/${enigme.id}/signaler`, { method: 'POST' });
    idEnigmeDetailOuverte = null;
    chargerEnigmes();
  });
  zone.querySelector('.btn-supprimer-enigme')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette énigme ?')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/enigmes/${enigme.id}`, { method: 'DELETE' });
    idEnigmeDetailOuverte = null;
    chargerEnigmes();
  });
}

function tenterEnigme(enigmeId, bouton) {
  if (!navigator.geolocation) {
    afficherToastMessage('La géolocalisation n\'est pas disponible sur cet appareil.', 'erreur');
    return;
  }
  bouton.disabled = true;
  bouton.textContent = 'Localisation en cours…';

  navigator.geolocation.getCurrentPosition(async (position) => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/enigmes/${enigmeId}/valider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude }),
    });
    const data = await res.json();
    if (!res.ok) {
      afficherToastMessage(data.erreur || 'Erreur', 'erreur');
      bouton.disabled = false;
      bouton.textContent = '📍 Je suis ici !';
      return;
    }

    if (data.reussi) {
      traiterRecompense(data);
      afficherToastMessage(`Bravo, trouvé ! Tu étais à ${data.distance_metres} m du bon endroit.`, 'succes');
      chargerEnigmes(); // l'écran de détail reste ouvert, juste rafraîchi avec le nouvel état
    } else {
      afficherToastMessage(`Pas encore ! Tu es à environ ${data.distance_metres} m. Réessaie.`, 'erreur');
      bouton.disabled = false;
      bouton.textContent = '📍 Je suis ici !';
    }
  }, () => {
    afficherToastMessage('Impossible de récupérer ta position. Vérifie que la géolocalisation est autorisée.', 'erreur');
    bouton.disabled = false;
    bouton.textContent = '📍 Je suis ici !';
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function initFormulaireEnigme() {
  const btn = document.getElementById('btn-ouvrir-creation-enigme');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationEnigme());
}

function ouvrirModaleCreationEnigme() {
  const html = `
    <form id="form-modale-enigme">
      <input type="file" id="fichier-enigme-modale" accept="image/*" capture="environment" required>
      <input type="text" id="indice-enigme-modale" placeholder="Indice (optionnel)" maxlength="200">
      <button type="submit">Publier mon énigme</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Trouve la photo', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-enigme').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fichier = corps.querySelector('#fichier-enigme-modale').files[0];
    if (!fichier) return;
    if (!navigator.geolocation) {
      afficherToastMessage('La géolocalisation n\'est pas disponible sur cet appareil.', 'erreur');
      return;
    }
    const indice = corps.querySelector('#indice-enigme-modale').value.trim();
    const boutonSubmit = corps.querySelector('button[type="submit"]');
    boutonSubmit.disabled = true;
    boutonSubmit.textContent = 'Localisation en cours…';

    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const compresse = await compresserImage(fichier, 1400, 0.8);
        const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/enigmes/upload`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (!resUpload.ok) { afficherToastMessage('Upload refusé par le serveur.', 'erreur'); return; }
        const { key } = await resUpload.json();

        const res = await appelApi(`/${window.COMMUNE_SLUG}/enigmes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ r2_key: key, indice, lat: position.coords.latitude, lng: position.coords.longitude }),
        });
        if (res.ok) {
          traiterRecompense(await res.clone().json());
          fermerModaleFormulaire(overlay);
          chargerEnigmes();
        } else {
          const data = await res.json();
          afficherToastMessage(data.erreur || 'Erreur de publication', 'erreur');
        }
      } catch {
        afficherToastMessage('Échec de la publication.', 'erreur');
      } finally {
        boutonSubmit.disabled = false;
        boutonSubmit.textContent = 'Publier mon énigme';
      }
    }, () => {
      afficherToastMessage('Impossible de récupérer ta position. Vérifie que la géolocalisation est autorisée.', 'erreur');
      boutonSubmit.disabled = false;
      boutonSubmit.textContent = 'Publier mon énigme';
    }, { enableHighAccuracy: true, timeout: 10000 });
  });
}
