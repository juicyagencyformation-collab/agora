// frontend/js/chasse-tresor.js
let compteurEtapes = 0;
let chassesCache = [];
let idChasseDetailOuverte = null;
let carteBalade = null;
let modeArchivesChasses = false;
let carteCreationChasse = null;
let marqueursEtapesChasse = new Map();

// ── Jouer dans un autre village (worker/src/routes/jeux_ailleurs.ts) ──
// null = on joue chez soi. Sinon { nom, slug, mon_nom_public } de la commune visitée : les
// appels de jeu partent vers /jeux-ailleurs/<slug>/..., et tout ce qui relève de la gestion
// (création, archives, suppression) ou des habitants (classement exploration) est masqué.
// Partagé avec enigmes.js (script classique : même portée globale).
let villageVisite = null;

function urlJeux(module, chemin = '') {
  return villageVisite
    ? `/${window.COMMUNE_SLUG}/jeux-ailleurs/${villageVisite.slug}/${module}${chemin}`
    : `/${window.COMMUNE_SLUG}/${module}${chemin}`;
}

// Carte « Vos découvertes » en haut de l'onglet (2026-11-05), rafraîchie après chaque réussite.
async function chargerProgressionExploration() {
  const carte = document.getElementById('carte-progression-exploration');
  if (!carte) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/profil`).catch(() => null);
  if (!res?.ok) return;
  const user = await res.json();
  const etapes = user.etapes_chasse_validees ?? 0;
  const enigmes = user.enigmes_trouvees ?? 0;
  carte.hidden = false;
  carte.innerHTML = etapes + enigmes
    ? `🧭 <span>Vos découvertes</span> <strong>${etapes}</strong> étape${etapes > 1 ? 's' : ''} · <strong>${enigmes}</strong> énigme${enigmes > 1 ? 's' : ''}${user.niveau ? ` · niveau <strong>${user.niveau}</strong>` : ''}`
    : '🧭 <span>Vos découvertes</span> Votre première découverte vous attend : choisissez un parcours ou une énigme !';
}

async function chargerChasses() {
  // Explorateur sans village choisi : il n'a pas de chasses « chez lui », on l'invite à choisir.
  if (window.EST_EXPLORATEUR && !villageVisite) {
    chassesCache = [];
    document.getElementById('vue-liste-chasses').hidden = false;
    document.getElementById('vue-detail-chasse').hidden = true;
    document.getElementById('liste-chasses').innerHTML =
      '<p class="dechets-vide">Choisissez le village où vous êtes (bouton « Choisir un village » ci-dessus) pour voir ses chasses au trésor et ses énigmes photo.</p>';
    return;
  }
  const url = villageVisite
    ? `/${window.COMMUNE_SLUG}/jeux-ailleurs/${villageVisite.slug}`
    : modeArchivesChasses
      ? `/${window.COMMUNE_SLUG}/chasses-tresor?archivees=true`
      : `/${window.COMMUNE_SLUG}/chasses-tresor`;
  const res = await appelApi(url);
  if (!res.ok) return;
  const { chasses } = await res.json();
  chassesCache = chasses;
  const compte = document.getElementById('compte-chasses');
  if (compte && !modeArchivesChasses) compte.textContent = chasses.length;

  if (!modeArchivesChasses && idChasseDetailOuverte) {
    const chasse = chasses.find((c) => c.id === idChasseDetailOuverte);
    if (chasse) { renderDetailChasse(chasse); return; }
    idChasseDetailOuverte = null; // supprimée entre-temps
  }
  renderListeChasses(chasses);
}

function renderListeChasses(chasses) {
  document.getElementById('vue-liste-chasses').hidden = false;
  document.getElementById('vue-detail-chasse').hidden = true;
  const conteneur = document.getElementById('liste-chasses');
  conteneur.innerHTML = '';
  if (!chasses.length) conteneur.innerHTML = modeArchivesChasses ? '<p class="dechets-vide">Aucune chasse archivée.</p>' : messageAucunParcours();
  conteneur.querySelector('.btn-vide-creer')?.addEventListener('click', () => ouvrirModaleCreationChasse());
  conteneur.querySelector('.btn-vide-ailleurs')?.addEventListener('click', () => ouvrirRechercheVillage());
  chasses.forEach((ch) => conteneur.appendChild(
    modeArchivesChasses ? renderCarteChasseArchivee(ch) : renderCarteChasseCompacte(ch),
  ));
}

// Écran vide utile (2026-11-05) : la mairie est invitée à créer son premier parcours, un habitant à
// jouer chez un voisin en attendant, plutôt qu'un simple « Aucune chasse pour l'instant ».
function messageAucunParcours() {
  if (villageVisite) return '<p class="dechets-vide">Ce village n’a pas encore de parcours.</p>';
  if (['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
    return `<div class="vide-exploration">
      <p><strong>Aucun parcours pour l'instant.</strong> Créez le premier en quelques minutes : une balade guidée suffit, sans QR code à poser.</p>
      <button type="button" class="btn-vide-creer bouton-ouvrir-modale">+ Créer un parcours</button>
      <a href="/guide-communes#b5" target="_blank" rel="noopener">Comment faire ? (mode d’emploi)</a>
    </div>`;
  }
  return `<div class="vide-exploration">
    <p>La mairie n'a pas encore créé de parcours. En attendant, des villages voisins en proposent peut-être.</p>
    <button type="button" class="btn-vide-ailleurs filtre-categorie-btn">🧳 Voir les villages voisins</button>
  </div>`;
}

function renderCarteChasseCompacte(chasse) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'carte-chasse-compacte';
  const termine = chasse.etapes_validees >= chasse.total_etapes;
  const pct = chasse.total_etapes ? Math.round((chasse.etapes_validees / chasse.total_etapes) * 100) : 0;
  el.innerHTML = `
    <span class="type-parcours type-${chasse.mode === 'balade' ? 'balade' : 'chasse'}">${chasse.mode === 'balade' ? '🚶 Balade' : '🔎 Chasse'}</span>
    <h3>${escapeAttr(chasse.titre)}</h3>
    <div class="barre-progression-parcours"><span style="width:${pct}%"></span></div>
    <p>${chasse.etapes_validees} / ${chasse.total_etapes} étapes${termine ? ' · Terminé 🏁' : ''}</p>
  `;
  el.addEventListener('click', () => ouvrirDetailChasse(chasse.id));
  return el;
}

// Vue "archives" (gestionnaire uniquement) : une chasse retirée (actif=false) garde son
// historique de progression et son classement en base, mais n'apparaît plus dans la liste
// jouable — ici on ne peut que la réactiver, pas la rejouer depuis cette carte.
function renderCarteChasseArchivee(chasse) {
  const el = document.createElement('div');
  el.className = 'carte-chasse-compacte';
  el.innerHTML = `
    <h3>${escapeAttr(chasse.titre)}</h3>
    <button type="button" class="btn-reactiver-chasse" style="margin-top:6px;">♻️ Réactiver</button>
  `;
  el.querySelector('.btn-reactiver-chasse').addEventListener('click', async () => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasse.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre: chasse.titre, description: chasse.description ?? undefined, actif: true }),
    });
    if (res.ok) {
      afficherToastMessage('Chasse réactivée.', 'succes');
      chargerChasses();
    } else {
      afficherToastMessage('Échec de la réactivation.', 'erreur');
    }
  });
  return el;
}

function initToggleArchivesChasses() {
  const btn = document.getElementById('btn-toggle-archives-chasses');
  if (!btn) return;
  btn.addEventListener('click', () => {
    modeArchivesChasses = !modeArchivesChasses;
    btn.textContent = modeArchivesChasses ? '← Parcours actifs' : '🗄️ Archives';
    idChasseDetailOuverte = null;
    chargerChasses();
  });
}

// ── Écran de détail dédié — reste stable pendant tout le flux scan/validation,
// contrairement à l'ancien accordéon qui se refermait/réordonnait sous les pieds de
// l'utilisateur à chaque rechargement de la liste. ──

function ouvrirDetailChasse(id) {
  idChasseDetailOuverte = id;
  const chasse = chassesCache.find((c) => c.id === id);
  if (chasse) renderDetailChasse(chasse);
}

function fermerDetailChasse() {
  arreterSuiviBalade();
  document.body.classList.remove('carte-balade-plein-ecran');
  idChasseDetailOuverte = null;
  renderListeChasses(chassesCache);
}

// Guidage en direct pendant une balade (2026-11-05) : point « vous êtes ici », distance, direction
// et « température » jusqu'à la prochaine étape, bouton de validation qui s'allume dans la zone.
// Le GPS ne tourne que tant que la carte de la balade est affichée (voir arreterSuiviBalade).
let suiviPositionBalade = null;
let dernierePositionBalade = null;
// Dernier essai de validation automatique d'un point de passage : { etapeId, t }.
let dernierEssaiAuto = null;

function arreterSuiviBalade() {
  if (suiviPositionBalade != null) navigator.geolocation.clearWatch(suiviPositionBalade);
  suiviPositionBalade = null;
  dernierePositionBalade = null;
}

const DIRECTIONS_CAP = ['le nord', 'le nord-est', 'l’est', 'le sud-est', 'le sud', 'le sud-ouest', 'l’ouest', 'le nord-ouest'];

// Distance (m) et cap (degrés depuis le nord) entre deux points — même formule que lib/geo.ts.
function distanceEtCap(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  const distance = 2 * 6371000 * Math.asin(Math.sqrt(a));
  const y = Math.sin(dLng) * Math.cos(lat2 * rad);
  const x = Math.cos(lat1 * rad) * Math.sin(lat2 * rad) - Math.sin(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos(dLng);
  return { distance, cap: (Math.atan2(y, x) / rad + 360) % 360 };
}

const formaterDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`);

