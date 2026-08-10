// frontend/js/alertes.js
let carteAlertes;
let positionSelectionneeAlerte = null;
let alertesCache = [];

const LABELS_STATUT_ALERTE = { ouverte: 'Ouverte', en_cours: 'En cours', resolue: 'Résolu' };

function estGestionnaireAlerte() {
  return ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);
}

async function initCarteAlertes() {
  if (!carteAlertes) {
    carteAlertes = L.map('carte-alertes', { maxZoom: 20 }).setView(
      [window.COMMUNE_LAT ?? 43.6047, window.COMMUNE_LNG ?? 1.4442],
      window.COMMUNE_COORDS_MANQUANTES ? 6 : 15,
    );
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

function peutSupprimerAlerte(alerte) {
  return alerte.user_id === window.USER_ID || ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);
}

async function supprimerAlerte(id) {
  if (!confirm('Supprimer définitivement ce signalement ?')) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes/${id}`, { method: 'DELETE' });
  if (res.ok) {
    afficherToastMessage('Signalement supprimé.', 'succes');
    initCarteAlertes();
  } else {
    const data = await res.json().catch(() => ({}));
    afficherToastMessage(data.erreur || 'Erreur lors de la suppression.', 'erreur');
  }
}

function ajouterMarqueurAlerte(alerte) {
  // Signalement sans localisation : pas de marqueur sur la carte (il reste dans la liste).
  if (alerte.lat == null || alerte.lng == null) return;
  const marqueur = alerte.urgent
    ? L.circleMarker([alerte.lat, alerte.lng], { radius: 10, color: '#C0392B', fillColor: '#C0392B', fillOpacity: 0.85, weight: 2 }).addTo(carteAlertes)
    : L.marker([alerte.lat, alerte.lng]).addTo(carteAlertes);

  const popup = document.createElement('div');
  popup.innerHTML = `
    ${alerte.urgent ? '<span class="badge-urgent-alerte">🚨 URGENT</span>' : ''}
    <strong>${escapeAttr(alerte.titre)}</strong>
    <p>${texteAvecLiensCliquables(alerte.description)}</p>
    <span class="badge-statut-alerte badge-statut-${alerte.statut}">${LABELS_STATUT_ALERTE[alerte.statut] ?? alerte.statut}</span>
    ${alerte.soutiens ? `<span style="font-size:11px;color:var(--roseau);margin-left:6px;">👍 ${alerte.soutiens}</span>` : ''}
    ${alerte.reponse_officielle ? '<p style="font-size:11px;color:var(--prairie);margin-top:4px;">🏛️ Réponse de la mairie disponible</p>' : ''}
    <div class="images-popup"></div>
    ${peutSupprimerAlerte(alerte) ? '<button class="btn-supprimer-alerte-popup" style="margin-top:6px;background:transparent;color:var(--rouge);border:1px solid var(--rouge);font-size:11px;padding:4px 8px;">🗑️ Supprimer</button>' : ''}
  `;
  const zoneImages = popup.querySelector('.images-popup');
  alerte.images.forEach((url) => {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'miniature-article';
    img.addEventListener('click', () => ouvrirLightbox(url));
    zoneImages.appendChild(img);
  });
  popup.querySelector('.btn-supprimer-alerte-popup')?.addEventListener('click', () => supprimerAlerte(alerte.id));
  marqueur.bindPopup(popup);
}

// ── Liste des signalements sous la carte ──

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
  // Outline colorée selon le statut : ouverte (rouge), en cours (or), résolu (vert).
  el.className = `carte-article-compacte carte-alerte-${alerte.statut}`;
  const dateAffichee = new Date(alerte.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide" style="${alerte.urgent ? 'background:rgba(192,57,43,.15);' : ''}">${alerte.urgent ? '🚨' : '⚠️'}</div>
      <div class="texte-entete-article">
        <div class="badges-event-compact">
          ${alerte.urgent ? '<span class="badge-categorie-article badge-urgent-alerte" style="margin:0;">Urgent</span>' : ''}
          <span class="badge-statut-alerte badge-statut-${alerte.statut}">${LABELS_STATUT_ALERTE[alerte.statut] ?? alerte.statut}</span>
          ${alerte.soutiens ? `<span class="badge-categorie-article">👍 ${alerte.soutiens}</span>` : ''}
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
      remplirDetailAlerte(zoneDepliee, alerte);
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}

function remplirDetailAlerte(zone, alerte) {
  const estGestionnaire = estGestionnaireAlerte();
  const estAuteur = alerte.user_id === window.USER_ID;

  zone.innerHTML = `
    <p>${texteAvecLiensCliquables(alerte.description)}</p>
    <div class="images-alerte-liste"></div>

    ${alerte.reponse_officielle ? `
      <div class="reponse-mairie">
        <div class="reponse-mairie-entete">🏛️ Réponse de la mairie${alerte.reponse_par_nom ? ` · ${escapeAttr(alerte.reponse_par_nom)}` : ''}</div>
        <p>${texteAvecLiensCliquables(alerte.reponse_officielle)}</p>
      </div>` : ''}

    <div class="ligne-soutien-alerte">
      ${estAuteur
        ? `<span class="info-soutien">👍 ${alerte.soutiens} soutien(s)</span>`
        : `<button type="button" class="btn-soutenir ${alerte.je_soutiens ? 'soutenu' : ''}">👍 <span class="txt-soutien">${alerte.je_soutiens ? 'Soutenu' : 'Soutenir'}</span> · <span class="compteur-soutien">${alerte.soutiens}</span></button>`}
    </div>

    ${estGestionnaire ? `
      <div class="actions-gestion-alerte">
        <div class="boutons-statut-alerte">
          <button type="button" data-statut="en_cours" class="${alerte.statut === 'en_cours' ? 'actif' : ''}">🔧 En cours</button>
          <button type="button" data-statut="resolue" class="${alerte.statut === 'resolue' ? 'actif' : ''}">✅ Résolu</button>
          <button type="button" data-statut="ouverte" class="${alerte.statut === 'ouverte' ? 'actif' : ''}">↩️ Rouvrir</button>
        </div>
        <label class="label-champ-edition">Réponse officielle de la mairie</label>
        <textarea class="reponse-officielle-input" placeholder="Répondre publiquement à ce signalement (optionnel)">${escapeAttr(alerte.reponse_officielle || '')}</textarea>
        <button type="button" class="btn-enregistrer-reponse">💬 Publier la réponse</button>
      </div>` : ''}

    ${peutSupprimerAlerte(alerte) ? `
      <div class="actions-auteur-alerte">
        <button class="btn-modifier-alerte-liste">✏️ Modifier</button>
        <button class="btn-supprimer-alerte-liste">🗑️ Supprimer</button>
      </div>` : ''}
  `;

  const zoneImages = zone.querySelector('.images-alerte-liste');
  alerte.images.forEach((url) => {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'miniature-article';
    img.addEventListener('click', () => ouvrirLightbox(url));
    zoneImages.appendChild(img);
  });

  // Soutenir / retirer son soutien (mise à jour en place, sans recharger toute la liste).
  zone.querySelector('.btn-soutenir')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.disabled = true;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes/${alerte.id}/soutenir`, { method: 'POST' });
    btn.disabled = false;
    if (!res.ok) return;
    const data = await res.json();
    alerte.soutiens = data.soutiens;
    alerte.je_soutiens = data.je_soutiens;
    btn.classList.toggle('soutenu', data.je_soutiens);
    btn.querySelector('.txt-soutien').textContent = data.je_soutiens ? 'Soutenu' : 'Soutenir';
    btn.querySelector('.compteur-soutien').textContent = data.soutiens;
  });

  // Changement de statut (gestionnaires) → recharge pour refléter l'outline/badge.
  zone.querySelectorAll('.boutons-statut-alerte [data-statut]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes/${alerte.id}/statut`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut: btn.dataset.statut }),
      });
      if (res.ok) { afficherToastMessage('Statut mis à jour.', 'succes'); initCarteAlertes(); }
      else afficherToastMessage('Erreur lors du changement de statut.', 'erreur');
    });
  });

  // Réponse officielle (gestionnaires).
  zone.querySelector('.btn-enregistrer-reponse')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const reponse = zone.querySelector('.reponse-officielle-input').value.trim();
    const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes/${alerte.id}/reponse`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reponse }),
    });
    if (res.ok) { afficherToastMessage('Réponse publiée.', 'succes'); initCarteAlertes(); }
    else afficherToastMessage('Erreur lors de la publication.', 'erreur');
  });

  zone.querySelector('.btn-modifier-alerte-liste')?.addEventListener('click', (e) => {
    e.stopPropagation();
    ouvrirModaleEditionAlerte(alerte);
  });

  zone.querySelector('.btn-supprimer-alerte-liste')?.addEventListener('click', (e) => {
    e.stopPropagation();
    supprimerAlerte(alerte.id);
  });
}

// ── Édition d'un signalement (par son auteur ou un gestionnaire) ──
function ouvrirModaleEditionAlerte(alerte) {
  positionSelectionneeAlerte = (alerte.lat != null && alerte.lng != null)
    ? { lat: alerte.lat, lng: alerte.lng } : null;

  const html = `
    <form id="form-edition-alerte">
      <input type="text" id="titre-edition-alerte" maxlength="150" required value="${escapeAttr(alerte.titre)}">
      <textarea id="description-edition-alerte" required>${escapeAttr(alerte.description)}</textarea>

      <label class="label-champ-edition">Localisation (optionnel)</label>
      <button type="button" id="btn-position-edition-alerte">📍 Utiliser ma position actuelle</button>
      <p id="position-edition-alerte" style="font-size:12px;color:var(--roseau);">${positionSelectionneeAlerte ? '📍 Position enregistrée.' : 'Aucune position.'}</p>

      <label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:13.5px;">
        <input type="checkbox" id="urgent-edition-alerte" style="width:auto;margin:0;" ${alerte.urgent ? 'checked' : ''}>
        🚨 Signalement urgent (danger immédiat)
      </label>

      <button type="submit" style="margin-top:12px;">Enregistrer</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Modifier le signalement', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#btn-position-edition-alerte').addEventListener('click', () => {
    if (!navigator.geolocation) { afficherToastMessage('Géolocalisation indisponible.', 'erreur'); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      positionSelectionneeAlerte = { lat: position.coords.latitude, lng: position.coords.longitude };
      corps.querySelector('#position-edition-alerte').textContent = '📍 Position mise à jour !';
    }, () => afficherToastMessage('Impossible de récupérer la position.', 'erreur'));
  });

  corps.querySelector('#form-edition-alerte').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-edition-alerte').value.trim();
    const description = corps.querySelector('#description-edition-alerte').value.trim();
    const urgent = corps.querySelector('#urgent-edition-alerte').checked;
    if (!titre || !description) return;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes/${alerte.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titre, description, urgent,
        ...(positionSelectionneeAlerte ? { lat: positionSelectionneeAlerte.lat, lng: positionSelectionneeAlerte.lng } : {}),
      }),
    });
    if (res.ok) { fermerModaleFormulaire(overlay); afficherToastMessage('Signalement modifié.', 'succes'); initCarteAlertes(); }
    else { const data = await res.json(); afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur', 'erreur'); }
  });
}

