// frontend/js/memoire.js
// "La mémoire du village" : récits patrimoniaux des habitants (texte + photos + audio).
const DUREE_MAX_AUDIO_SEC = 300; // 5 min : évite les enregistrements géants qui saturent R2
const LABELS_THEME_MEMOIRE = {
  ecole: "L'école d'autrefois", metiers: 'Les métiers', guerre: 'La guerre',
  fetes: 'Les fêtes', quartier: 'Mon quartier', famille: 'Familles & ancêtres',
  commerces: 'Commerces d\'antan', autre: 'Autre',
};

async function chargerMemoire() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/memoire`);
  if (!res.ok) return;
  const { souvenirs } = await res.json();
  const conteneur = document.getElementById('liste-souvenirs');
  conteneur.innerHTML = '';
  if (!souvenirs.length) {
    conteneur.innerHTML = `<p class="dechets-vide">Aucun souvenir partagé pour l'instant. Soyez le premier à raconter une histoire du village !</p>`;
  }
  souvenirs.forEach((s) => conteneur.appendChild(renderSouvenir(s)));
}

function renderSouvenir(s) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  el.dataset.souvenirId = s.id;
  const date = new Date(s.created_at).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const extraitBrut = (s.recit || (s.audio_url ? '🎙️ Témoignage audio' : '')).replace(/\s+/g, ' ').trim();
  const extrait = extraitBrut.slice(0, 90);
  const miniature = s.images?.[0]?.url;

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      ${miniature ? `<img src="${miniature}" class="miniature-liste-article">` : '<div class="miniature-liste-article miniature-vide">📖</div>'}
      <div class="texte-entete-article">
        <span class="badge-categorie-article">${LABELS_THEME_MEMOIRE[s.theme] ?? s.theme}</span>
        <h3 class="titre-article-compact">${escapeAttr(s.titre)}</h3>
        <p class="extrait-article-compact">${escapeAttr(extrait)}${extraitBrut.length > 90 ? '…' : ''}</p>
        <span class="date-article-compact">${escapeAttr(s.auteur_prenom)} ${escapeAttr(s.auteur_nom)} · ${date}${s.audio_url ? ' · 🎙️' : ''}</span>
      </div>
    </button>
    <div class="contenu-article-deplie" hidden></div>
  `;

  const zone = el.querySelector('.contenu-article-deplie');
  let deploye = false;
  el.querySelector('.entete-article-compact').addEventListener('click', () => {
    deploye = !deploye;
    zone.hidden = !deploye;
    if (deploye && zone.dataset.rempli !== 'true') { remplirSouvenir(zone, s); zone.dataset.rempli = 'true'; }
  });
  return el;
}

function remplirSouvenir(zone, s) {
  let html = '';
  if (s.recit) html += `<p>${texteAvecLiensCliquables(s.recit)}</p>`;
  if (s.audio_url) html += `<audio controls preload="none" src="${s.audio_url}" style="width:100%;margin:8px 0;"></audio>`;
  html += '<div class="images-article"></div>';
  zone.innerHTML = html;

  const zoneImages = zone.querySelector('.images-article');
  (s.images || []).forEach((img) => {
    const el = document.createElement('img');
    el.src = img.url; el.loading = 'lazy'; el.className = 'miniature-article';
    el.addEventListener('click', () => ouvrirLightbox(img.url));
    zoneImages.appendChild(el);
  });

  const peutGerer = s.est_moi || ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);
  let boutons = '';
  if (peutGerer) boutons += `<button data-action="modifier">Modifier</button><button data-action="supprimer">Supprimer</button>`;
  if (!s.est_moi && !s.deja_signale) boutons += `<button data-action="signaler">Signaler</button>`;
  if (!boutons) return;

  const bar = document.createElement('div');
  bar.className = 'actions-admin';
  bar.innerHTML = boutons;
  bar.querySelector('[data-action="modifier"]')?.addEventListener('click', () => ouvrirModaleSouvenir(s));
  bar.querySelector('[data-action="supprimer"]')?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce souvenir ?')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/memoire/${s.id}`, { method: 'DELETE' });
    chargerMemoire();
  });
  bar.querySelector('[data-action="signaler"]')?.addEventListener('click', async () => {
    if (!confirm('Signaler ce souvenir à la mairie ? Il sera masqué en attendant sa revue.')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/memoire/${s.id}/signaler`, { method: 'POST' });
    afficherToastMessage('Merci, la mairie va examiner ce souvenir.', 'succes');
    chargerMemoire();
  });
  zone.appendChild(bar);
}

// ── Formulaire de création / édition ──

function initFormulaireMemoire() {
  const btn = document.getElementById('btn-ouvrir-creation-souvenir');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleSouvenir());
}

// souvenir fourni = édition (titre/récit/thème seulement ; photos et audio non modifiables ici).
function ouvrirModaleSouvenir(souvenir = null) {
  const optionsTheme = Object.entries(LABELS_THEME_MEMOIRE)
    .map(([cle, label]) => `<option value="${cle}" ${souvenir?.theme === cle ? 'selected' : ''}>${label}</option>`).join('');

  const html = `
    <form id="form-souvenir">
      <input type="text" id="titre-souvenir" placeholder="Titre du souvenir" maxlength="150" required value="${souvenir ? escapeAttr(souvenir.titre) : ''}">
      <select id="theme-souvenir">${optionsTheme}</select>
      <textarea id="recit-souvenir" placeholder="Racontez votre souvenir, l'histoire du lieu, de vos ancêtres…" maxlength="10000">${souvenir ? escapeAttr(souvenir.recit || '') : ''}</textarea>
      ${souvenir ? '' : `
        <label style="display:block;margin:10px 0 4px;font-size:13px;color:var(--roseau);">Photos d'époque (optionnel)</label>
        <input type="file" id="photos-souvenir" accept="image/*" multiple>
        <div id="apercu-photos-souvenir" class="apercu-images-modale"></div>
        <label style="display:block;margin:12px 0 4px;font-size:13px;color:var(--roseau);">Témoignage vocal (optionnel)</label>
        <div id="zone-audio-souvenir" class="zone-audio-souvenir">
          <button type="button" id="btn-enregistrer-audio">🎙️ Enregistrer</button>
          <span id="statut-audio" style="font-size:12.5px;color:var(--roseau);"></span>
        </div>
        <div id="apercu-audio-souvenir"></div>
      `}
      <button type="submit" style="margin-top:12px;">${souvenir ? 'Enregistrer' : 'Partager ce souvenir'}</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(souvenir ? 'Modifier le souvenir' : 'Partager un souvenir', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  // État audio (création uniquement).
  let blobAudio = null;
  let mediaRecorder = null;
  let morceaux = [];
  let minuterieAudio = null;
  let arretAutoAudio = null;
  if (!souvenir) {
    initApercuPhotosSouvenir(corps);
    const btnRec = corps.querySelector('#btn-enregistrer-audio');
    const statut = corps.querySelector('#statut-audio');
    const apercuAudio = corps.querySelector('#apercu-audio-souvenir');
    btnRec.addEventListener('click', async () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        afficherToastMessage('Enregistrement audio non supporté sur cet appareil.', 'erreur');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        morceaux = [];
        mediaRecorder.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data); };
        mediaRecorder.onstop = () => {
          clearInterval(minuterieAudio);
          clearTimeout(arretAutoAudio);
          stream.getTracks().forEach((t) => t.stop());
          blobAudio = new Blob(morceaux, { type: mediaRecorder.mimeType });
          btnRec.textContent = '🎙️ Refaire';
          statut.textContent = '';
          apercuAudio.innerHTML = `<audio controls src="${URL.createObjectURL(blobAudio)}" style="width:100%;margin-top:8px;"></audio>`;
        };
        mediaRecorder.start();
        btnRec.textContent = '⏹️ Arrêter';
        // Minuteur visible + arrêt automatique à 5 min (plafond anti-saturation R2).
        const debut = Date.now();
        const dureeMax = `${Math.floor(DUREE_MAX_AUDIO_SEC / 60)}:00`;
        statut.textContent = `0:00 / ${dureeMax}`;
        minuterieAudio = setInterval(() => {
          const s = Math.floor((Date.now() - debut) / 1000);
          statut.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} / ${dureeMax}`;
        }, 1000);
        arretAutoAudio = setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            afficherToastMessage('Durée maximale atteinte (5 min).', 'succes');
          }
        }, DUREE_MAX_AUDIO_SEC * 1000);
      } catch {
        afficherToastMessage('Micro refusé ou indisponible.', 'erreur');
      }
    });
  }

  corps.querySelector('#form-souvenir').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-souvenir').value.trim();
    const theme = corps.querySelector('#theme-souvenir').value;
    const recit = corps.querySelector('#recit-souvenir').value.trim();
    if (!titre) return;

    const boutonSubmit = corps.querySelector('button[type="submit"]');
    boutonSubmit.disabled = true;

    if (souvenir) {
      const res = await appelApi(`/${window.COMMUNE_SLUG}/memoire/${souvenir.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titre, theme, recit }),
      });
      boutonSubmit.disabled = false;
      if (res.ok) { fermerModaleFormulaire(overlay); chargerMemoire(); }
      else { const d = await res.json(); afficherToastMessage(d.erreur ? JSON.stringify(d.erreur) : 'Erreur', 'erreur'); }
      return;
    }

    if (!recit && !blobAudio) {
      afficherToastMessage('Ajoutez un récit écrit ou un enregistrement vocal.', 'erreur');
      boutonSubmit.disabled = false;
      return;
    }

    // Upload des photos.
    const image_r2_keys = [];
    for (const fichier of [...corps.querySelector('#photos-souvenir').files].slice(0, 10)) {
      try {
        const compresse = await compresserImage(fichier);
        const up = await appelApi(`/${window.COMMUNE_SLUG}/memoire/upload-photo`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (up.ok) { const { key } = await up.json(); image_r2_keys.push(key); }
      } catch { console.warn('Upload photo souvenir échoué.'); }
    }

    // Upload de l'audio.
    let audio_r2_key;
    if (blobAudio) {
      try {
        const typeAudio = (blobAudio.type || 'audio/webm').split(';')[0];
        const up = await appelApi(`/${window.COMMUNE_SLUG}/memoire/upload-audio`, {
          method: 'POST', headers: { 'Content-Type': typeAudio }, body: blobAudio,
        });
        if (up.ok) { const { key } = await up.json(); audio_r2_key = key; }
      } catch { console.warn('Upload audio souvenir échoué.'); }
    }

    const res = await appelApi(`/${window.COMMUNE_SLUG}/memoire`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre, theme, recit, image_r2_keys, audio_r2_key }),
    });
    boutonSubmit.disabled = false;
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerMemoire();
      afficherToastMessage('Merci pour ce souvenir ! 📖', 'succes');
    } else {
      const d = await res.json();
      afficherToastMessage(d.erreur ? JSON.stringify(d.erreur) : 'Erreur de publication', 'erreur');
    }
  });
}

function initApercuPhotosSouvenir(corps) {
  const input = corps.querySelector('#photos-souvenir');
  const apercu = corps.querySelector('#apercu-photos-souvenir');
  input.addEventListener('change', () => {
    apercu.innerHTML = '';
    [...input.files].slice(0, 10).forEach((fichier) => {
      const img = document.createElement('img');
      img.className = 'apercu-image-modale';
      img.src = URL.createObjectURL(fichier);
      img.onload = () => URL.revokeObjectURL(img.src);
      apercu.appendChild(img);
    });
  });
}
