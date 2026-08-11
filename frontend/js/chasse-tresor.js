// frontend/js/chasse-tresor.js
let compteurEtapes = 0;
let chassesCache = [];
let idChasseDetailOuverte = null;

async function chargerChasses() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor`);
  if (!res.ok) return;
  const { chasses } = await res.json();
  chassesCache = chasses;

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

  const termine = chasse.etapes_validees >= chasse.total_etapes;
  const estGestionnaireChasse = ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);

  zone.innerHTML = `
    <button type="button" class="btn-retour-detail">← Retour aux chasses</button>
    <h3>${escapeAttr(chasse.titre)}</h3>
    ${chasse.description ? `<p>${texteAvecLiensCliquables(chasse.description)}</p>` : ''}
    <p>${chasse.etapes_validees} / ${chasse.total_etapes} étapes validées</p>
    ${!termine && chasse.etape_suivante ? `<p class="indice-etape">Indice : ${escapeAttr(chasse.etape_suivante.indice)}</p>` : ''}
    ${termine ? '<p class="trouve-enigme">Chasse terminée 🎉</p>' : ''}
    ${!termine ? '<button class="btn-scanner">Scanner un QR code</button>' : ''}
    <div id="zone-scanner"></div>
    ${!termine ? `<form id="form-code-manuel"><input placeholder="Code manuel (si scan impossible)"><button>Valider</button></form>` : ''}
    <button type="button" class="btn-classement-chasse" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);margin-top:10px;">🏆 Classement de cette chasse</button>
    <div id="zone-classement"></div>
    ${estGestionnaireChasse ? `
      <div class="actions-admin" style="margin-top:12px;">
        <button class="btn-voir-qr">Voir les QR codes</button>
        <button class="btn-supprimer-chasse">Supprimer la chasse</button>
      </div>
      <div class="liste-qr-etapes"></div>
    ` : ''}
  `;

  zone.querySelector('.btn-retour-detail').addEventListener('click', () => fermerDetailChasse());
  zone.querySelector('.btn-scanner')?.addEventListener('click', () => ouvrirScanner());
  zone.querySelector('.btn-classement-chasse').addEventListener('click', () => afficherClassement(chasse.id));
  zone.querySelector('.btn-voir-qr')?.addEventListener('click', () => afficherQrEtapes(chasse.id, zone));
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
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasseId}/classement`);
  const { classement } = await res.json();
  const zone = document.getElementById('zone-classement');
  zone.innerHTML = classement.map((c, i) => `<p>${i + 1}. ${escapeAttr(c.prenom)} — ${c.total_etapes} étapes</p>`).join('');
}

// ── Sous-onglets Chasses officielles / Trouve la photo ──

function initSousOngletsChasse() {
  document.querySelectorAll('.sous-onglet-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sous-onglet-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const estEnigmes = btn.dataset.sousonglet === 'enigmes';
      document.getElementById('sous-contenu-chasses').hidden = estEnigmes;
      document.getElementById('sous-contenu-enigmes').hidden = !estEnigmes;
      // On revient toujours à la vue liste en changeant de sous-onglet, pour rester lisible.
      idChasseDetailOuverte = null;
      idEnigmeDetailOuverte = null;
      if (estEnigmes) chargerEnigmes();
    });
  });

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
      <div id="liste-etapes-chasse-modale"></div>
      <button type="button" id="btn-ajouter-etape-modale" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);">+ Ajouter une étape</button>
      <button type="submit" style="margin-top:12px;">Créer la chasse</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Créer une chasse au trésor', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  compteurEtapes = 0;

  corps.querySelector('#btn-ajouter-etape-modale').addEventListener('click', () => ajouterLigneEtape(corps));
  ajouterLigneEtape(corps);

  corps.querySelector('#form-modale-chasse').addEventListener('submit', async (e) => {
    e.preventDefault();
    await soumettreChasse(corps, overlay);
  });
}

function ajouterLigneEtape(corps) {
  compteurEtapes++;
  const n = compteurEtapes;
  const conteneur = corps.querySelector('#liste-etapes-chasse-modale');
  const ligne = document.createElement('div');
  ligne.className = 'ligne-etape-chasse';
  ligne.dataset.etapeId = n;
  ligne.style.cssText = 'border:1.5px solid var(--eauL);border-radius:10px;padding:10px;margin-bottom:10px;';
  ligne.innerHTML = `
    <strong>Étape ${n}</strong>
    <input type="text" class="etape-titre" placeholder="Titre de l'étape" maxlength="150">
    <textarea class="etape-indice" placeholder="Indice pour trouver le lieu" maxlength="500"></textarea>
    <div style="display:flex;gap:6px;">
      <input type="number" step="any" class="etape-lat" placeholder="Latitude">
      <input type="number" step="any" class="etape-lng" placeholder="Longitude">
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
    <button type="button" class="btn-supprimer-etape">Retirer cette étape</button>
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
  selectType.addEventListener('change', () => {
    const t = selectType.value;
    if (t === 'texte') {
      zoneContenu.innerHTML = `<textarea class="etape-contenu" placeholder="Texte affiché au joueur à son arrivée" maxlength="2000"></textarea>`;
    } else if (t === 'photo') {
      zoneContenu.innerHTML = `<input type="file" class="etape-photo" accept="image/*">`;
    } else if (t === 'enigme') {
      zoneContenu.innerHTML = `
        <textarea class="etape-contenu" placeholder="Question de l'énigme" maxlength="2000"></textarea>
        <input type="text" class="etape-reponse" placeholder="Réponse attendue" maxlength="200">`;
    } else {
      zoneContenu.innerHTML = '';
    }
  });

  ligne.querySelector('.btn-supprimer-etape').addEventListener('click', () => ligne.remove());
  conteneur.appendChild(ligne);
}

async function soumettreChasse(corps, overlay) {
  const titre = corps.querySelector('#titre-chasse-modale').value.trim();
  const description = corps.querySelector('#description-chasse-modale').value.trim();
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
    body: JSON.stringify({ titre, description, etapes }),
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