// « Chaud / froid » ludique, partagé avec les énigmes photo (enigmes.js).
function temperatureDistance(distance, rayon) {
  if (distance <= rayon) return { cle: 'ici', texte: '🎯 Vous y êtes' };
  if (distance <= Math.max(rayon * 2, 60)) return { cle: 'brulant', texte: '🔥 Brûlant' };
  if (distance <= 200) return { cle: 'chaud', texte: '♨️ Chaud' };
  if (distance <= 600) return { cle: 'tiede', texte: '🌤️ Tiède' };
  return { cle: 'froid', texte: '❄️ Froid' };
}

// Points de progression d'un parcours (●●○○), communs à la chasse et à la balade.
function pointsProgression(chasse) {
  const points = Array.from({ length: chasse.total_etapes }, (_, i) => `<span class="${i < chasse.etapes_validees ? 'fait' : ''}"></span>`).join('');
  return `<div class="points-progression" aria-label="${chasse.etapes_validees} étapes validées sur ${chasse.total_etapes}">${points}<em>${chasse.etapes_validees} / ${chasse.total_etapes}</em></div>`;
}

function carnetDecouvertes(chasse) {
  const liste = chasse.decouvertes || [];
  if (!liste.length) return '';
  return `
    <details class="carnet-decouvertes">
      <summary>📖 Carnet de découvertes (${liste.length})</summary>
      ${liste.map((d, i) => `<button type="button" class="ligne-carnet" data-i="${i}">${d.photo_url ? '📸' : '📜'} Étape ${d.ordre + 1} · ${escapeAttr(d.titre)}</button>`).join('')}
    </details>`;
}

function renderDetailChasse(chasse) {
  document.getElementById('vue-liste-chasses').hidden = true;
  const zone = document.getElementById('vue-detail-chasse');
  zone.hidden = false;
  // On repart d'une carte neuve à chaque rendu (le conteneur est recréé par innerHTML).
  arreterSuiviBalade();
  if (carteBalade) { carteBalade.remove(); carteBalade = null; }
  document.body.classList.remove('carte-balade-plein-ecran');

  const termine = chasse.etapes_validees >= chasse.total_etapes;
  const estGestionnaireChasse = !villageVisite && ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);
  const estBalade = chasse.mode === 'balade';

  const controlesChasse = termine ? '' : `
    <button class="btn-scanner">📷 Scanner le QR code de l'étape</button>
    <div id="zone-scanner"></div>
    <details class="code-manuel">
      <summary>Problème de scan ?</summary>
      <form id="form-code-manuel"><input placeholder="Code écrit sous le QR code"><button>Valider</button></form>
    </details>
  `;
  const controlesBalade = `
    ${termine ? '' : '<div class="guidage-balade" id="guidage-balade" data-etat="attente">📍 Autorisez la localisation pour être guidé jusqu’à la prochaine étape.</div>'}
    <div class="cadre-carte-balade" id="cadre-carte-balade">
      <div id="carte-balade"></div>
      <div class="boutons-carte-balade">
        ${termine ? '' : '<button type="button" class="btn-carte-balade" id="btn-recentrer-balade" title="Me localiser" aria-label="Me localiser">📍</button>'}
        <button type="button" class="btn-carte-balade" id="btn-plein-ecran-balade" title="Plein écran" aria-label="Plein écran">⛶</button>
      </div>
    </div>
    ${!termine && chasse.etape_suivante ? '<button class="btn-arrive">📍 Je suis arrivé à cette étape</button>' : ''}
  `;

  zone.innerHTML = `
    <button type="button" class="btn-retour-detail">← Retour aux parcours</button>
    <span class="type-parcours type-${estBalade ? 'balade' : 'chasse'}">${estBalade ? '🚶 Balade guidée' : '🔎 Chasse au trésor'}</span>
    <h3>${escapeAttr(chasse.titre)}</h3>
    ${chasse.description ? `<p>${texteAvecLiensCliquables(chasse.description)}</p>` : ''}
    ${pointsProgression(chasse)}
    ${!termine && chasse.etape_suivante ? `<p class="indice-etape">${estBalade ? 'Prochaine étape' : 'Indice'} : ${escapeAttr(chasse.etape_suivante.indice)}</p>` : ''}
    ${termine ? `<div class="fin-parcours">🏁 <strong>Parcours terminé !</strong> Vous avez découvert ${chasse.total_etapes > 1 ? `les ${chasse.total_etapes} étapes` : 'l’étape'} de « ${escapeAttr(chasse.titre)} ».</div>` : ''}
    ${estBalade ? controlesBalade : controlesChasse}
    ${carnetDecouvertes(chasse)}
    <button type="button" class="btn-classement-chasse" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);margin-top:10px;">🏆 Classement de ce parcours</button>
    <div id="zone-classement" hidden></div>
    ${estGestionnaireChasse ? `
      <div class="actions-admin" style="margin-top:12px;">
        <button class="btn-modifier-chasse">✏️ Modifier</button>
        ${estBalade ? '' : '<button class="btn-voir-qr">Voir les QR codes</button>'}
        <button class="btn-archiver-chasse">📥 Archiver</button>
        <button class="btn-supprimer-chasse">Supprimer la chasse</button>
      </div>
      <div class="liste-qr-etapes"></div>
    ` : ''}
  `;

  zone.querySelector('.btn-retour-detail').addEventListener('click', () => fermerDetailChasse());
  zone.querySelector('.btn-scanner')?.addEventListener('click', () => ouvrirScanner());
  zone.querySelector('.btn-arrive')?.addEventListener('click', (e) => validerEtapePosition(chasse.etape_suivante.id, null, e.currentTarget));
  zone.querySelectorAll('.ligne-carnet').forEach((b) => b.addEventListener('click', () => afficherContenuRevele(chasse.decouvertes[b.dataset.i])));
  zone.querySelector('.btn-classement-chasse').addEventListener('click', async () => {
    const zoneClassement = document.getElementById('zone-classement');
    zoneClassement.hidden = !zoneClassement.hidden;
    if (!zoneClassement.hidden) await afficherClassement(chasse.id);
  });
  zone.querySelector('.btn-voir-qr')?.addEventListener('click', () => afficherQrEtapes(chasse.id, zone));
  zone.querySelector('.btn-modifier-chasse')?.addEventListener('click', () => ouvrirModaleEditionChasse(chasse));
  zone.querySelector('.btn-archiver-chasse')?.addEventListener('click', async () => {
    if (!confirm('Retirer cette chasse de la liste ? Son historique et son classement restent conservés, tu pourras la réactiver depuis "Voir les chasses archivées".')) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasse.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre: chasse.titre, description: chasse.description ?? undefined, actif: false }),
    });
    if (!res.ok) { afficherToastMessage('Échec de l’archivage.', 'erreur'); return; }
    idChasseDetailOuverte = null;
    chargerChasses();
    afficherToastMessage('Chasse archivée.', 'succes');
  });
  zone.querySelector('.btn-supprimer-chasse')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette chasse et toutes ses étapes ?')) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasse.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      afficherToastMessage(data.erreur || 'Échec de la suppression.', 'erreur');
      return;
    }
    idChasseDetailOuverte = null;
    chargerChasses();
  });
  zone.querySelector('#form-code-manuel')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = e.target.querySelector('input').value.trim();
    if (code) await validerEtape(code);
    e.target.reset();
  });

  if (estBalade) initCarteBalade(chasse, termine);
}

