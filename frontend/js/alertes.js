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
  return alerte.user_id === window.USER_ID || ['admin', 'elu', 'superadmin'].includes(window.ROLE);
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
      zoneDepliee.innerHTML = `
        <p>${escapeAttr(alerte.description)}</p>
        <div class="images-alerte-liste"></div>
        ${peutSupprimerAlerte(alerte) ? '<button class="btn-supprimer-alerte-liste" style="margin-top:10px;background:transparent;color:var(--rouge);border:1.5px solid var(--rouge);">🗑️ Supprimer ce signalement</button>' : ''}
      `;
      const zoneImages = zoneDepliee.querySelector('.images-alerte-liste');
      alerte.images.forEach((url) => {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'miniature-article';
        img.addEventListener('click', () => ouvrirLightbox(url));
        zoneImages.appendChild(img);
      });
      zoneDepliee.querySelector('.btn-supprimer-alerte-liste')?.addEventListener('click', (e) => {
        e.stopPropagation();
        supprimerAlerte(alerte.id);
      });
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}
