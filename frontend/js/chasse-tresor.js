// frontend/js/chasse-tresor.js
let compteurEtapes = 0;
let chassesCache = [];
let idChasseDetailOuverte = null;
let carteBalade = null;

async function chargerChasses() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor`);
  if (!res.ok) return;
  const { chasses } = await res.json();
  chassesCache = chasses;
  const compte = document.getElementById('compte-chasses');
  if (compte) compte.textContent = chasses.length;

  if (idChasseDetailOuverte) {
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
  if (!chasses.length) {
    conteneur.innerHTML = `<p class="dechets-vide">Aucune chasse pour l'instant.</p>`;
  }
  chasses.forEach((ch) => conteneur.appendChild(renderCarteChasseCompacte(ch)));
}

function renderCarteChasseCompacte(chasse) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'carte-chasse-compacte';
  const termine = chasse.etapes_validees >= chasse.total_etapes;
  el.innerHTML = `
    <h3>${escapeAttr(chasse.titre)}</h3>
    <p>${chasse.etapes_validees} / ${chasse.total_etapes} étapes validées${termine ? ' · Terminée 🎉' : ''}</p>
  `;
  el.addEventListener('click', () => ouvrirDetailChasse(chasse.id));
  return el;
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
  idChasseDetailOuverte = null;
  renderListeChasses(chassesCache);
}

function renderDetailChasse(chasse) {
  document.getElementById('vue-liste-chasses').hidden = true;
  const zone = document.getElementById('vue-detail-chasse');
  zone.hidden = false;
  // On repart d'une carte neuve à chaque rendu (le conteneur est recréé par innerHTML).
  if (carteBalade) { carteBalade.remove(); carteBalade = null; }

  const termine = chasse.etapes_validees >= chasse.total_etapes;
  const estGestionnaireChasse = ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);
  const estBalade = chasse.mode === 'balade';

  const controlesChasse = `
    ${!termine ? '<button class="btn-scanner">Scanner un QR code</button>' : ''}
    <div id="zone-scanner"></div>
    ${!termine ? `<form id="form-code-manuel"><input placeholder="Code manuel (si scan impossible)"><button>Valider</button></form>` : ''}
  `;
  const controlesBalade = `
    <div id="carte-balade" style="height:320px;border-radius:14px;overflow:hidden;margin:8px 0;"></div>
    ${!termine && chasse.etape_suivante ? '<button class="btn-arrive">📍 Je suis arrivé à cette étape</button>' : ''}
  `;

  zone.innerHTML = `
    <button type="button" class="btn-retour-detail">← Retour aux chasses</button>
    <h3>${escapeAttr(chasse.titre)}</h3>
    ${chasse.description ? `<p>${texteAvecLiensCliquables(chasse.description)}</p>` : ''}
    <p>${chasse.etapes_validees} / ${chasse.total_etapes} étapes validées</p>
    ${!termine && chasse.etape_suivante ? `<p class="indice-etape">${estBalade ? 'Prochaine étape' : 'Indice'} : ${escapeAttr(chasse.etape_suivante.indice)}</p>` : ''}
    ${termine ? '<p class="trouve-enigme">Chasse terminée 🎉</p>' : ''}
    ${estBalade ? controlesBalade : controlesChasse}
    <button type="button" class="btn-classement-chasse" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);margin-top:10px;">🏆 Classement de cette chasse</button>
    <div id="zone-classement" hidden></div>
    ${estGestionnaireChasse ? `
      <div class="actions-admin" style="margin-top:12px;">
        <button class="btn-modifier-chasse">✏️ Modifier</button>
        ${estBalade ? '' : '<button class="btn-voir-qr">Voir les QR codes</button>'}
        <button class="btn-supprimer-chasse">Supprimer la chasse</button>
      </div>
      <div class="liste-qr-etapes"></div>
    ` : ''}
  `;

  zone.querySelector('.btn-retour-detail').addEventListener('click', () => fermerDetailChasse());
  zone.querySelector('.btn-scanner')?.addEventListener('click', () => ouvrirScanner());
  zone.querySelector('.btn-arrive')?.addEventListener('click', () => validerEtapePosition(chasse.etape_suivante.id));
  zone.querySelector('.btn-classement-chasse').addEventListener('click', async () => {
    const zoneClassement = document.getElementById('zone-classement');
    zoneClassement.hidden = !zoneClassement.hidden;
    if (!zoneClassement.hidden) await afficherClassement(chasse.id);
  });
  zone.querySelector('.btn-voir-qr')?.addEventListener('click', () => afficherQrEtapes(chasse.id, zone));
  zone.querySelector('.btn-modifier-chasse')?.addEventListener('click', () => ouvrirModaleEditionChasse(chasse));
  zone.querySelector('.btn-supprimer-chasse')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette chasse et toutes ses étapes ?')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasse.id}`, { method: 'DELETE' });
    idChasseDetailOuverte = null;
    chargerChasses();
  });
  zone.querySelector('#form-code-manuel')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = e.target.querySelector('input').value.trim();
    if (code) await validerEtape(code);
    e.target.reset();
  });

  if (estBalade) initCarteBalade(chasse);
}