// Carte de la balade : étapes numérotées (validée / prochaine / à venir), chemin parcouru en trait
// plein et reste en pointillés, zone de validation de la prochaine étape, et position du joueur.
function initCarteBalade(chasse, termine) {
  const etapes = [...(chasse.etapes || [])].sort((a, b) => a.ordre - b.ordre);
  if (!etapes.length) return;

  carteBalade = L.map('carte-balade', { maxZoom: 20 });
  L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 20 },
  ).addTo(carteBalade);

  const prochaine = etapes.find((e) => e.id === chasse.etape_suivante?.id) || null;
  const points = etapes.map((e) => [e.lat, e.lng]);
  const nbFaites = etapes.filter((e) => e.validee).length;
  // Chemin déjà parcouru (jusqu'à la prochaine étape incluse) en plein, la suite en pointillés.
  if (nbFaites) L.polyline(points.slice(0, nbFaites + 1), { color: '#4CAF50', weight: 4, opacity: 0.8 }).addTo(carteBalade);
  if (nbFaites < points.length) L.polyline(points.slice(Math.max(nbFaites, 0)), { color: '#2C7BE5', weight: 3, opacity: 0.55, dashArray: '6 6' }).addTo(carteBalade);
  if (prochaine) L.circle([prochaine.lat, prochaine.lng], { radius: chasse.rayon_metres || 50, color: '#2C7BE5', weight: 1, fillOpacity: 0.08 }).addTo(carteBalade);

  etapes.forEach((e) => {
    const etat = e.validee ? 'validee' : (prochaine && e.id === prochaine.id ? 'prochaine' : 'avenir');
    const libelle = { validee: '✅ validée', prochaine: '➡️ prochaine étape', avenir: '🔒 à venir' }[etat];
    // Point de passage : petit rond discret ; étape à découvrir : grande pastille numérotée.
    const passage = e.type_contenu === 'aucun';
    const taille = passage ? 16 : 30;
    L.marker([e.lat, e.lng], {
      icon: L.divIcon({ className: '', html: `<span class="pastille-balade etat-${etat}${passage ? ' passage' : ''}">${passage ? '' : (e.validee ? '✓' : e.ordre + 1)}</span>`, iconSize: [taille, taille], iconAnchor: [taille / 2, taille / 2] }),
      zIndexOffset: etat === 'prochaine' ? 1000 : 0,
    }).addTo(carteBalade).bindPopup(`<strong>${passage ? '🚩 Point de passage' : `Étape ${e.ordre + 1}`} — ${escapeAttr(e.titre)}</strong><br>${libelle}`);
  });
  carteBalade.fitBounds(points, { padding: [30, 30], maxZoom: 17 });
  setTimeout(() => carteBalade && carteBalade.invalidateSize(), 150);

  let marqueurVous = null;
  let halo = null;
  const guidage = document.getElementById('guidage-balade');
  const bouton = document.querySelector('#vue-detail-chasse .btn-arrive');
  const rayon = chasse.rayon_metres || 50;
  const prochainEstPassage = prochaine?.type_contenu === 'aucun';
  const consigne = consigneEnCours?.chasseId === chasse.id ? consigneEnCours.texte : '';
  if (guidage && consigne) guidage.innerHTML = `<span class="consigne-balade">🚩 ${escapeAttr(consigne)}</span>`;

  const majPosition = (pos) => {
    // Plus de carte à l'écran (autre parcours, autre onglet) : on coupe le GPS.
    if (!document.getElementById('carte-balade') || document.getElementById('onglet-chasse-tresor')?.hidden) { arreterSuiviBalade(); return; }
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    dernierePositionBalade = { lat, lng, precision: accuracy, t: Date.now() };
    if (!marqueurVous) {
      halo = L.circle([lat, lng], { radius: accuracy, color: '#1a73e8', weight: 0, fillOpacity: 0.12, interactive: false }).addTo(carteBalade);
      marqueurVous = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<span class="point-vous"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 2000, interactive: false }).addTo(carteBalade);
    } else {
      marqueurVous.setLatLng([lat, lng]);
      halo.setLatLng([lat, lng]).setRadius(accuracy);
    }
    if (!prochaine || !guidage) return;
    const { distance, cap } = distanceEtCap(lat, lng, prochaine.lat, prochaine.lng);
    const temp = temperatureDistance(distance, rayon);
    guidage.dataset.etat = temp.cle;
    guidage.innerHTML = `
      ${consigne ? `<span class="consigne-balade">🚩 ${escapeAttr(consigne)}</span>` : ''}
      <strong>${prochainEstPassage ? '🚩 Point de passage' : `➡️ Étape ${prochaine.ordre + 1}`} · ${escapeAttr(prochaine.titre)}</strong>
      <span>${temp.cle === 'ici' ? 'Vous êtes dans la zone de l’étape' : `${formaterDistance(distance)} · vers ${DIRECTIONS_CAP[Math.round(cap / 45) % 8]}`}</span>
      <span class="temperature">${temp.texte}</span>`;
    // Point de passage atteint : validé tout seul, le marcheur n'a pas à s'arrêter. Le serveur
    // revérifie la position ; s'il refuse (GPS imprécis, réseau…), nouvel essai 20 s plus tard au plus tôt.
    const essaiRecent = dernierEssaiAuto?.etapeId === prochaine.id && Date.now() - dernierEssaiAuto.t < 20000;
    if (prochainEstPassage && temp.cle === 'ici' && bouton && !bouton.disabled && !essaiRecent) {
      dernierEssaiAuto = { etapeId: prochaine.id, t: Date.now() };
      validerEtapePosition(prochaine.id, null, bouton);
      return;
    }
    if (bouton && !bouton.disabled) {
      bouton.classList.toggle('pret', temp.cle === 'ici');
      bouton.textContent = temp.cle === 'ici' ? '🎉 Vous y êtes ! Valider l’étape' : `📍 Je suis arrivé (encore ~${formaterDistance(distance)})`;
    }
  };
  const demarrerSuivi = () => {
    if (termine || !navigator.geolocation || suiviPositionBalade != null) return;
    suiviPositionBalade = navigator.geolocation.watchPosition(majPosition, (err) => {
      if (guidage && err.code === err.PERMISSION_DENIED) {
        guidage.dataset.etat = 'attente';
        guidage.textContent = '📍 Localisation refusée : autorisez-la dans les réglages du navigateur pour être guidé.';
      }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  };
  demarrerSuivi();

  document.getElementById('btn-recentrer-balade')?.addEventListener('click', () => {
    demarrerSuivi();
    if (!dernierePositionBalade) { afficherToastMessage('Recherche de votre position…', 'info'); return; }
    const cible = [[dernierePositionBalade.lat, dernierePositionBalade.lng]];
    if (prochaine) cible.push([prochaine.lat, prochaine.lng]);
    carteBalade.fitBounds(cible, { padding: [50, 50], maxZoom: 18 });
  });
  document.getElementById('btn-plein-ecran-balade').addEventListener('click', (e) => {
    const plein = document.getElementById('cadre-carte-balade').classList.toggle('plein-ecran');
    document.body.classList.toggle('carte-balade-plein-ecran', plein);
    e.currentTarget.textContent = plein ? '✕' : '⛶';
    e.currentTarget.title = plein ? 'Réduire la carte' : 'Plein écran';
    setTimeout(() => carteBalade && carteBalade.invalidateSize(), 120);
  });
}

// Consigne du dernier point de passage franchi, gardée dans le bandeau de guidage jusqu'au point
// suivant (« Prenez le sentier à gauche… ») : { chasseId, texte }.
let consigneEnCours = null;

// Message après une validation réussie : point de passage (sans points, consigne éventuelle) ou étape.
function annoncerValidation(data, lieu = '') {
  if (data.point_de_passage) {
    const consigne = data.contenu_revele?.type === 'consigne' ? data.contenu_revele.texte : '';
    consigneEnCours = consigne ? { chasseId: idChasseDetailOuverte, texte: consigne } : null;
    afficherToastMessage(consigne ? `🚩 ${consigne}` : '🚩 Point de passage franchi, continuez !', 'succes');
  } else {
    consigneEnCours = null;
    afficherToastMessage(lieu ? `Étape validée à ${lieu} ! 🎉` : 'Étape validée ! 🎉', 'succes');
    if (data.contenu_revele) afficherContenuRevele(data.contenu_revele);
  }
  traiterRecompense(data);
}

// Après une validation réussie : recharge le parcours et salue sa complétion.
async function rechargerApresValidation() {
  const avant = chassesCache.find((c) => c.id === idChasseDetailOuverte);
  await chargerChasses();
  chargerProgressionExploration();
  const apres = chassesCache.find((c) => c.id === idChasseDetailOuverte);
  if (avant && apres && avant.etapes_validees < avant.total_etapes && apres.etapes_validees >= apres.total_etapes) {
    afficherToastMessage(`🏁 Parcours « ${apres.titre} » terminé, bravo !`, 'succes');
  }
}

// Validation d'une étape de balade par proximité GPS. bouton (optionnel) : retour visuel de
// précision GPS pendant l'attente, si l'appelant en a un sous la main (voir obtenirPositionPrecise).
function validerEtapePosition(etape_id, reponse = null, bouton = null) {
  if (!navigator.geolocation) {
    afficherToastMessage('GPS indisponible sur cet appareil.', 'erreur');
    return;
  }
  const texteBoutonInitial = bouton?.textContent;
  if (bouton) bouton.disabled = true;

  // Balade suivie en direct : on reprend la position toute fraîche du suivi (moins de 15 s, précise
  // à 50 m) plutôt que de relancer une seconde lecture GPS — plus rapide pour le marcheur.
  const suivie = dernierePositionBalade && Date.now() - dernierePositionBalade.t < 15000 && dernierePositionBalade.precision <= 50
    ? Promise.resolve({ coords: { latitude: dernierePositionBalade.lat, longitude: dernierePositionBalade.lng } })
    : null;
  (suivie || obtenirPositionPrecise((precision) => {
    if (bouton) bouton.textContent = `Précision : ±${Math.round(precision)} m…`;
  })).then(async (pos) => {
    const res = await appelApi(urlJeux('chasses-tresor', '/valider-position'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        etape_id, lat: pos.coords.latitude, lng: pos.coords.longitude,
        ...(reponse != null ? { reponse } : {}),
      }),
    });
    const data = await res.json();

    if (res.ok && data.reussi === false) {
      afficherToastMessage(`Pas encore : environ ${formaterDistance(data.distance_metres)} (${temperatureDistance(data.distance_metres, 0).texte}). Rapprochez-vous du point.`, 'erreur');
      return;
    }
    if (res.ok && data.etape_enigme) { afficherEnigmeEtapePosition(etape_id, data.question); return; }
    if (!res.ok) { afficherToastMessage(data.erreur || 'Erreur', 'erreur'); return; }
    annoncerValidation(data);
    rechargerApresValidation();
  }).catch(() => {
    afficherToastMessage('Localisation refusée ou indisponible.', 'erreur');
  }).finally(() => {
    if (bouton) { bouton.disabled = false; bouton.textContent = texteBoutonInitial; }
  });
}

