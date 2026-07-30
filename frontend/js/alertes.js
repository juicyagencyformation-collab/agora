// frontend/js/alertes.js
let carteAlertes;
let positionSelectionneeAlerte = null;
let alertesCache = [];

async function initCarteAlertes() {
  if (!carteAlertes) {
    carteAlertes = L.map('carte-alertes', { maxZoom: 20 }).setView(
      [window.COMMUNE_LAT ?? 43.6047, window.COMMUNE_LNG ?? 1.4442],
      window.COMMUNE_COORDS_MANQUANTES ? 6 : 15,
    );
    // Plan IGN (institut cartographique national français), licence ouverte, sans clé API —
    // généralement plus précis qu'OpenStreetMap sur les petites communes rurales françaises.
    L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 20 },
    ).addTo(carteAlertes);
  }

  const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes`);
  if (!res.ok) return;
  const { alertes } = await res.json();
  alertesCache = alertes;

  carteAlertes.eachLayer((couche) => {
    if (couche instanceof L.Marker || couche instanceof L.CircleMarker) carteAlertes.removeLayer(couche);
  });
  alertes.forEach(ajouterMarqueurAlerte);
  renderListeAlertes(alertes);
}

function ajouterMarqueurAlerte(alerte) {
  const marqueur = alerte.urgent
    ? L.circleMarker([alerte.lat, alerte.lng], { radius: 10, color: '#C0392B', fillColor: '#C0392B', fillOpacity: 0.85, weight: 2 }).addTo(carteAlertes)
    : L.marker([alerte.lat, alerte.lng]).addTo(carteAlertes);

  const popup = document.createElement('div');
  popup.innerHTML = `
    ${alerte.urgent ? '<span class="badge-urgent-alerte">🚨 URGENT</span>' : ''}
    <strong>${escapeAttr(alerte.titre)}</strong>
    <p>${escapeAttr(alerte.description)}</p>
    <span class="badge-statut badge-${alerte.statut}">${alerte.statut}</span>
    <div class="images-popup"></div>
  `;
  const zoneImages = popup.querySelector('.images-popup');
  alerte.images.forEach((url) => {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'miniature-article';
    img.addEventListener('click', () => ouvrirLightbox(url));
    zoneImages.appendChild(img);
  });
  marqueur.bindPopup(popup);
}

// ── Liste des signalements sous la carte (vue compacte, cohérente avec le reste de l'app) ──

function renderListeAlertes(alertes) {
  const conteneur = document.getElementById('liste-alertes');
  if (!conteneur) return;
  conteneur.innerHTML = '';
  if (!alertes.length) {
    conteneur.innerHTML = `<p class="dechets-vide">Aucun signalement pour l'instant.</p>`;
    return;
  }
  alertes.forEach((a) => conteneur.appendChild(renderCarteAlerteCompacte(a)));
}