// Carte de la balade : tous les points + itinéraire tracé ; couleur selon l'état
// (validée / prochaine / à venir).
function initCarteBalade(chasse) {
  const etapes = [...(chasse.etapes || [])].sort((a, b) => a.ordre - b.ordre);
  if (!etapes.length) return;

  carteBalade = L.map('carte-balade', { maxZoom: 20 });
  L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 20 },
  ).addTo(carteBalade);

  const prochaineId = chasse.etape_suivante?.id;
  const points = [];
  etapes.forEach((e) => {
    points.push([e.lat, e.lng]);
    let couleur = '#8A94A6';                              // à venir
    if (e.validee) couleur = '#4CAF50';                   // validée
    else if (e.id === prochaineId) couleur = '#2C7BE5';  // prochaine
    const etat = e.validee ? '✅ validée' : (e.id === prochaineId ? '➡️ prochaine étape' : '🔒 à venir');
    L.circleMarker([e.lat, e.lng], { radius: 9, color: couleur, fillColor: couleur, fillOpacity: 0.85, weight: 2 })
      .addTo(carteBalade)
      .bindPopup(`<strong>Étape ${e.ordre + 1} — ${escapeAttr(e.titre)}</strong><br>${etat}`);
  });
  L.polyline(points, { color: '#2C7BE5', weight: 3, opacity: 0.55, dashArray: '6 6' }).addTo(carteBalade);
  carteBalade.fitBounds(points, { padding: [30, 30], maxZoom: 17 });
  setTimeout(() => carteBalade && carteBalade.invalidateSize(), 150);
}

// Validation d'une étape de balade par proximité GPS.
function validerEtapePosition(etape_id, reponse = null) {
  if (!navigator.geolocation) {
    afficherToastMessage('GPS indisponible sur cet appareil.', 'erreur');
    return;
  }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/valider-position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        etape_id, lat: pos.coords.latitude, lng: pos.coords.longitude,
        ...(reponse != null ? { reponse } : {}),
      }),
    });
    const data = await res.json();

    if (res.ok && data.reussi === false) {
      afficherToastMessage(`Trop loin (~${data.distance_metres} m). Rapproche-toi du point.`, 'erreur');
      return;
    }
    if (res.ok && data.etape_enigme) { afficherEnigmeEtapePosition(etape_id, data.question); return; }
    if (res.ok) {
      afficherToastMessage('Étape validée ! 🎉', 'succes');
      if (data.contenu_revele) afficherContenuRevele(data.contenu_revele);
      traiterRecompense(data);
    } else {
      afficherToastMessage(data.erreur || 'Erreur', 'erreur');
    }
    chargerChasses();
  }, () => afficherToastMessage('Localisation refusée ou indisponible.', 'erreur'),
     { enableHighAccuracy: true, timeout: 10000 });
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