function afficherEnigmeEtapePosition(etape_id, question) {
  const html = `
    <form id="form-enigme-balade">
      <p class="indice-etape">${escapeAttr(question)}</p>
      <input type="text" id="reponse-enigme-balade" placeholder="Ta réponse" maxlength="200" required>
      <button type="submit" style="margin-top:10px;">Valider ma réponse</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('🧩 Énigme', html);
  overlay.querySelector('#form-enigme-balade').addEventListener('submit', (e) => {
    e.preventDefault();
    const reponse = overlay.querySelector('#reponse-enigme-balade').value.trim();
    if (!reponse) return;
    fermerModaleFormulaire(overlay);
    validerEtapePosition(etape_id, reponse);
  });
}

async function afficherQrEtapes(chasseId, zone) {
  const zoneQr = zone.querySelector('.liste-qr-etapes');
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasseId}/etapes`);
  if (!res.ok) { zoneQr.innerHTML = `<p class="dechets-vide">Impossible de charger les étapes.</p>`; return; }
  const { etapes } = await res.json();

  zoneQr.innerHTML = etapes.map((e) => `
    <div class="ligne-toggle-onglet">
      <span>Étape ${e.ordre + 1} — ${escapeAttr(e.titre)}</span>
      <a href="${window.API_BASE}/${window.COMMUNE_SLUG}/chasses-tresor/${chasseId}/etapes/${e.id}/qr-page" target="_blank">Voir le QR à imprimer</a>
    </div>
  `).join('');
}

async function ouvrirScanner() {
  await demarrerScannerQr('zone-scanner', validerEtape);
}

// Le serveur exige la position du joueur pour valider un QR (le QR seul ne suffit plus : voir
// erreurDistanceQr côté Worker, tolérance de 200 m). Précision de 100 m suffisante ici, pour ne
// pas faire attendre. null = localisation refusée ou indisponible (message déjà affiché).
async function positionPourQr() {
  try {
    const pos = await obtenirPositionPrecise(null, 6000, 100);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    afficherToastMessage('Activez la localisation : les étapes se valident sur place.', 'erreur');
    return null;
  }
}

function envoyerQrEtape(url, qr_token, reponse, position) {
  return appelApi(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qr_token, ...position, ...(reponse != null ? { reponse } : {}) }),
  });
}

// En visite, un QR se valide par la route « ailleurs » (la commune est retrouvée à partir du QR).
// Chez soi, un QR inconnu y est retenté : c'est peut-être l'étape d'une chasse d'un autre
// village, scannée sur place — ça marche alors sans rien choisir.
async function validerEtape(qr_token, reponse = null) {
  const position = await positionPourQr();
  if (!position) return;
  const urlAilleurs = `/${window.COMMUNE_SLUG}/jeux-ailleurs/valider-qr`;
  let url = villageVisite || window.EST_EXPLORATEUR ? urlAilleurs : `/${window.COMMUNE_SLUG}/chasses-tresor/valider`;
  let res = await envoyerQrEtape(url, qr_token, reponse, position);
  if (res.status === 404 && url !== urlAilleurs) {
    const resAilleurs = await envoyerQrEtape(urlAilleurs, qr_token, reponse, position);
    if (resAilleurs.status !== 404) { res = resAilleurs; url = urlAilleurs; }
  }
  const data = await res.json();

  // Étape énigme : le serveur renvoie la question sans valider → on demande la réponse.
  if (res.ok && data.etape_enigme) {
    afficherEnigmeEtape(qr_token, data.question, url);
    return;
  }

  if (res.ok) {
    annoncerValidation(data, data.commune_nom || '');
  } else {
    afficherToastMessage(data.erreur || 'Erreur', 'erreur');
  }
  rechargerApresValidation(); // l'écran de détail reste ouvert (idChasseDetailOuverte inchangé), juste rafraîchi
}