// ── Formulaire de création (bouton "🚨 Signaler un problème") ──

function initFormulaireAlerte() {
  const btn = document.getElementById('btn-ouvrir-creation-alerte');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationAlerte());
}

function ouvrirModaleCreationAlerte() {
  positionSelectionneeAlerte = null;
  const html = `
    <form id="form-modale-alerte">
      <input type="text" id="titre-alerte-modale" placeholder="Titre du signalement" maxlength="150" required>
      <textarea id="description-alerte-modale" placeholder="Décrivez le problème" required></textarea>

      <label class="label-champ-edition">Localisation (optionnel)</label>
      <button type="button" id="btn-position-alerte">📍 Utiliser ma position actuelle</button>
      <p id="position-choisie-alerte" style="font-size:12px;color:var(--roseau);">Sans position, le signalement reste dans la liste mais n'apparaît pas sur la carte.</p>

      <label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:13.5px;">
        <input type="checkbox" id="urgent-alerte-modale" style="width:auto;margin:0;">
        🚨 Signalement urgent (danger immédiat)
      </label>

      <label class="label-champ-edition">Photo (optionnel)</label>
      <input type="file" id="image-alerte-modale" accept="image/jpeg,image/png,image/webp">

      <button type="submit" style="margin-top:12px;">Signaler</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Signaler un problème', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#btn-position-alerte').addEventListener('click', () => {
    if (!navigator.geolocation) { afficherToastMessage('Géolocalisation indisponible.', 'erreur'); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      positionSelectionneeAlerte = { lat: position.coords.latitude, lng: position.coords.longitude };
      corps.querySelector('#position-choisie-alerte').textContent = '📍 Position enregistrée !';
    }, () => afficherToastMessage('Impossible de récupérer la position.', 'erreur'));
  });

  corps.querySelector('#form-modale-alerte').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-alerte-modale').value.trim();
    const description = corps.querySelector('#description-alerte-modale').value.trim();
    const urgent = corps.querySelector('#urgent-alerte-modale').checked;
    if (!titre || !description) return;

    let image_r2_keys;
    const fichier = corps.querySelector('#image-alerte-modale').files[0];
    if (fichier) {
      try {
        const compresse = await compresserImage(fichier);
        const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/alertes/upload`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (resUpload.ok) { const { key } = await resUpload.json(); image_r2_keys = [key]; }
      } catch { console.warn('Upload image échoué, signalement publié sans photo.'); }
    }

    const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titre, description, urgent,
        ...(positionSelectionneeAlerte ? { lat: positionSelectionneeAlerte.lat, lng: positionSelectionneeAlerte.lng } : {}),
        image_r2_keys,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      fermerModaleFormulaire(overlay);
      traiterRecompense?.(data);
      initCarteAlertes();
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur lors du signalement', 'erreur');
    }
  });
}