async function validerEtape(qr_token, reponse = null) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/valider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qr_token, ...(reponse != null ? { reponse } : {}) }),
  });
  const data = await res.json();

  // Étape énigme : le serveur renvoie la question sans valider → on demande la réponse.
  if (res.ok && data.etape_enigme) {
    afficherEnigmeEtape(qr_token, data.question);
    return;
  }

  if (res.ok) {
    afficherToastMessage('Étape validée ! 🎉', 'succes');
    if (data.contenu_revele) afficherContenuRevele(data.contenu_revele);
    traiterRecompense(data);
  } else {
    afficherToastMessage(data.erreur || 'Erreur', 'erreur');
  }
  chargerChasses(); // l'écran de détail reste ouvert (idChasseDetailOuverte inchangé), juste rafraîchi
}

// Modale d'énigme : la réponse est vérifiée côté serveur ; on garde la modale ouverte
// tant que la réponse est fausse pour permettre de réessayer.
function afficherEnigmeEtape(qr_token, question) {
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
    const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/valider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_token, reponse }),
    });
    const data = await res.json();
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      afficherToastMessage('Bonne réponse ! Étape validée 🎉', 'succes');
      if (data.contenu_revele) afficherContenuRevele(data.contenu_revele);
      traiterRecompense(data);
      chargerChasses();
    } else {
      afficherToastMessage(data.erreur || 'Mauvaise réponse', 'erreur');
    }
  });
}

// Révèle le contenu d'une étape validée (texte descriptif ou photo).
function afficherContenuRevele(contenu) {
  if (contenu.type === 'texte' && contenu.texte) {
    ouvrirModaleFormulaire('📖 Découverte', `<p>${texteAvecLiensCliquables(contenu.texte)}</p>`);
  } else if (contenu.type === 'photo' && contenu.photo_url) {
    ouvrirModaleFormulaire('📸 Découverte', `<img src="${contenu.photo_url}" style="width:100%;border-radius:12px;">`);
  }
}

async function afficherClassement(chasseId) {
  const zone = document.getElementById('zone-classement');
  zone.innerHTML = `<p class="dechets-vide">Chargement…</p>`;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasseId}/classement`);
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

  corps.querySelector('#btn-ajouter-etape-modale').addEventListener('click', () => ajouterLigneEtape(corps));
  ajouterLigneEtape(corps);

  corps.querySelector('#form-modale-chasse').addEventListener('submit', async (e) => {
    e.preventDefault();
    await soumettreChasse(corps, overlay);
  });
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
      <option value="aucun">Rien (valider simplement)</option>
      <option value="texte">Un texte descriptif</option>
      <option value="photo">Une photo</option>
      <option value="enigme">Une énigme (réponse à saisir)</option>
    </select>
    <div class="etape-champs-contenu"></div>
    ${etapeExistante ? '' : '<button type="button" class="btn-supprimer-etape">Retirer cette étape</button>'}
  `;
  ligne.querySelector('.btn-position-etape').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      ligne.querySelector('.etape-lat').value = pos.coords.latitude;
      ligne.querySelector('.etape-lng').value = pos.coords.longitude;
    });
  });

  const zoneContenu = ligne.querySelector('.etape-champs-contenu');
  const selectType = ligne.querySelector('.etape-type');
  const remplirChamps = (t) => {
    if (t === 'texte') {
      zoneContenu.innerHTML = `<textarea class="etape-contenu" placeholder="Texte affiché au joueur à son arrivée" maxlength="2000">${etapeExistante?.contenu ? escapeAttr(etapeExistante.contenu) : ''}</textarea>`;
    } else if (t === 'photo') {
      zoneContenu.innerHTML = `
        ${etapeExistante?.photo_r2_key ? `<p style="font-size:12px;color:var(--roseau);">Photo actuelle en place — choisis un fichier pour la remplacer, laisse vide pour la garder.</p>` : ''}
        <input type="file" class="etape-photo" accept="image/*">`;
    } else if (t === 'enigme') {
      zoneContenu.innerHTML = `
        <textarea class="etape-contenu" placeholder="Question de l'énigme" maxlength="2000">${etapeExistante?.contenu ? escapeAttr(etapeExistante.contenu) : ''}</textarea>
        <input type="text" class="etape-reponse" placeholder="Réponse attendue" maxlength="200" value="${etapeExistante?.enigme_reponse ? escapeAttr(etapeExistante.enigme_reponse) : ''}">`;
    } else {
      zoneContenu.innerHTML = '';
    }
  };
  selectType.addEventListener('change', () => remplirChamps(selectType.value));

  if (etapeExistante) {
    selectType.value = etapeExistante.type_contenu;
    remplirChamps(etapeExistante.type_contenu);
  }

  ligne.querySelector('.btn-supprimer-etape')?.addEventListener('click', () => ligne.remove());
  conteneur.appendChild(ligne);
  return ligne;
}