// Modale d'énigme : la réponse est vérifiée côté serveur ; on garde la modale ouverte
// tant que la réponse est fausse pour permettre de réessayer.
function afficherEnigmeEtape(qr_token, question, url) {
  const html = `
    <form id="form-enigme-etape">
      <p class="indice-etape">${escapeAttr(question)}</p>
      <input type="text" id="reponse-enigme-etape" placeholder="Ta réponse" maxlength="200" required>
      <button type="submit" style="margin-top:10px;">Valider ma réponse</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('🧩 Énigme', html);
  overlay.querySelector('#form-enigme-etape').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reponse = overlay.querySelector('#reponse-enigme-etape').value.trim();
    if (!reponse) return;
    // Position relue à la réponse aussi : le serveur la revérifie (même règle qu'en balade).
    const position = await positionPourQr();
    if (!position) return;
    const res = await envoyerQrEtape(url, qr_token, reponse, position);
    const data = await res.json();
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      afficherToastMessage('Bonne réponse ! Étape validée 🎉', 'succes');
      if (data.contenu_revele) afficherContenuRevele(data.contenu_revele);
      traiterRecompense(data);
      rechargerApresValidation();
    } else {
      afficherToastMessage(data.erreur || 'Mauvaise réponse', 'erreur');
    }
  });
}

// Révèle le contenu d'une étape validée (texte descriptif ou photo).
function afficherContenuRevele(contenu) {
  const photo = contenu.photo_url ? `<img src="${contenu.photo_url}" alt="" style="width:100%;border-radius:12px;margin-bottom:10px;display:block;">` : '';
  const texte = contenu.texte ? `<p>${texteAvecLiensCliquables(contenu.texte)}</p>` : '';
  if (!photo && !texte) return;
  ouvrirModaleFormulaire(contenu.titre ? `📖 ${escapeAttr(contenu.titre)}` : '📖 Découverte', photo + texte);
}

async function afficherClassement(chasseId) {
  const zone = document.getElementById('zone-classement');
  zone.innerHTML = `<p class="dechets-vide">Chargement…</p>`;
  const res = await appelApi(urlJeux('chasses-tresor', `/${chasseId}/classement`));
  if (!res.ok) { zone.innerHTML = `<p class="dechets-vide">Classement indisponible pour le moment.</p>`; return; }
  const { classement } = await res.json();

  if (!classement.length) {
    zone.innerHTML = `<p class="dechets-vide">Personne n'a encore validé d'étape sur cette chasse.</p>`;
    return;
  }

  zone.innerHTML = classement.map((c, i) => `<p>${i + 1}. ${escapeAttr(c.prenom)} — ${c.total_etapes} étapes</p>`).join('');
}

// ── Chasse au trésor : bouton classement (chasses officielles + énigmes photo affichées
// ensemble sur le même écran, plus de bascule entre sous-onglets) ──

function initSousOngletsChasse() {
  document.getElementById('btn-classement-exploration')?.addEventListener('click', async () => {
    const zone = document.getElementById('zone-classement-exploration');
    zone.hidden = !zone.hidden;
    if (!zone.hidden) await chargerClassementExploration();
  });
  document.getElementById('btn-jouer-ailleurs')?.addEventListener('click', () => ouvrirRechercheVillage());
  if (window.EST_EXPLORATEUR) {
    const bandeau = document.querySelector('#onglet-chasse-tresor > .bandeau-onglet');
    bandeau.querySelector('h3').textContent = 'Jeux des villages';
    bandeau.querySelector('p').textContent = 'Chasses au trésor et énigmes photo pour découvrir les villages et leur patrimoine : choisissez le village où vous êtes, puis jouez sur place.';
    document.getElementById('btn-jouer-ailleurs').textContent = '🧭 Choisir un village';
  }
  initJumpNavChasse();
  initScrollSpyChasse();
}

// ── Jouer dans un autre village : recherche, entrée, sortie ──

// Villages avec des jeux (GET /jeux-ailleurs/communes) : seulement ceux qui ont au moins une
// chasse ou une énigme active, triés par distance depuis la position du joueur (sinon le centre de
// sa commune). Filtre de distance, recherche par nom et carte se font ici, sur cette liste courte.
const DISTANCES_VILLAGES = [10, 30, 100, null]; // null = tout

// Nom comparable sans accents, tirets ni majuscules (« fontaine sur somme » = « Fontaine-sur-Somme »).
const nomComparable = (texte) => (texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();

async function positionDeReference() {
  try {
    // Précision grossière suffisante (quelques km) : réponse quasi immédiate, sans attendre le GPS.
    const pos = await obtenirPositionPrecise(null, 4000, 3000);
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    if (!window.EST_EXPLORATEUR && !window.COMMUNE_COORDS_MANQUANTES && window.COMMUNE_LAT != null) {
      return { lat: window.COMMUNE_LAT, lng: window.COMMUNE_LNG };
    }
    return null;
  }
}

function ouvrirRechercheVillage() {
  const overlay = ouvrirModaleFormulaire(window.EST_EXPLORATEUR ? '🧭 Choisir un village' : '🧳 Jouer dans un autre village', `
    <p style="font-size:12.5px;color:var(--roseau);margin-top:0;">Villages qui proposent des chasses au trésor ou des énigmes photo. Elles se valident sur place.</p>
    <div id="filtres-distance-villages" class="filtres-categorie-articles" hidden></div>
    <button type="button" id="btn-carte-villages" class="btn-classement-exploration" style="margin-top:0;">🗺 Voir sur la carte</button>
    <div id="carte-villages" class="mini-carte-position" style="height:260px;" hidden></div>
    <div id="resultats-village" style="margin-top:10px;"><p class="dechets-vide">Recherche des villages…</p></div>
    <form id="form-recherche-village" style="margin-top:12px;">
      <input type="text" id="recherche-village" placeholder="Un village précis ? Tapez son nom" autocomplete="off" enterkeyhint="search">
    </form>
  `);
  const resultats = overlay.querySelector('#resultats-village');
  const champ = overlay.querySelector('#recherche-village');
  const zoneFiltres = overlay.querySelector('#filtres-distance-villages');
  const zoneCarte = overlay.querySelector('#carte-villages');
  let villages = [];
  let distanceMax = 30;
  let carte = null;
  let marqueurs = null;

  overlay.querySelector('#form-recherche-village').addEventListener('submit', (e) => e.preventDefault());

  const visibles = () => {
    const recherche = nomComparable(champ.value);
    return villages.filter((v) => (!recherche || nomComparable(v.nom).includes(recherche))
      // Un village sans coordonnées connues reste listé : on ne sait pas l'écarter par distance.
      && (recherche || distanceMax == null || v.distance_km == null || v.distance_km <= distanceMax));
  };
  const jeux = (v) => [
    v.nb_chasses && `${v.nb_chasses} chasse${v.nb_chasses > 1 ? 's' : ''}`,
    v.nb_enigmes && `${v.nb_enigmes} énigme${v.nb_enigmes > 1 ? 's' : ''}`,
  ].filter(Boolean).join(' · ');
  const choisir = async (slug) => { if (await entrerDansVillage(slug)) fermerModaleFormulaire(overlay); };

  const dessinerCarte = (liste) => {
    marqueurs.clearLayers();
    const points = liste.filter((v) => v.lat != null);
    points.forEach((v) => {
      const popup = document.createElement('div');
      popup.innerHTML = `<strong>${escapeAttr(v.nom)}</strong><br><span style="font-size:12px;">${escapeAttr(jeux(v))}</span><br>`;
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.textContent = 'Jouer ici';
      bouton.style.cssText = 'margin-top:6px;padding:6px 12px;';
      bouton.addEventListener('click', () => choisir(v.slug));
      popup.appendChild(bouton);
      L.marker([v.lat, v.lng]).bindPopup(popup).addTo(marqueurs);
    });
    if (points.length) carte.fitBounds(points.map((v) => [v.lat, v.lng]), { padding: [30, 30], maxZoom: 12 });
  };

  const afficher = () => {
    const liste = visibles();
    if (!villages.length) {
      resultats.innerHTML = '<p class="dechets-vide">Aucun village ne propose encore de chasse ou d’énigme. Revenez bientôt !</p>';
    } else if (!liste.length) {
      resultats.innerHTML = `<p class="dechets-vide">${champ.value.trim() ? 'Aucun village avec des jeux ne porte ce nom.' : 'Pas de jeux dans ce rayon : élargissez la distance.'}</p>`;
    } else {
      resultats.innerHTML = liste.map((v) => `
        <button type="button" class="ligne-toggle-onglet btn-choisir-village" data-slug="${escapeAttr(v.slug)}" style="width:100%;text-align:left;background:none;cursor:pointer;display:flex;justify-content:space-between;gap:8px;">
          <span><strong>${escapeAttr(v.nom)}</strong><br><span style="font-size:12px;color:var(--roseau);">${escapeAttr(jeux(v))}</span></span>
          <span style="color:var(--roseau);white-space:nowrap;">${v.distance_km != null ? `${v.distance_km.toLocaleString('fr-FR')} km` : escapeAttr(v.departement || '')}</span>
        </button>`).join('');
      resultats.querySelectorAll('.btn-choisir-village').forEach((b) => b.addEventListener('click', () => choisir(b.dataset.slug)));
    }
    if (carte) dessinerCarte(liste);
  };

  overlay.querySelector('#btn-carte-villages').addEventListener('click', (e) => {
    zoneCarte.hidden = !zoneCarte.hidden;
    e.currentTarget.textContent = zoneCarte.hidden ? '🗺 Voir sur la carte' : '☰ Masquer la carte';
    if (zoneCarte.hidden) return;
    if (!carte) {
      carte = L.map(zoneCarte, { maxZoom: 18 }).setView([46.6, 2.4], 5);
      L.tileLayer(
        'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
        { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 18 },
      ).addTo(carte);
      marqueurs = L.layerGroup().addTo(carte);
    }
    // Leaflet a besoin de connaître la taille réelle du conteneur une fois visible (même piège qu'agenda.js).
    setTimeout(() => { carte.invalidateSize(); dessinerCarte(visibles()); }, 80);
  });

  let minuterie = null;
  champ.addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(afficher, 150); });

  (async () => {
    const position = await positionDeReference();
    const params = position ? `?lat=${position.lat}&lng=${position.lng}` : '';
    const res = await appelApi(`/${window.COMMUNE_SLUG}/jeux-ailleurs/communes${params}`).catch(() => null);
    if (!res?.ok) { resultats.innerHTML = '<p class="dechets-vide">Liste indisponible, réessayez dans un instant.</p>'; return; }
    villages = (await res.json()).communes;
    if (position) {
      // Rayon par défaut : le plus petit qui contient au moins un village (sinon « Tout »).
      distanceMax = DISTANCES_VILLAGES.find((d) => d == null || villages.some((v) => v.distance_km != null && v.distance_km <= d));
      zoneFiltres.hidden = false;
      zoneFiltres.innerHTML = DISTANCES_VILLAGES.map((d) => `<button type="button" class="filtre-categorie-btn${d === distanceMax ? ' active' : ''}" data-km="${d ?? ''}">${d == null ? 'Tout' : `${d} km`}</button>`).join('');
      zoneFiltres.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        distanceMax = b.dataset.km ? Number(b.dataset.km) : null;
        zoneFiltres.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        afficher();
      }));
    } else {
      distanceMax = null;
    }
    afficher();
  })();
}

async function entrerDansVillage(slug) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/jeux-ailleurs/${encodeURIComponent(slug)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { afficherToastMessage(data.erreur || 'Ce village n’est pas accessible.', 'erreur'); return false; }
  villageVisite = { ...data.commune, mon_nom_public: data.mon_nom_public };
  idChasseDetailOuverte = null;
  idEnigmeDetailOuverte = null;
  modeArchivesChasses = false;
  appliquerModeVillage();
  chargerChasses();
  chargerEnigmes();
  return true;
}

function quitterVillage() {
  villageVisite = null;
  idChasseDetailOuverte = null;
  idEnigmeDetailOuverte = null;
  appliquerModeVillage();
  chargerChasses();
  chargerEnigmes();
}

function appliquerModeVillage() {
  document.getElementById('onglet-chasse-tresor')?.classList.toggle('en-visite', !!villageVisite);
  document.getElementById('zone-classement-exploration').hidden = true;
  const bandeau = document.getElementById('bandeau-village-visite');
  if (!bandeau) return;
  bandeau.hidden = !villageVisite;
  if (!villageVisite) { bandeau.innerHTML = ''; return; }
  bandeau.innerHTML = `
    <p style="margin:0 0 6px;">🧳 Vous jouez à <strong>${escapeAttr(villageVisite.nom)}</strong>.</p>
    <p style="margin:0 0 10px;font-size:12px;color:var(--roseau);">Dans ses classements, vous apparaissez comme « ${escapeAttr(villageVisite.mon_nom_public)} » — modifiable dans Profil → Confidentialité. Vos points s'ajoutent à votre compte.</p>
    <button type="button" class="btn-classement-exploration" id="btn-quitter-village" style="margin:0;">${window.EST_EXPLORATEUR ? '🧭 Changer de village' : '← Revenir à mon village'}</button>
  `;
  // Un Explorateur n'a pas de village à lui : il change de village au lieu de « rentrer ».
  bandeau.querySelector('#btn-quitter-village').addEventListener('click', () => (window.EST_EXPLORATEUR ? ouvrirRechercheVillage() : quitterVillage()));
}

// Puces de raccourci "Chasses officielles" / "Énigme photo" : des <button> + scrollIntoView(),
// pas des <a href="#..."> — un <a> vers une ancre a déjà provoqué une navigation complète au
// lieu d'un simple défilement sur PWA installée (l'app repartait sur l'onglet Accueil). Même
// pattern que le deep-link de notification vers ces mêmes sections, voir notifications.js.
function initJumpNavChasse() {
  document.querySelectorAll('.chasse-jump-chip[data-cible]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.cible)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// Indicateur "section active" sur la nav de raccourcis : les deux sections (chasses officielles
// + énigme photo) sont désormais affichées ensemble sur un même écran défilant plutôt que
// derrière des onglets, donc rien ne montre plus laquelle des deux est sous les yeux une fois
// qu'on a scrollé — une bande d'activation au centre du viewport tranche entre les deux en-têtes.
function initScrollSpyChasse() {
  const chips = {
    'section-chasses-officielles': document.querySelector('.chasse-jump-chip[data-cible="section-chasses-officielles"]'),
    'section-trouve-la-photo': document.querySelector('.chasse-jump-chip[data-cible="section-trouve-la-photo"]'),
  };
  const cibles = Object.keys(chips).map((id) => document.getElementById(id)).filter(Boolean);
  if (!cibles.length || !('IntersectionObserver' in window)) return;

  const observateur = new IntersectionObserver((entrees) => {
    entrees.forEach((entree) => {
      if (entree.isIntersecting) {
        Object.values(chips).forEach((chip) => chip?.classList.remove('active'));
        chips[entree.target.id]?.classList.add('active');
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

  cibles.forEach((el) => observateur.observe(el));
}

// Classement unifié : combine étapes de chasse validées + énigmes trouvées (score additionné).
async function chargerClassementExploration() {
  const zone = document.getElementById('zone-classement-exploration');
  zone.innerHTML = `<p class="dechets-vide">Chargement…</p>`;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/classement-exploration`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { classement } = await res.json();

  if (!classement.length) {
    zone.innerHTML = `<p class="dechets-vide">Personne n'a encore de score d'exploration.</p>`;
    return;
  }

  zone.innerHTML = classement.map((c, i) => `
    <div class="ligne-toggle-onglet">
      <span>${i + 1}. ${escapeAttr(c.prenom)}</span>
      <span style="font-family:'DM Mono',monospace;font-size:12px;">${c.score} pts (🗺️${c.etapes} · 🧭${c.enigmes})</span>
    </div>
  `).join('');
}

