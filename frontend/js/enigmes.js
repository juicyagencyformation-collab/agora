// frontend/js/enigmes.js
let enigmesCache = [];
let idEnigmeDetailOuverte = null;

async function chargerEnigmes() {
  // Explorateur sans village choisi : l'invitation à choisir est affichée côté chasses.
  if (window.EST_EXPLORATEUR && !villageVisite) {
    enigmesCache = [];
    renderListeEnigmes([]);
    return;
  }
  // En visite (villageVisite, voir chasse-tresor.js), la liste vient du même appel que les chasses.
  const res = await appelApi(villageVisite ? `/${window.COMMUNE_SLUG}/jeux-ailleurs/${villageVisite.slug}` : `/${window.COMMUNE_SLUG}/enigmes`);
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
    // En visite (ou Explorateur), on ne peut pas publier d'énigme : pas d'invitation à le faire.
    conteneur.innerHTML = villageVisite
      ? `<p class="dechets-vide">Aucune énigme photo dans ce village pour l'instant.</p>`
      : window.EST_EXPLORATEUR
        ? `<p class="dechets-vide">Choisissez d'abord un village.</p>`
        : `<p class="dechets-vide">Aucune énigme pour l'instant : prenez en photo un coin du village et lancez la première !</p>`;
  }
  enigmes.forEach((e) => conteneur.appendChild(renderCarteEnigmeCompacte(e)));
}

function renderCarteEnigmeCompacte(enigme) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'carte-enigme-vignette';
  el.setAttribute('aria-label', enigme.deja_trouve ? 'Énigme trouvée' : 'Énigme à trouver');
  el.innerHTML = `
    <img src="${enigme.url}" loading="lazy" alt="">
    ${enigme.deja_trouve ? '<span class="coche-vignette">✓</span>' : ''}
    <span class="etiquette-vignette">${enigme.est_moi ? 'Votre énigme' : `${enigme.total_trouveurs} 🔍`}</span>
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
    <p class="thermo-enigme" id="thermo-enigme" hidden></p>
    ${!enigme.est_moi && !enigme.deja_trouve ? '<button class="btn-je-suis-ici">📍 Je suis ici !</button>' : ''}
    ${enigme.lat != null ? '<div id="carte-enigme-trouvee" class="mini-carte-position carte-enigme-trouvee"></div>' : ''}
    <div class="actions-admin" style="margin-top:10px;">
      ${!enigme.est_moi ? `<button class="btn-signaler-enigme" ${enigme.deja_signale ? 'disabled' : ''}>${enigme.deja_signale ? 'Signalée' : '🚩 Signaler'}</button>` : ''}
      ${!villageVisite && (enigme.est_moi || ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) ? '<button class="btn-supprimer-enigme">Supprimer</button>' : ''}
    </div>
  `;

  zone.querySelector('.btn-retour-detail').addEventListener('click', () => fermerDetailEnigme());
  zone.querySelector('.image-detail-enigme').addEventListener('click', () => ouvrirLightbox(enigme.url));

  zone.querySelector('.btn-je-suis-ici')?.addEventListener('click', (e) => tenterEnigme(enigme.id, e.target));
  // Lieu révélé (énigme trouvée ou sa propre énigme) : petite carte. Les coordonnées ne sont
  // envoyées par le serveur que dans ces deux cas (voir listerEnigmesJouables).
  if (enigme.lat != null) {
    const carte = L.map('carte-enigme-trouvee', { zoomControl: false, attributionControl: false }).setView([enigme.lat, enigme.lng], 17);
    L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      { maxNativeZoom: 19, maxZoom: 19 },
    ).addTo(carte);
    L.marker([enigme.lat, enigme.lng], { icon: L.divIcon({ className: '', html: '<span class="pastille-balade etat-validee">📸</span>', iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(carte);
    setTimeout(() => carte.invalidateSize(), 120);
  }
  zone.querySelector('.btn-signaler-enigme')?.addEventListener('click', async () => {
    if (!confirm('Signaler cette énigme comme inappropriée ? Elle sera masquée en attente de revue par la mairie.')) return;
    await appelApi(urlJeux('enigmes', `/${enigme.id}/signaler`), { method: 'POST' });
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

  obtenirPositionPrecise((precision) => {
    bouton.textContent = `Précision : ±${Math.round(precision)} m…`;
  }).then(async (position) => {
    const res = await appelApi(urlJeux('enigmes', `/${enigmeId}/valider`), {
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
      if (typeof chargerProgressionExploration === 'function') chargerProgressionExploration();
      afficherToastMessage(`Bravo, trouvé ! Tu étais à ${data.distance_metres} m du bon endroit.`, 'succes');
      chargerEnigmes(); // l'écran de détail reste ouvert, juste rafraîchi avec le nouvel état
    } else {
      // Thermomètre ludique plutôt qu'un simple message d'erreur (rayon par défaut : 40 m).
      const thermo = document.getElementById('thermo-enigme');
      const temp = temperatureDistance(data.distance_metres, 40);
      if (thermo) {
        thermo.hidden = false;
        thermo.dataset.etat = temp.cle;
        thermo.innerHTML = `<strong>${temp.texte}</strong> · environ ${formaterDistance(data.distance_metres)} du lieu de la photo. Déplacez-vous et réessayez !`;
      }
      afficherToastMessage(`Pas encore : ${temp.texte.toLowerCase()}, environ ${formaterDistance(data.distance_metres)}.`, 'erreur');
      bouton.disabled = false;
      bouton.textContent = '📍 Je suis ici !';
    }
  }).catch(() => {
    afficherToastMessage('Impossible de récupérer ta position. Vérifie que la géolocalisation est autorisée.', 'erreur');
    bouton.disabled = false;
    bouton.textContent = '📍 Je suis ici !';
  });
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
  const overlay = ouvrirModaleFormulaire('Énigme photo', html);
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

    obtenirPositionPrecise((precision) => {
      boutonSubmit.textContent = `Précision : ±${Math.round(precision)} m…`;
    }).then(async (position) => {
      try {
        const compresse = await compresserImage(fichier, 1400, 0.8);
        const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/enigmes/upload`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (!resUpload.ok) {
          const data = await resUpload.json().catch(() => ({}));
          afficherToastMessage(data.erreur || 'Upload refusé par le serveur.', 'erreur');
          return;
        }
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
    }).catch(() => {
      afficherToastMessage('Impossible de récupérer ta position. Vérifie que la géolocalisation est autorisée.', 'erreur');
      boutonSubmit.disabled = false;
      boutonSubmit.textContent = 'Publier mon énigme';
    });
  });
}
