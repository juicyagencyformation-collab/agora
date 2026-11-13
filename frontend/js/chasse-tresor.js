// frontend/js/chasse-tresor.js
let compteurEtapes = 0;
let chassesCache = [];
// Brouillons de parcours (gestionnaires, 2026-11-13) : invisibles des habitants jusqu'à « Publier ».
let brouillonsCache = [];
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
  const { chasses, brouillons } = await res.json();
  appliquerValidationsEnAttente(chasses);
  chassesCache = chasses;
  brouillonsCache = brouillons || [];
  envoyerValidationsEnAttente();
  const compte = document.getElementById('compte-chasses');
  if (compte && !modeArchivesChasses) compte.textContent = chasses.length;

  if (!modeArchivesChasses && idChasseDetailOuverte) {
    const chasse = chasses.find((c) => c.id === idChasseDetailOuverte);
    if (chasse) { renderDetailChasse(chasse); return; }
    const brouillon = brouillonsCache.find((b) => b.id === idChasseDetailOuverte);
    if (brouillon) { renderDetailBrouillon(brouillon); return; }
    idChasseDetailOuverte = null; // supprimée entre-temps
  }
  renderListeChasses(chasses);
}

function renderListeChasses(chasses) {
  document.getElementById('vue-liste-chasses').hidden = false;
  document.getElementById('vue-detail-chasse').hidden = true;
  const conteneur = document.getElementById('liste-chasses');
  conteneur.innerHTML = '';
  const avecBrouillons = !modeArchivesChasses && !villageVisite && brouillonsCache.length > 0;
  if (!chasses.length && !avecBrouillons) {
    conteneur.innerHTML = modeArchivesChasses ? '<p class="dechets-vide">Aucune chasse archivée.</p>' : messageAucunParcours();
  }
  conteneur.querySelector('.btn-vide-creer')?.addEventListener('click', () => ouvrirModaleCreationChasse());
  conteneur.querySelector('.btn-vide-ailleurs')?.addEventListener('click', () => ouvrirRechercheVillage());
  // Brouillons en tête du carrousel, comme des cartes à part entière (un bloc englobant y était
  // traité comme une seule carte étroite et écrasait tout, 2026-11-13).
  if (avecBrouillons) brouillonsCache.forEach((b) => conteneur.appendChild(renderCarteBrouillon(b)));
  chasses.forEach((ch) => conteneur.appendChild(
    modeArchivesChasses ? renderCarteChasseArchivee(ch) : renderCarteChasseCompacte(ch),
  ));
}

// ── Brouillons (2026-11-13) : créer → tester → publier. Rien n'est visible ni notifié aux
// habitants avant « Publier » (confirmation obligatoire, voir publierBrouillon). ──

function renderCarteBrouillon(brouillon) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'carte-chasse-compacte carte-brouillon';
  el.innerHTML = `
    <span class="type-parcours type-${brouillon.mode === 'balade' ? 'balade' : 'chasse'}">${brouillon.mode === 'balade' ? '🚶 Balade' : '🔎 Chasse'}</span>
    <h3>${escapeAttr(brouillon.titre)}</h3>
    <p class="etat-brouillon">📝 Brouillon · visible par la mairie seulement</p>
  `;
  el.addEventListener('click', () => { idChasseDetailOuverte = brouillon.id; renderDetailBrouillon(brouillon); });
  return el;
}