// ── Formulaire de création (admin/superadmin) ──

function initFormulaireChasse() {
  const btn = document.getElementById('btn-ouvrir-creation-chasse');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationChasse());
}

function ouvrirModaleCreationChasse() {
  const html = `
    <form id="form-modale-chasse">
      <input type="text" id="titre-chasse-modale" placeholder="Titre de la chasse" maxlength="150" required>
      <textarea id="description-chasse-modale" placeholder="Description"></textarea>
      <label style="display:block;margin:8px 0 4px;font-size:13px;color:var(--roseau);">Type</label>
      <select id="mode-chasse-modale">
        <option value="chasse">Chasse au trésor (QR à scanner sur place)</option>
        <option value="balade">Balade guidée (carte + validation GPS)</option>
      </select>
      <div id="ligne-rayon-balade" style="display:none;margin-top:8px;">
        <label style="display:block;margin-bottom:4px;font-size:13px;color:var(--roseau);">Rayon de validation autour de chaque point (mètres)</label>
        <input type="number" id="rayon-chasse-modale" value="50" min="20" max="500">
      </div>
      <label style="display:block;margin:8px 0 4px;font-size:13px;color:var(--roseau);">📍 Emplacement des étapes</label>
      <p style="font-size:12px;color:var(--roseau);margin-bottom:4px;">Clique sur la carte pour placer chaque étape — pas besoin d'être sur place. Fais glisser un repère pour l'ajuster.</p>
      <div id="carte-creation-chasse" class="mini-carte-position"></div>
      <div id="liste-etapes-chasse-modale"></div>
      <button type="button" id="btn-ajouter-etape-modale" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);">+ Ajouter une étape</button>
      <button type="submit" style="margin-top:12px;">Créer la chasse</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Créer une chasse au trésor', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  compteurEtapes = 0;

  corps.querySelector('#mode-chasse-modale').addEventListener('change', (e) => {
    corps.querySelector('#ligne-rayon-balade').style.display = e.target.value === 'balade' ? 'block' : 'none';
  });

  initCarteCreationChasse(corps);
  corps.querySelector('#btn-ajouter-etape-modale').addEventListener('click', () => ajouterLigneEtape(corps));
  ajouterLigneEtape(corps);

  corps.querySelector('#form-modale-chasse').addEventListener('submit', async (e) => {
    e.preventDefault();
    await soumettreChasse(corps, overlay);
  });
}

// Carte partagée de la modale (création ou édition) : un repère numéroté par étape, posé au
// clic (pas besoin d'être sur place) et déplaçable à la souris pour affiner. Voir
// definirPositionEtape pour la synchronisation avec les champs lat/lng de chaque ligne.
function initCarteCreationChasse(corps) {
  marqueursEtapesChasse = new Map();
  const latDepart = window.COMMUNE_LAT ?? 43.6047;
  const lngDepart = window.COMMUNE_LNG ?? 1.4442;
  carteCreationChasse = L.map(corps.querySelector('#carte-creation-chasse'), { maxZoom: 20 })
    .setView([latDepart, lngDepart], window.COMMUNE_COORDS_MANQUANTES ? 6 : 14);
  L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 20 },
  ).addTo(carteCreationChasse);

  // Un clic cible toujours la première étape encore sans position — flux naturel : "+ Ajouter
  // une étape" puis clic sur la carte, en boucle. Une fois toutes les étapes placées, un clic
  // supplémentaire n'a d'effet qu'en ajoutant une nouvelle étape au préalable ou en faisant
  // glisser un repère existant.
  carteCreationChasse.on('click', (e) => {
    const ligneAPlacer = [...corps.querySelectorAll('.ligne-etape-chasse')]
      .find((l) => !l.querySelector('.etape-lat').value || !l.querySelector('.etape-lng').value);
    if (!ligneAPlacer) {
      afficherToastMessage('Ajoute une étape pour placer un point supplémentaire, ou fais glisser un repère existant.', 'info');
      return;
    }
    definirPositionEtape(ligneAPlacer, e.latlng.lat, e.latlng.lng);
  });

  // La carte est créée dans une modale tout juste insérée dans le DOM : Leaflet a besoin d'un
  // invalidateSize() une fois le conteneur réellement visible (voir agenda.js, même piège).
  setTimeout(() => carteCreationChasse.invalidateSize(), 80);
}

// Pose ou déplace le repère numéroté d'une étape sur la carte partagée, et synchronise ses
// champs lat/lng cachés — point d'entrée commun au clic sur la carte, au glisser-déposer d'un
// repère, au bouton "Ma position" et à une saisie manuelle des coordonnées.
function definirPositionEtape(ligne, lat, lng) {
  ligne.querySelector('.etape-lat').value = lat;
  ligne.querySelector('.etape-lng').value = lng;
  const id = ligne.dataset.etapeId;
  let marqueur = marqueursEtapesChasse.get(id);
  if (marqueur) {
    marqueur.setLatLng([lat, lng]);
  } else {
    marqueur = L.marker([lat, lng], {
      draggable: true,
      icon: L.divIcon({ className: 'pastille-numero-etape', html: ligne.dataset.numero, iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).addTo(carteCreationChasse);
    marqueur.on('dragend', () => {
      const pos = marqueur.getLatLng();
      ligne.querySelector('.etape-lat').value = pos.lat;
      ligne.querySelector('.etape-lng').value = pos.lng;
    });
    marqueursEtapesChasse.set(id, marqueur);
  }
}

// etapeExistante (optionnel) : pré-remplit la ligne pour la modale d'édition plutôt que de
// création — voir ouvrirModaleEditionChasse. Dans ce cas la ligne garde l'id réel de l'étape
// (dataset.dbId) et perd le bouton "Retirer" : l'édition corrige une étape, elle ne restructure
// pas la chasse (ajout/retrait/réordre nécessitent toujours de la recréer).
function ajouterLigneEtape(corps, etapeExistante = null) {
  compteurEtapes++;
  const n = compteurEtapes;
  const conteneur = corps.querySelector('#liste-etapes-chasse-modale');
  const ligne = document.createElement('div');
  ligne.className = 'ligne-etape-chasse';
  ligne.dataset.etapeId = n;
  ligne.dataset.numero = etapeExistante ? etapeExistante.ordre + 1 : n;
  if (etapeExistante) ligne.dataset.dbId = etapeExistante.id;
  if (etapeExistante?.photo_r2_key) ligne.dataset.photoActuelle = etapeExistante.photo_r2_key;
  ligne.style.cssText = 'border:1.5px solid var(--eauL);border-radius:10px;padding:10px;margin-bottom:10px;';
  ligne.innerHTML = `
    <strong>Étape ${etapeExistante ? etapeExistante.ordre + 1 : n}</strong>
    <input type="text" class="etape-titre" placeholder="Titre de l'étape" maxlength="150" value="${etapeExistante ? escapeAttr(etapeExistante.titre) : ''}">
    <textarea class="etape-indice" placeholder="Indice pour trouver le lieu" maxlength="500">${etapeExistante ? escapeAttr(etapeExistante.indice) : ''}</textarea>
    <div style="display:flex;gap:6px;">
      <input type="number" step="any" class="etape-lat" placeholder="Latitude" value="${etapeExistante ? etapeExistante.lat : ''}">
      <input type="number" step="any" class="etape-lng" placeholder="Longitude" value="${etapeExistante ? etapeExistante.lng : ''}">
      <button type="button" class="btn-position-etape">📍 Ma position</button>
    </div>
    <label style="display:block;margin:8px 0 4px;font-size:13px;color:var(--roseau);">Au scan sur place, déclencher :</label>
    <select class="etape-type">
      <option value="aucun">🚩 Point de passage (balisage, direction)</option>
      <option value="texte">Une découverte (texte + photo)</option>
      ${etapeExistante?.type_contenu === 'photo' ? '<option value="photo">Une photo seule</option>' : ''}
      <option value="enigme">Une énigme (réponse à saisir)</option>
    </select>
    <div class="etape-champs-contenu"></div>
    ${etapeExistante ? '' : '<button type="button" class="btn-supprimer-etape">Retirer cette étape</button>'}
  `;
  ligne.querySelector('.btn-position-etape').addEventListener('click', (e) => {
    if (!navigator.geolocation) return;
    const bouton = e.currentTarget;
    const texteInitial = bouton.textContent;
    bouton.disabled = true;
    obtenirPositionPrecise((precision) => {
      bouton.textContent = `±${Math.round(precision)} m…`;
    }).then((pos) => {
      definirPositionEtape(ligne, pos.coords.latitude, pos.coords.longitude);
      carteCreationChasse?.setView([pos.coords.latitude, pos.coords.longitude], 16);
    }).catch(() => afficherToastMessage('Impossible de récupérer la position.', 'erreur'))
      .finally(() => { bouton.disabled = false; bouton.textContent = texteInitial; });
  });

  // Symétrie avec le clic sur la carte : une saisie manuelle des coordonnées pose ou déplace
  // aussi le repère, pour que la carte reste toujours le reflet fidèle des champs.
  const essaierSyncDepuisChamps = () => {
    const lat = parseFloat(ligne.querySelector('.etape-lat').value);
    const lng = parseFloat(ligne.querySelector('.etape-lng').value);
    if (!isNaN(lat) && !isNaN(lng)) definirPositionEtape(ligne, lat, lng);
  };
  ligne.querySelector('.etape-lat').addEventListener('change', essaierSyncDepuisChamps);
  ligne.querySelector('.etape-lng').addEventListener('change', essaierSyncDepuisChamps);

  if (etapeExistante) definirPositionEtape(ligne, etapeExistante.lat, etapeExistante.lng);

  const zoneContenu = ligne.querySelector('.etape-champs-contenu');
  const selectType = ligne.querySelector('.etape-type');
  const remplirChamps = (t) => {
    if (t === 'texte') {
      zoneContenu.innerHTML = `
        <textarea class="etape-contenu" placeholder="Texte de découverte affiché au joueur à son arrivée (histoire du lieu, anecdote…)" maxlength="2000">${etapeExistante?.contenu ? escapeAttr(etapeExistante.contenu) : ''}</textarea>
        <label style="display:block;margin:4px 0;font-size:13px;color:var(--roseau);">📸 Photo (facultative)</label>
        ${etapeExistante?.photo_r2_key ? `<p style="font-size:12px;color:var(--roseau);margin:0 0 4px;">Photo actuelle en place : choisissez un fichier pour la remplacer.</p>
        <label style="display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--roseau);margin-bottom:6px;"><input type="checkbox" class="etape-retirer-photo" style="width:auto;margin:0;"> Retirer la photo actuelle</label>` : ''}
        <input type="file" class="etape-photo" accept="image/*">`;
    } else if (t === 'photo') {
      zoneContenu.innerHTML = `
        ${etapeExistante?.photo_r2_key ? `<p style="font-size:12px;color:var(--roseau);">Photo actuelle en place — choisis un fichier pour la remplacer, laisse vide pour la garder.</p>` : ''}
        <input type="file" class="etape-photo" accept="image/*">`;
    } else if (t === 'enigme') {
      zoneContenu.innerHTML = `
        <textarea class="etape-contenu" placeholder="Question de l'énigme" maxlength="2000">${etapeExistante?.contenu ? escapeAttr(etapeExistante.contenu) : ''}</textarea>
        <input type="text" class="etape-reponse" placeholder="Réponse attendue" maxlength="200" value="${etapeExistante?.enigme_reponse ? escapeAttr(etapeExistante.enigme_reponse) : ''}">`;
    } else {
      // Point de passage : consigne d'orientation facultative, affichée au joueur en arrivant.
      zoneContenu.innerHTML = `<input type="text" class="etape-contenu" maxlength="200" placeholder="Consigne facultative : « Prenez le sentier à gauche après le calvaire »" value="${etapeExistante?.type_contenu === 'aucun' && etapeExistante?.contenu ? escapeAttr(etapeExistante.contenu) : ''}">`;
    }
  };
  selectType.addEventListener('change', () => remplirChamps(selectType.value));

  // Nouvelle étape : une découverte par défaut ; le point de passage reste un choix voulu.
  selectType.value = etapeExistante ? etapeExistante.type_contenu : 'texte';
  remplirChamps(selectType.value);

  ligne.querySelector('.btn-supprimer-etape')?.addEventListener('click', () => {
    marqueursEtapesChasse.get(ligne.dataset.etapeId)?.remove();
    marqueursEtapesChasse.delete(ligne.dataset.etapeId);
    ligne.remove();
  });
  conteneur.appendChild(ligne);
  return ligne;
}

// Étapes incomplètes : signalées une par une (cadre rouge + liste au-dessus du bouton) au lieu
// d'être écartées en silence — avant le 2026-11-05, une chasse saisie avec 8 étapes pouvait être
// créée avec les 3 seules complètes, sans aucun message. En création, une ligne restée entièrement
// vide (ajoutée puis jamais remplie) est simplement ignorée (marquée data-vide).
function verifierEtapesChasse(corps, creation) {
  const problemes = [];
  let premiere = null;
  for (const ligne of corps.querySelectorAll('.ligne-etape-chasse')) {
    const val = (sel) => (ligne.querySelector(sel)?.value || '').trim();
    const type = val('.etape-type');
    const vide = !val('.etape-titre') && !val('.etape-indice') && !val('.etape-lat') && !val('.etape-lng')
      && !val('.etape-contenu') && !ligne.querySelector('.etape-photo')?.files[0];
    ligne.dataset.vide = creation && vide ? '1' : '';
    const manque = [];
    if (!ligne.dataset.vide) {
      if (!val('.etape-titre')) manque.push('le titre');
      if (!val('.etape-indice')) manque.push('l’indice');
      if (isNaN(parseFloat(val('.etape-lat'))) || isNaN(parseFloat(val('.etape-lng')))) manque.push('la position sur la carte');
      if (type === 'texte' && !val('.etape-contenu')) manque.push('le texte descriptif');
      if (type === 'enigme' && !val('.etape-contenu')) manque.push('la question');
      if (type === 'enigme' && !val('.etape-reponse')) manque.push('la réponse');
      if (type === 'photo' && !ligne.querySelector('.etape-photo')?.files[0] && !ligne.dataset.photoActuelle) manque.push('la photo');
    }
    ligne.style.borderColor = manque.length ? 'var(--rouge)' : 'var(--eauL)';
    if (manque.length) {
      problemes.push(`Étape ${ligne.dataset.numero} : il manque ${manque.join(', ')}.`);
      premiere ??= ligne;
    }
  }

  let zone = corps.querySelector('.erreurs-etapes-chasse');
  if (!zone) {
    zone = document.createElement('div');
    zone.className = 'erreurs-etapes-chasse';
    zone.style.cssText = 'color:var(--rouge);font-size:13px;margin-top:10px;';
    corps.querySelector('button[type="submit"]').before(zone);
  }
  zone.innerHTML = problemes.map((p) => `<p style="margin:2px 0;">${escapeAttr(p)}</p>`).join('');
  if (premiere) {
    premiere.scrollIntoView({ behavior: 'smooth', block: 'center' });
    afficherToastMessage(`${problemes.length} étape(s) incomplète(s) : rien n'a été enregistré.`, 'erreur');
  }
  return !premiere;
}