function renderCarteAlerteCompacte(alerte) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const dateAffichee = new Date(alerte.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide" style="${alerte.urgent ? 'background:rgba(192,57,43,.15);' : ''}">${alerte.urgent ? '🚨' : '⚠️'}</div>
      <div class="texte-entete-article">
        <div class="badges-event-compact">
          ${alerte.urgent ? '<span class="badge-categorie-article badge-urgent-alerte" style="margin:0;">Urgent</span>' : ''}
          <span class="badge-categorie-article">${alerte.statut}</span>
        </div>
        <h3 class="titre-article-compact">${escapeAttr(alerte.titre)}</h3>
        <span class="date-article-compact">${dateAffichee}</span>
      </div>
    </button>
    <div class="contenu-article-deplie" hidden></div>
  `;

  const zoneDepliee = el.querySelector('.contenu-article-deplie');
  let deploye = false;
  el.querySelector('.entete-article-compact').addEventListener('click', () => {
    deploye = !deploye;
    zoneDepliee.hidden = !deploye;
    if (deploye && zoneDepliee.dataset.rempli !== 'true') {
      zoneDepliee.innerHTML = `<p>${escapeAttr(alerte.description)}</p><div class="images-alerte-liste"></div>`;
      const zoneImages = zoneDepliee.querySelector('.images-alerte-liste');
      alerte.images.forEach((url) => {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'miniature-article';
        img.addEventListener('click', () => ouvrirLightbox(url));
        zoneImages.appendChild(img);
      });
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}

function initFormulaireAlerte() {
  const btn = document.getElementById('btn-ouvrir-creation-alerte');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationAlerte());
}

function ouvrirModaleCreationAlerte() {
  positionSelectionneeAlerte = null;
  const html = `
    <form id="form-modale-alerte">
      <input type="text" id="titre-alerte-modale" placeholder="Titre" maxlength="150" required>
      <textarea id="description-alerte-modale" placeholder="Description" required></textarea>
      <input type="file" id="image-alerte-modale" accept="image/*">
      <button type="button" id="btn-position-alerte-modale">📍 Récupérer ma position GPS</button>
      <p id="position-choisie-modale" style="font-size:12.5px;color:var(--roseau);"></p>
      <label style="display:flex;align-items:center;gap:6px;font-size:13.5px;color:var(--rouge);font-weight:600;margin:10px 0;">
        <input type="checkbox" id="urgent-alerte-modale" style="width:auto;margin:0;">
        Signalement urgent
      </label>
      <button type="submit">Signaler</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Signaler un problème', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  const boutonPosition = corps.querySelector('#btn-position-alerte-modale');
  boutonPosition.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('La géolocalisation n\'est pas disponible sur cet appareil.');
      return;
    }
    boutonPosition.disabled = true;
    boutonPosition.textContent = 'Localisation en cours…';

    navigator.geolocation.getCurrentPosition((position) => {
      positionSelectionneeAlerte = { lat: position.coords.latitude, lng: position.coords.longitude };
      corps.querySelector('#position-choisie-modale').textContent =
        `📍 Position récupérée (précision ≈ ${Math.round(position.coords.accuracy)} m)`;
      boutonPosition.disabled = false;
      boutonPosition.textContent = '📍 Récupérer ma position GPS';
    }, () => {
      alert('Impossible de récupérer ta position. Vérifie que la géolocalisation est autorisée.');
      boutonPosition.disabled = false;
      boutonPosition.textContent = '📍 Récupérer ma position GPS';
    }, { enableHighAccuracy: true, timeout: 10000 });
  });

  corps.querySelector('#form-modale-alerte').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!positionSelectionneeAlerte) {
      alert('Récupère ta position GPS avant d\'envoyer le signalement.');
      return;
    }

    const titre = corps.querySelector('#titre-alerte-modale').value.trim();
    const description = corps.querySelector('#description-alerte-modale').value.trim();
    const urgent = corps.querySelector('#urgent-alerte-modale').checked;
    if (!titre || !description) return;

    let imageR2Keys = [];
    const fichier = corps.querySelector('#image-alerte-modale').files[0];
    if (fichier) {
      try {
        const compresse = await compresserImage(fichier);
        const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/alertes/upload`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (resUpload.ok) { const { key } = await resUpload.json(); imageR2Keys = [key]; }
      } catch { console.warn('Upload image échoué.'); }
    }

    const res = await creerAlerte(titre, description, positionSelectionneeAlerte.lat, positionSelectionneeAlerte.lng, imageR2Keys, urgent);
    if (res.ok) {
      fermerModaleFormulaire(overlay);
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de publication');
    }
  });
}

async function creerAlerte(titre, description, lat, lng, imageR2Keys = [], urgent = false) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titre, description, lat, lng, image_r2_keys: imageR2Keys, urgent }),
  });
  if (res.ok) {
    traiterRecompense(await res.clone().json());
    initCarteAlertes();
  }
  return res;
}