function renderDetailBrouillon(brouillon) {
  document.getElementById('vue-liste-chasses').hidden = true;
  const zone = document.getElementById('vue-detail-chasse');
  zone.hidden = false;
  arreterSuiviBalade();
  if (carteBalade) { carteBalade.remove(); carteBalade = null; }
  document.body.classList.remove('carte-balade-plein-ecran');
  const estBalade = brouillon.mode === 'balade';

  zone.innerHTML = `
    <button type="button" class="btn-retour-detail">← Retour aux parcours</button>
    <span class="type-parcours type-${estBalade ? 'balade' : 'chasse'}">${estBalade ? '🚶 Balade guidée' : '🔎 Chasse au trésor'}</span>
    <h3>📝 ${escapeAttr(brouillon.titre)}</h3>
    ${brouillon.description ? `<p>${texteAvecLiensCliquables(brouillon.description)}</p>` : ''}
    <p class="indice-etape">Brouillon : visible seulement par la mairie. Testez chaque étape (depuis chez vous ou sur place), puis publiez : les habitants le verront alors, avec une notification.</p>
    <div class="actions-admin" style="margin-top:12px;">
      <button class="btn-modifier-brouillon">✏️ Modifier</button>
      <button class="btn-tester-brouillon">🧪 Tester</button>
      ${estBalade ? '' : '<button class="btn-voir-qr">Voir les QR codes</button>'}
      <button class="btn-publier-brouillon">🚀 Publier</button>
      <button class="btn-supprimer-brouillon">Supprimer le brouillon</button>
    </div>
    <div class="liste-qr-etapes"></div>
    <div class="zone-test-brouillon"></div>
  `;

  zone.querySelector('.btn-retour-detail').addEventListener('click', () => fermerDetailChasse());
  zone.querySelector('.btn-modifier-brouillon').addEventListener('click', () => ouvrirModaleCreationChasse(brouillon));
  zone.querySelector('.btn-tester-brouillon').addEventListener('click', () => afficherTestBrouillon(brouillon, zone));
  zone.querySelector('.btn-voir-qr')?.addEventListener('click', () => afficherQrEtapes(brouillon.id, zone));
  zone.querySelector('.btn-publier-brouillon').addEventListener('click', () => publierBrouillon(brouillon));
  zone.querySelector('.btn-supprimer-brouillon').addEventListener('click', async () => {
    if (!confirm('Supprimer ce brouillon et toutes ses étapes ?')) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${brouillon.id}`, { method: 'DELETE' });
    if (!res.ok) { afficherToastMessage('Échec de la suppression.', 'erreur'); return; }
    idChasseDetailOuverte = null;
    chargerChasses();
  });
}

// Mode test : chaque étape se rejoue à la demande, dans n'importe quel ordre, sans rien enregistrer
// (ni progression, ni points). « Distance d'ici » mesure l'écart réel au point sur le terrain.
async function afficherTestBrouillon(brouillon, zone) {
  const zoneTest = zone.querySelector('.zone-test-brouillon');
  if (zoneTest.innerHTML.trim()) { zoneTest.innerHTML = ''; return; } // second clic : on replie
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${brouillon.id}/etapes`);
  if (!res.ok) { zoneTest.innerHTML = '<p class="dechets-vide">Impossible de charger les étapes.</p>'; return; }
  const { etapes } = await res.json();
  const libelles = { aucun: '🚩 point de passage', texte: '📜 découverte', photo: '📸 photo', enigme: '🧩 énigme' };
  zoneTest.innerHTML = `
    <p style="font-size:13px;color:var(--roseau);margin:12px 0 6px;">🧪 Mode test : rien n'est enregistré (ni progression, ni points). « Simuler l'arrivée » fonctionne depuis chez vous ; « Distance d'ici » mesure l'écart réel sur le terrain.</p>
    ${etapes.map((e) => `
      <div class="ligne-toggle-onglet" data-etape="${e.id}" style="flex-wrap:wrap;gap:6px;">
        <span>Étape ${e.ordre + 1} · ${escapeAttr(e.titre)} <small>(${libelles[e.type_contenu] || e.type_contenu})</small></span>
        <span style="display:flex;gap:6px;">
          <button type="button" class="btn-simuler-etape" style="width:auto;">▶ Simuler l'arrivée</button>
          <button type="button" class="btn-distance-etape" style="width:auto;">📍 Distance d'ici</button>
        </span>
        <small class="resultat-test-etape" style="flex-basis:100%;"></small>
      </div>
    `).join('')}
  `;
  zoneTest.querySelectorAll('[data-etape]').forEach((ligne) => {
    const etapeId = ligne.dataset.etape;
    const resultat = ligne.querySelector('.resultat-test-etape');
    ligne.querySelector('.btn-simuler-etape').addEventListener('click', () => testerEtapeBrouillon(brouillon.id, etapeId, resultat));
    ligne.querySelector('.btn-distance-etape').addEventListener('click', (ev) => {
      const bouton = ev.currentTarget;
      const texteInitial = bouton.textContent;
      bouton.disabled = true;
      obtenirPositionPrecise((precision) => { bouton.textContent = `±${Math.round(precision)} m…`; })
        .then(async (pos) => {
          const resTest = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${brouillon.id}/tester`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ etape_id: etapeId, lat: pos.coords.latitude, lng: pos.coords.longitude }),
          });
          const data = await resTest.json().catch(() => ({}));
          if (data.distance_metres == null) { afficherToastMessage(data.erreur || 'Mesure impossible.', 'erreur'); return; }
          resultat.textContent = `📍 ${formaterDistance(data.distance_metres)} du point : ${data.dans_la_zone ? 'dans la zone de validation ✅' : `hors zone (rayon ${data.rayon_metres} m)`}`;
        })
        .catch(() => afficherToastMessage('Localisation refusée ou indisponible.', 'erreur'))
        .finally(() => { bouton.disabled = false; bouton.textContent = texteInitial; });
    });
  });
  zoneTest.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Rejoue une étape en test. Énigme : la question s'ouvre comme pour un joueur, et la réponse est
// vérifiée par le serveur (même normalisation que le vrai jeu). Renvoie true si l'étape passe.
async function testerEtapeBrouillon(chasseId, etapeId, resultat, reponse = null) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${chasseId}/tester`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ etape_id: etapeId, ...(reponse != null ? { reponse } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.etape_enigme) {
    const overlay = ouvrirModaleFormulaire('🧩 Énigme (test)', `
      <form class="form-enigme-test">
        <p class="indice-etape">${escapeAttr(data.question)}</p>
        <input type="text" placeholder="Réponse à essayer" maxlength="200" required>
        <button type="submit" style="margin-top:10px;">Vérifier</button>
      </form>
    `);
    overlay.querySelector('.form-enigme-test').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const essai = overlay.querySelector('input').value.trim();
      if (essai && await testerEtapeBrouillon(chasseId, etapeId, resultat, essai)) fermerModaleFormulaire(overlay);
    });
    return false;
  }
  if (!res.ok) {
    afficherToastMessage(data.erreur || 'Échec du test.', 'erreur');
    if (reponse != null) resultat.textContent = `❌ « ${reponse} » refusée`;
    return false;
  }
  resultat.textContent = reponse != null ? `✅ Réponse « ${reponse} » acceptée` : '✅ Étape testée';
  if (data.contenu_revele?.type === 'consigne') afficherToastMessage(`🚩 ${data.contenu_revele.texte}`, 'succes');
  else if (data.contenu_revele) afficherContenuRevele(data.contenu_revele);
  else if (data.point_de_passage) afficherToastMessage('🚩 Point de passage (sans consigne).', 'info');
  return true;
}

// Publication : contrôle automatique, puis confirmation explicite (pas de publication sur un clic
// accidentel). Les erreurs bloquent ; les avertissements s'affichent, la mairie décide.
async function publierBrouillon(brouillon) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${brouillon.id}/verification`);
  if (!res.ok) { afficherToastMessage('Impossible de vérifier le parcours.', 'erreur'); return; }
  const { erreurs, avertissements } = await res.json();
  const lignes = (items, prefixe) => items.map((t) => `<p style="margin:4px 0;">${prefixe} ${escapeAttr(t)}</p>`).join('');
  const html = erreurs.length
    ? `${lignes(erreurs, '❌')}<p style="margin-top:10px;">Corrigez ces points avec « Modifier » avant de publier.</p>`
    : `${avertissements.length ? `<p><strong>À vérifier avant de publier :</strong></p>${lignes(avertissements, '⚠️')}` : '<p>✅ Aucun problème détecté.</p>'}
      <p style="margin-top:10px;">Une fois publié, « ${escapeAttr(brouillon.titre)} » sera visible par tous les habitants et <strong>une notification sera envoyée aux abonnés</strong>. Ses étapes ne pourront plus être ajoutées, retirées ni réordonnées.</p>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button type="button" class="btn-annuler-publication" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);">Annuler</button>
        <button type="button" class="btn-confirmer-publication">🚀 Oui, publier</button>
      </div>`;
  const overlay = ouvrirModaleFormulaire(erreurs.length ? 'Pas encore prêt à publier' : 'Publier le parcours ?', html);
  overlay.querySelector('.btn-annuler-publication')?.addEventListener('click', () => fermerModaleFormulaire(overlay));
  overlay.querySelector('.btn-confirmer-publication')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const resPub = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${brouillon.id}/publier`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await resPub.json().catch(() => ({}));
    fermerModaleFormulaire(overlay);
    if (!resPub.ok) afficherToastMessage(data.erreur || 'Échec de la publication.', 'erreur');
    else afficherToastMessage('Parcours publié ! Les habitants abonnés sont prévenus. 🎉', 'succes');
    chargerChasses(); // l'écran reste sur ce parcours (idChasseDetailOuverte), désormais publié
  });
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
    ${!termine && chasse.etape_suivante ? (estBalade
      ? `<p class="indice-etape">Prochaine étape : <strong>${escapeAttr(chasse.etape_suivante.titre || '')}</strong>${chasse.etape_suivante.indice ? `<br>${escapeAttr(chasse.etape_suivante.indice)}` : ''}</p>`
      : `<p class="indice-etape">Indice : ${escapeAttr(chasse.etape_suivante.indice)}</p>`) : ''}
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
  zone.querySelector('.btn-arrive')?.addEventListener('click', (e) => validerEtapePosition(e.currentTarget.dataset.etape || chasse.etape_suivante.id, null, e.currentTarget));
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
    // Étapes restantes jusqu'à la prochaine découverte/énigme incluse : les points de passage d'avant
    // peuvent être dépassés sans avoir été validés (téléphone en poche, pas de réseau) — le serveur
    // les coche avec l'étape suivante. On vise donc la plus avancée dont on est dans la zone.
    const restantes = [];
    for (const e of etapes) {
      if (e.validee || e.ordre < prochaine.ordre) continue;
      restantes.push(e);
      if (e.type_contenu !== 'aucun') break;
    }
    const mesures = restantes.map((e) => ({ e, ...distanceEtCap(lat, lng, e.lat, e.lng) }));
    const vise = [...mesures].reverse().find((m) => m.distance <= rayon) || mesures[0];
    const decouverte = mesures[mesures.length - 1];
    const visePassage = vise.e.type_contenu === 'aucun';
    const temp = temperatureDistance(vise.distance, rayon);
    const nbAttente = lireValidationsEnAttente().filter((v) => v.chasseId === chasse.id).length;
    guidage.dataset.etat = temp.cle;
    guidage.innerHTML = `
      ${consigne ? `<span class="consigne-balade">🚩 ${escapeAttr(consigne)}</span>` : ''}
      <strong>${visePassage ? '🚩 Point de passage' : `➡️ Étape ${vise.e.ordre + 1}`} · ${escapeAttr(vise.e.titre)}</strong>
      <span>${temp.cle === 'ici' ? 'Vous êtes dans la zone de l’étape' : `${formaterDistance(vise.distance)} · vers ${DIRECTIONS_CAP[Math.round(vise.cap / 45) % 8]}`}</span>
      <span class="temperature">${temp.texte}</span>
      ${visePassage && decouverte.e !== vise.e ? `<span class="suite-balade">Prochaine découverte : ${escapeAttr(decouverte.e.titre)} · ${formaterDistance(decouverte.distance)}</span>` : ''}
      ${nbAttente ? `<span class="attente-reseau">⏳ ${nbAttente > 1 ? `${nbAttente} validations` : 'Validation'} en attente de réseau</span>` : ''}`;
    // Point de passage atteint : validé tout seul, le marcheur n'a pas à s'arrêter. Le serveur
    // revérifie la position ; s'il refuse (GPS imprécis…), nouvel essai 20 s plus tard au plus tôt.
    const essaiRecent = dernierEssaiAuto?.etapeId === vise.e.id && Date.now() - dernierEssaiAuto.t < 20000;
    if (visePassage && temp.cle === 'ici' && bouton && !bouton.disabled && !essaiRecent) {
      dernierEssaiAuto = { etapeId: vise.e.id, t: Date.now() };
      validerEtapePosition(vise.e.id, null, bouton);
      return;
    }
    if (bouton && !bouton.disabled) {
      bouton.dataset.etape = vise.e.id; // le bouton valide l'étape visée
      bouton.classList.toggle('pret', temp.cle === 'ici');
      bouton.textContent = temp.cle === 'ici' ? '🎉 Vous y êtes ! Valider l’étape' : `📍 Je suis arrivé (encore ~${formaterDistance(vise.distance)})`;
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

// ── Validations en attente de réseau (2026-11-05) ──
// Sans réseau, la validation d'une étape de balade est gardée sur le téléphone avec la position
// mesurée SUR PLACE, l'étape est cochée à l'écran pour continuer, et l'envoi est retenté dès que le
// réseau revient (évènement « online », ouverture des parcours, et toutes les 30 s s'il reste des envois).
const CLE_VALIDATIONS_EN_ATTENTE = 'agora_validations_en_attente';

function lireValidationsEnAttente() {
  try { return JSON.parse(localStorage.getItem(CLE_VALIDATIONS_EN_ATTENTE) || '[]'); } catch { return []; }
}
function ecrireValidationsEnAttente(liste) {
  try { localStorage.setItem(CLE_VALIDATIONS_EN_ATTENTE, JSON.stringify(liste)); } catch { /* stockage indisponible */ }
}

// Coche une étape à l'écran (et les points de passage manqués avant elle, comme le fera le serveur).
function cocherLocalement(chasse, etapeId) {
  const cible = (chasse.etapes || []).find((e) => e.id === etapeId);
  if (!cible) return;
  for (const e of chasse.etapes) {
    if (!e.validee && (e.id === etapeId || (e.ordre < cible.ordre && e.type_contenu === 'aucun'))) {
      e.validee = true;
      chasse.etapes_validees += 1;
    }
  }
  chasse.etape_suivante = [...chasse.etapes].sort((a, b) => a.ordre - b.ordre).find((e) => !e.validee) || null;
}

function appliquerValidationsEnAttente(chasses) {
  for (const v of lireValidationsEnAttente()) {
    const chasse = chasses.find((c) => c.id === v.chasseId);
    if (chasse) cocherLocalement(chasse, v.etapeId);
  }
}

function mettreValidationEnAttente(url, corps, etapeId) {
  const chasseOuverte = chassesCache.find((c) => c.id === idChasseDetailOuverte);
  // Étape énigme sans réponse : sa question vient du serveur, impossible de la poser hors réseau.
  if (corps.reponse == null && chasseOuverte?.etapes?.find((e) => e.id === etapeId)?.type_contenu === 'enigme') {
    afficherToastMessage('📵 Pas de réseau : la question de cette étape s’affichera dès le retour du réseau. Revenez ici à ce moment-là.', 'erreur');
    return;
  }
  const liste = lireValidationsEnAttente();
  if (!liste.some((v) => v.etapeId === etapeId)) liste.push({ url, corps, etapeId, chasseId: idChasseDetailOuverte });
  ecrireValidationsEnAttente(liste);
  afficherToastMessage('⏳ Pas de réseau : étape gardée, elle sera validée dès le retour du réseau.', 'info');
  const chasse = chassesCache.find((c) => c.id === idChasseDetailOuverte);
  if (chasse) { cocherLocalement(chasse, etapeId); renderDetailChasse(chasse); }
}

let envoiEnAttenteEnCours = false;
async function envoyerValidationsEnAttente() {
  const liste = lireValidationsEnAttente();
  if (!liste.length || envoiEnAttenteEnCours || navigator.onLine === false) return;
  envoiEnAttenteEnCours = true;
  let envoyees = 0;
  try {
    for (const v of liste) {
      let res;
      try {
        res = await appelApi(v.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v.corps) });
      } catch { break; } // toujours pas de réseau : on garde la suite pour plus tard
      ecrireValidationsEnAttente(lireValidationsEnAttente().filter((x) => x.etapeId !== v.etapeId));
      envoyees += 1;
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.reussi !== false && !data.etape_enigme) annoncerValidation(data);
      else if (data.erreur !== 'Étape déjà validée') afficherToastMessage(`Une étape gardée hors réseau n'a pas pu être validée : ${data.erreur || 'position trop éloignée'}.`, 'erreur');
    }
  } finally {
    envoiEnAttenteEnCours = false;
  }
  if (envoyees) rechargerApresValidation();
}
window.addEventListener('online', () => envoyerValidationsEnAttente());
setInterval(() => { if (lireValidationsEnAttente().length) envoyerValidationsEnAttente(); }, 30000);

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
    const url = urlJeux('chasses-tresor', '/valider-position');
    const corps = { etape_id, lat: pos.coords.latitude, lng: pos.coords.longitude, ...(reponse != null ? { reponse } : {}) };
    // Pas de réseau : la validation est gardée (avec la position mesurée ici) et renvoyée plus tard.
    if (navigator.onLine === false) { mettreValidationEnAttente(url, corps, etape_id); return; }
    let res;
    try {
      res = await appelApi(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
    } catch {
      mettreValidationEnAttente(url, corps, etape_id);
      return;
    }
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

// Création, ou modification d'un brouillon (brouillon = { id, titre, description, mode,
// rayon_metres }) : tant que rien n'est publié, tout se modifie, y compris le type et l'ordre des
// étapes. Le parcours est toujours enregistré en brouillon (voir publierBrouillon).
async function ouvrirModaleCreationChasse(brouillon = null) {
  let etapesBrouillon = [];
  if (brouillon) {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor/${brouillon.id}/etapes`);
    if (!res.ok) { afficherToastMessage('Impossible de charger les étapes du brouillon.', 'erreur'); return; }
    etapesBrouillon = (await res.json()).etapes;
  }
  const estBalade = brouillon?.mode === 'balade';
  const html = `
    <form id="form-modale-chasse">
      <input type="text" id="titre-chasse-modale" placeholder="Titre de la chasse" maxlength="150" required value="${brouillon ? escapeAttr(brouillon.titre) : ''}">
      <textarea id="description-chasse-modale" placeholder="Description">${brouillon?.description ? escapeAttr(brouillon.description) : ''}</textarea>
      <label style="display:block;margin:8px 0 4px;font-size:13px;color:var(--roseau);">Type</label>
      <select id="mode-chasse-modale">
        <option value="chasse">Chasse au trésor (QR à scanner sur place)</option>
        <option value="balade" ${estBalade ? 'selected' : ''}>Balade guidée (carte + validation GPS)</option>
      </select>
      <div id="ligne-rayon-balade" style="display:${estBalade ? 'block' : 'none'};margin-top:8px;">
        <label style="display:block;margin-bottom:4px;font-size:13px;color:var(--roseau);">Rayon de validation autour de chaque point (mètres)</label>
        <input type="number" id="rayon-chasse-modale" value="${brouillon?.rayon_metres || 50}" min="20" max="500">
      </div>
      <label style="display:block;margin:8px 0 4px;font-size:13px;color:var(--roseau);">📍 Emplacement des étapes</label>
      <p style="font-size:12px;color:var(--roseau);margin-bottom:4px;">Clique sur la carte pour placer chaque étape — pas besoin d'être sur place. Fais glisser un repère pour l'ajuster.</p>
      <div id="carte-creation-chasse" class="mini-carte-position"></div>
      <div id="liste-etapes-chasse-modale"></div>
      <button type="button" id="btn-ajouter-etape-modale" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);">+ Ajouter une étape</button>
      <p style="font-size:12px;color:var(--roseau);margin:10px 0 0;">📝 Enregistré en brouillon : rien n'est visible des habitants avant « Publier ».</p>
      <button type="submit" style="margin-top:12px;">Enregistrer le brouillon</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(brouillon ? 'Modifier le brouillon' : 'Créer une chasse au trésor', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  compteurEtapes = 0;
  corps.dataset.mode = estBalade ? 'balade' : 'chasse';

  corps.querySelector('#mode-chasse-modale').addEventListener('change', (e) => {
    corps.querySelector('#ligne-rayon-balade').style.display = e.target.value === 'balade' ? 'block' : 'none';
    corps.dataset.mode = e.target.value;
    appliquerModeAuxEtapes(corps);
  });

  initCarteCreationChasse(corps);
  corps.querySelector('#btn-ajouter-etape-modale').addEventListener('click', () => ajouterLigneEtape(corps));
  if (etapesBrouillon.length) {
    etapesBrouillon.forEach((e) => ajouterLigneEtape(corps, e, true));
    setTimeout(() => {
      carteCreationChasse.fitBounds(L.featureGroup([...marqueursEtapesChasse.values()]).getBounds().pad(0.25));
    }, 120);
  } else {
    ajouterLigneEtape(corps);
  }

  corps.querySelector('#form-modale-chasse').addEventListener('submit', async (e) => {
    e.preventDefault();
    await soumettreChasse(corps, overlay, brouillon?.id ?? null);
  });
}

// Numérotation des étapes (titres et repères de la carte) d'après leur ordre réel dans la liste,
// après un ajout, un retrait ou un déplacement ↑↓.
function renumeroterEtapes(corps) {
  corps.querySelectorAll('.ligne-etape-chasse').forEach((ligne, i) => {
    ligne.dataset.numero = i + 1;
    ligne.querySelector('.numero-etape').textContent = `Étape ${i + 1}`;
    ligne.querySelector('.entete-etape .pastille-numero-etape').textContent = i + 1;
    marqueursEtapesChasse.get(ligne.dataset.etapeId)?.setIcon(L.divIcon({
      className: 'pastille-numero-etape', html: String(i + 1), iconSize: [26, 26], iconAnchor: [13, 13],
    }));
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
  majEtatPosition(ligne);
}

// etapeExistante (optionnel) : pré-remplit la ligne (modification) et garde l'id réel de l'étape
// (dataset.dbId). modifiable : boutons « Retirer » et ↑↓ — création et brouillon ; pas pour un
// parcours publié (ouvrirModaleEditionChasse), qui ne se restructure plus une fois joué.
function ajouterLigneEtape(corps, etapeExistante = null, modifiable = !etapeExistante) {
  compteurEtapes++;
  const n = compteurEtapes;
  const conteneur = corps.querySelector('#liste-etapes-chasse-modale');
  const ligne = document.createElement('div');
  ligne.className = 'ligne-etape-chasse';
  ligne.dataset.etapeId = n;
  ligne.dataset.numero = etapeExistante ? etapeExistante.ordre + 1 : n;
  if (etapeExistante) ligne.dataset.dbId = etapeExistante.id;
  if (etapeExistante?.photo_r2_key) ligne.dataset.photoActuelle = etapeExistante.photo_r2_key;
  ligne.innerHTML = `
    <div class="entete-etape">
      <span class="pastille-numero-etape"></span>
      <strong class="numero-etape"></strong>
      ${modifiable ? `<span class="outils-etape">
        <button type="button" class="btn-monter-etape" title="Monter" aria-label="Monter l'étape">↑</button>
        <button type="button" class="btn-descendre-etape" title="Descendre" aria-label="Descendre l'étape">↓</button>
        <button type="button" class="btn-supprimer-etape" title="Retirer" aria-label="Retirer l'étape">🗑️</button>
      </span>` : ''}
    </div>
    <input type="text" class="etape-titre" placeholder="Titre de l'étape" maxlength="150" value="${etapeExistante ? escapeAttr(etapeExistante.titre) : ''}">
    <textarea class="etape-indice" rows="2" maxlength="500">${etapeExistante ? escapeAttr(etapeExistante.indice) : ''}</textarea>
    <div class="position-etape">
      <span class="etat-position"></span>
      <button type="button" class="btn-position-etape">📍 Ma position</button>
    </div>
    <details class="coordonnees-etape">
      <summary>Saisir les coordonnées GPS</summary>
      <div class="grille-coordonnees">
        <input type="number" step="any" class="etape-lat" placeholder="Latitude" value="${etapeExistante ? etapeExistante.lat : ''}">
        <input type="number" step="any" class="etape-lng" placeholder="Longitude" value="${etapeExistante ? etapeExistante.lng : ''}">
      </div>
    </details>
    <label class="libelle-etape">À l'arrivée sur place :</label>
    <select class="etape-type">
      <option value="aucun">🚩 Point de passage (balisage, direction)</option>
      <option value="texte">Une découverte (texte + photo)</option>
      ${etapeExistante?.type_contenu === 'photo' ? '<option value="photo">Une photo seule</option>' : ''}
      <option value="enigme">Une énigme (réponse à saisir)</option>
    </select>
    <div class="etape-champs-contenu"></div>
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
    renumeroterEtapes(corps);
  });
  ligne.querySelector('.btn-monter-etape')?.addEventListener('click', () => {
    if (ligne.previousElementSibling) { ligne.previousElementSibling.before(ligne); renumeroterEtapes(corps); }
  });
  ligne.querySelector('.btn-descendre-etape')?.addEventListener('click', () => {
    if (ligne.nextElementSibling) { ligne.nextElementSibling.after(ligne); renumeroterEtapes(corps); }
  });
  conteneur.appendChild(ligne);
  majEtatPosition(ligne);
  renumeroterEtapes(corps);
  appliquerModeAuxEtapes(corps);
  return ligne;
}

// L'indice n'a de sens qu'en chasse (lieu à deviner) : en balade, les points sont déjà sur la carte,
// il devient une indication facultative (2026-11-13). corps.dataset.mode = 'chasse' | 'balade'.
function appliquerModeAuxEtapes(corps) {
  const balade = corps.dataset.mode === 'balade';
  corps.querySelectorAll('.etape-indice').forEach((t) => {
    t.placeholder = balade
      ? 'Indication pour s’y rendre (facultatif) : le point est déjà sur la carte'
      : 'Indice pour trouver le lieu';
  });
}

function majEtatPosition(ligne) {
  const placee = ligne.querySelector('.etape-lat').value && ligne.querySelector('.etape-lng').value;
  const etat = ligne.querySelector('.etat-position');
  etat.classList.toggle('placee', !!placee);
  etat.textContent = placee ? '✓ Placée sur la carte' : 'À placer : cliquez sur la carte';
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
      if (!val('.etape-indice') && corps.dataset.mode !== 'balade') manque.push('l’indice');
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

async function soumettreChasse(corps, overlay, brouillonId = null) {
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
    // Brouillon : l'étape déjà enregistrée garde son id (et son QR code déjà imprimé).
    if (brouillonId && ligne.dataset.dbId) etape.id = ligne.dataset.dbId;
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
    }
    etapes.push(etape);
  }

  if (!etapes.length) {
    afficherToastMessage('Ajoute au moins une étape complète (titre, position).', 'erreur');
    return;
  }

  const res = await appelApi(`/${window.COMMUNE_SLUG}/chasses-tresor${brouillonId ? `/${brouillonId}` : ''}`, {
    method: brouillonId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ titre, description, mode, rayon_metres, etapes }),
  });

  if (res.ok) {
    fermerModaleFormulaire(overlay);
    // Nouveau brouillon : on l'ouvre directement, prêt à être testé.
    if (!brouillonId) idChasseDetailOuverte = (await res.json()).chasse_id;
    chargerChasses();
    afficherToastMessage(brouillonId
      ? 'Brouillon mis à jour.'
      : 'Brouillon enregistré : testez-le, puis publiez-le quand il est prêt.', 'succes');
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
  corps.dataset.mode = estBalade ? 'balade' : 'chasse';
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
    } else if (type_contenu === 'aucun') {
      // Sans cet envoi, chaque « Modifier » effaçait la consigne du point de passage (corrigé 2026-11-13).
      const consigne = ligne.querySelector('.etape-contenu')?.value.trim();
      if (consigne) etape.contenu = consigne;
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