// Photo d'une étape de découverte : un fichier choisi est envoyé ; sinon la photo actuelle est
// conservée (modification), sauf si « Retirer la photo actuelle » est cochée. Renvoie la clé de la
// photo, null s'il n'y en a pas, false si l'envoi a échoué (l'appelant s'arrête et le dit : une photo
// ne doit jamais disparaître en silence).
async function photoDeLEtape(ligne) {
  const fichier = ligne.querySelector('.etape-photo')?.files[0];
  if (fichier) {
    try {
      const compresse = await compresserImage(fichier);
      const resUp = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/upload-photo`, {
        method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
      });
      if (resUp.ok) return (await resUp.json()).key;
    } catch { /* envoi impossible : signalé par l'appelant */ }
    return false;
  }
  if (ligne.querySelector('.etape-retirer-photo')?.checked) return null;
  return ligne.dataset.photoActuelle || null;
}

async function soumettreChasse(corps, overlay) {
  const titre = corps.querySelector('#titre-chasse-modale').value.trim();
  const description = corps.querySelector('#description-chasse-modale').value.trim();
  const mode = corps.querySelector('#mode-chasse-modale').value;
  const rayon_metres = parseInt(corps.querySelector('#rayon-chasse-modale').value, 10) || 50;
  if (!titre) return;
  if (!verifierEtapesChasse(corps, true)) return;

  const etapes = [];
  for (const ligne of corps.querySelectorAll('.ligne-etape-chasse')) {
    if (ligne.dataset.vide) continue;
    const titre = ligne.querySelector('.etape-titre').value.trim();
    const indice = ligne.querySelector('.etape-indice').value.trim();
    const lat = parseFloat(ligne.querySelector('.etape-lat').value);
    const lng = parseFloat(ligne.querySelector('.etape-lng').value);

    const type_contenu = ligne.querySelector('.etape-type').value;
    const etape = { titre, indice, lat, lng, type_contenu };
    if (type_contenu === 'texte' || type_contenu === 'photo') {
      if (type_contenu === 'texte') etape.contenu = ligne.querySelector('.etape-contenu').value.trim();
      const photo = await photoDeLEtape(ligne);
      if (photo === false) {
        afficherToastMessage(`La photo de l'étape ${ligne.dataset.numero} n'a pas pu être envoyée : rien n'a été enregistré, réessayez.`, 'erreur');
        return;
      }
      if (photo) etape.photo_r2_key = photo;
    } else if (type_contenu === 'enigme') {
      etape.contenu = ligne.querySelector('.etape-contenu').value.trim();
      etape.enigme_reponse = ligne.querySelector('.etape-reponse').value.trim();
    } else if (type_contenu === 'aucun') {
      const consigne = ligne.querySelector('.etape-contenu')?.value.trim();
      if (consigne) etape.contenu = consigne;
    } else if (type_contenu === 'aucun') {
      const consigne = ligne.querySelector('.etape-contenu')?.value.trim();
      if (consigne) etape.contenu = consigne;
    }
    etapes.push(etape);
  }

  if (!etapes.length) {
    afficherToastMessage('Ajoute au moins une étape complète (titre, indice, position).', 'erreur');
    return;
  }

  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titre, description, mode, rayon_metres, etapes }),
  });

  if (res.ok) {
    fermerModaleFormulaire(overlay);
    chargerChasses();
    afficherToastMessage('Chasse créée ! Les QR codes sont accessibles depuis chaque étape.', 'succes');
  } else {
    const data = await res.json();
    afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de création', 'erreur');
  }
}