async function soumettreChasse(corps, overlay) {
  const titre = corps.querySelector('#titre-chasse-modale').value.trim();
  const description = corps.querySelector('#description-chasse-modale').value.trim();
  const mode = corps.querySelector('#mode-chasse-modale').value;
  const rayon_metres = parseInt(corps.querySelector('#rayon-chasse-modale').value, 10) || 50;
  if (!titre) return;

  const etapes = [];
  for (const ligne of corps.querySelectorAll('.ligne-etape-chasse')) {
    const titre = ligne.querySelector('.etape-titre').value.trim();
    const indice = ligne.querySelector('.etape-indice').value.trim();
    const lat = parseFloat(ligne.querySelector('.etape-lat').value);
    const lng = parseFloat(ligne.querySelector('.etape-lng').value);
    if (!titre || !indice || isNaN(lat) || isNaN(lng)) continue;

    const type_contenu = ligne.querySelector('.etape-type').value;
    const etape = { titre, indice, lat, lng, type_contenu };
    if (type_contenu === 'texte') {
      etape.contenu = ligne.querySelector('.etape-contenu').value.trim();
    } else if (type_contenu === 'enigme') {
      etape.contenu = ligne.querySelector('.etape-contenu').value.trim();
      etape.enigme_reponse = ligne.querySelector('.etape-reponse').value.trim();
    } else if (type_contenu === 'photo') {
      const fichier = ligne.querySelector('.etape-photo').files[0];
      if (fichier) {
        try {
          const compresse = await compresserImage(fichier);
          const resUp = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/upload-photo`, {
            method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
          });
          if (resUp.ok) { const { key } = await resUp.json(); etape.photo_r2_key = key; }
        } catch { console.warn('Upload photo étape échoué.'); }
      }
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
      <div id="liste-etapes-chasse-modale"></div>
      <button type="submit" style="margin-top:12px;">Enregistrer les modifications</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Modifier la chasse', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  compteurEtapes = 0;
  etapes.forEach((e) => ajouterLigneEtape(corps, e));

  corps.querySelector('#form-modale-edition-chasse').addEventListener('submit', async (e) => {
    e.preventDefault();
    await soumettreEditionChasse(corps, overlay, chasse.id, estBalade);
  });
}

async function soumettreEditionChasse(corps, overlay, chasseId, estBalade) {
  const titre = corps.querySelector('#titre-chasse-modale').value.trim();
  const description = corps.querySelector('#description-chasse-modale').value.trim();
  if (!titre) return;

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
    if (!titreEtape || !indice || isNaN(lat) || isNaN(lng)) { echecs++; continue; }

    const type_contenu = ligne.querySelector('.etape-type').value;
    const etape = { titre: titreEtape, indice, lat, lng, type_contenu };
    if (type_contenu === 'texte') {
      etape.contenu = ligne.querySelector('.etape-contenu').value.trim();
    } else if (type_contenu === 'enigme') {
      etape.contenu = ligne.querySelector('.etape-contenu').value.trim();
      etape.enigme_reponse = ligne.querySelector('.etape-reponse').value.trim();
    } else if (type_contenu === 'photo') {
      const fichier = ligne.querySelector('.etape-photo')?.files[0];
      if (fichier) {
        try {
          const compresse = await compresserImage(fichier);
          const resUp = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/upload-photo`, {
            method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
          });
          if (resUp.ok) { const { key } = await resUp.json(); etape.photo_r2_key = key; }
        } catch { console.warn('Upload photo étape échoué.'); }
      } else if (ligne.dataset.photoActuelle) {
        etape.photo_r2_key = ligne.dataset.photoActuelle;
      }
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