// ── Modification d'une chasse existante (admin/superadmin) : corrige titre, description et le
// contenu des étapes déjà créées sans régénérer leurs qr_token — les QR imprimés restent valides.
// Ajouter, retirer ou réordonner des étapes reste hors périmètre : il faut recréer la chasse. ──

async function ouvrirModaleEditionChasse(chasse) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasse.id}/etapes`);
  if (!res.ok) { afficherToastMessage('Impossible de charger les étapes à modifier.', 'erreur'); return; }
  const { etapes } = await res.json();
  const estBalade = chasse.mode === 'balade';

  const html = `
    <form id="form-modale-edition-chasse">
      <input type="text" id="titre-chasse-modale" placeholder="Titre de la chasse" maxlength="150" required value="${escapeAttr(chasse.titre)}">
      <textarea id="description-chasse-modale" placeholder="Description">${chasse.description ? escapeAttr(chasse.description) : ''}</textarea>
      ${estBalade ? `
        <label style="display:block;margin:8px 0 4px;font-size:13px;color:var(--roseau);">Rayon de validation autour de chaque point (mètres)</label>
        <input type="number" id="rayon-chasse-modale" value="${chasse.rayon_metres || 50}" min="20" max="500">
      ` : ''}
      <p style="font-size:12px;color:var(--roseau);margin:10px 0 4px;">Corrige les étapes ci-dessous. Ajouter, retirer ou réordonner une étape n'est pas possible ici — il faut recréer la chasse pour ça.</p>
      <label style="display:block;margin:8px 0 4px;font-size:13px;color:var(--roseau);">📍 Emplacement des étapes</label>
      <p style="font-size:12px;color:var(--roseau);margin-bottom:4px;">Fais glisser un repère pour corriger sa position, sans avoir à te rendre sur place.</p>
      <div id="carte-creation-chasse" class="mini-carte-position"></div>
      <div id="liste-etapes-chasse-modale"></div>
      <button type="submit" style="margin-top:12px;">Enregistrer les modifications</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Modifier la chasse', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  compteurEtapes = 0;
  initCarteCreationChasse(corps);
  etapes.forEach((e) => ajouterLigneEtape(corps, e));
  // Après l'invalidateSize (voir initCarteCreationChasse) : le conteneur doit avoir sa taille
  // réelle pour que fitBounds calcule un zoom correct, pas celle d'une modale encore réduite.
  if (marqueursEtapesChasse.size) {
    setTimeout(() => {
      carteCreationChasse.fitBounds(L.featureGroup([...marqueursEtapesChasse.values()]).getBounds().pad(0.25));
    }, 120);
  }

  corps.querySelector('#form-modale-edition-chasse').addEventListener('submit', async (e) => {
    e.preventDefault();
    await soumettreEditionChasse(corps, overlay, chasse.id, estBalade);
  });
}

async function soumettreEditionChasse(corps, overlay, chasseId, estBalade) {
  const titre = corps.querySelector('#titre-chasse-modale').value.trim();
  const description = corps.querySelector('#description-chasse-modale').value.trim();
  if (!titre) return;
  if (!verifierEtapesChasse(corps, false)) return;

  const patchChasse = { titre, description };
  if (estBalade) patchChasse.rayon_metres = parseInt(corps.querySelector('#rayon-chasse-modale').value, 10) || 50;

  const resChasse = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasseId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patchChasse),
  });
  if (!resChasse.ok) {
    afficherToastMessage('Échec de l’enregistrement du titre/description.', 'erreur');
    return;
  }

  let echecs = 0;
  for (const ligne of corps.querySelectorAll('.ligne-etape-chasse')) {
    const etapeId = ligne.dataset.dbId;
    const titreEtape = ligne.querySelector('.etape-titre').value.trim();
    const indice = ligne.querySelector('.etape-indice').value.trim();
    const lat = parseFloat(ligne.querySelector('.etape-lat').value);
    const lng = parseFloat(ligne.querySelector('.etape-lng').value);

    const type_contenu = ligne.querySelector('.etape-type').value;
    const etape = { titre: titreEtape, indice, lat, lng, type_contenu };
    if (type_contenu === 'texte' || type_contenu === 'photo') {
      if (type_contenu === 'texte') etape.contenu = ligne.querySelector('.etape-contenu').value.trim();
      // Toujours renvoyer la photo à garder : le serveur efface celle qui n'est plus envoyée.
      const photo = await photoDeLEtape(ligne);
      if (photo === false) { echecs++; continue; }
      if (photo) etape.photo_r2_key = photo;
    } else if (type_contenu === 'enigme') {
      etape.contenu = ligne.querySelector('.etape-contenu').value.trim();
      etape.enigme_reponse = ligne.querySelector('.etape-reponse').value.trim();
    }

    const resEtape = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasseId}/etapes/${etapeId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(etape),
    });
    if (!resEtape.ok) echecs++;
  }

  fermerModaleFormulaire(overlay);
  chargerChasses(); // l'écran de détail reste ouvert (idChasseDetailOuverte inchangé), juste rafraîchi
  afficherToastMessage(
    echecs ? `Chasse modifiée, mais ${echecs} étape(s) n'ont pas pu être enregistrées.` : 'Chasse modifiée.',
    echecs ? 'erreur' : 'succes',
  );
}
