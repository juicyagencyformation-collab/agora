// frontend/js/photo-du-jour.js

async function chargerPhotoDuJour() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour`);
  if (!res.ok) return;
  const { photos, publications_aujourdhui, max_par_jour, deja_publiee_aujourdhui } = await res.json();

  const conteneur = document.getElementById('grille-photos-jour');
  conteneur.innerHTML = '';
  if (!photos.length) {
    conteneur.innerHTML = `<p class="dechets-vide">Aucune photo pour l'instant — soyez le premier !</p>`;
  }
  const medailles = calculerMedailles(photos);
  photos.forEach((p) => conteneur.appendChild(renderPhotoDuJour(p, medailles.get(p.id))));

  const btnCreation = document.getElementById('btn-ouvrir-creation-photo-jour');
  const compteur = document.getElementById('compteur-publications-jour');
  if (btnCreation) {
    btnCreation.hidden = deja_publiee_aujourdhui;
  }
  if (compteur) {
    compteur.textContent = max_par_jour > 1 ? `${publications_aujourdhui}/${max_par_jour} photo(s) publiée(s) aujourd'hui` : '';
  }
}

// Médailles discrètes sur les 3 photos les plus aimées de la galerie (au moins 1 like requis)
function calculerMedailles(photos) {
  const emojis = ['🥇', '🥈', '🥉'];
  const classees = photos.filter((p) => p.total_likes > 0).sort((a, b) => b.total_likes - a.total_likes);
  const medailles = new Map();
  classees.slice(0, 3).forEach((p, i) => medailles.set(p.id, emojis[i]));
  return medailles;
}

function renderPhotoDuJour(p, medaille) {
  const el = document.createElement('div');
  el.className = 'carte-photo-jour';

  const netteforcee = p.est_moi || p.force_deflout;
  const flou = netteforcee ? 0 : Math.max(0, Math.round(16 * (1 - p.total_validations / p.seuil_validations)));
  const estGestionnairePhoto = ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);

  el.innerHTML = `
    <img src="${p.url}" style="filter:blur(${flou}px);" loading="lazy">
    ${p.libre_de_droit ? '<span class="ruban-libre-droit">Libre de droit</span>' : ''}
    ${medaille ? `<span class="medaille-photo">${medaille}</span>` : ''}
    <div class="overlay-photo-jour">
      <button class="btn-like-photo ${p.deja_like ? 'like-actif' : ''}">❤️ ${p.total_likes}</button>
      ${p.est_moi ? `
        <label class="toggle-libre-droit">
          <input type="checkbox" class="case-libre-droit" ${p.libre_de_droit ? 'checked' : ''}>
          Libre de droit
        </label>
      ` : `
        <button class="btn-valider-photo" ${p.deja_valide ? 'disabled' : ''}>${p.deja_valide ? '✓ Validée' : `👍 ${p.total_validations}/${p.seuil_validations}`}</button>
        <button class="btn-signaler-photo" ${p.deja_signale ? 'disabled' : ''}>${p.deja_signale ? 'Signalée' : '🚩'}</button>
        ${estGestionnairePhoto && flou > 0 ? '<button class="btn-deflouter-photo">👁️ Déflouter</button>' : ''}
      `}
    </div>
    ${p.est_moi ? '<span class="pastille-ma-photo" title="Personne, vous y compris, ne peut valider votre propre photo">ℹ️ Votre photo</span>' : ''}
  `;

  el.querySelector('img').addEventListener('click', () => ouvrirLightbox(p.url, `blur(${flou}px)`));

  el.querySelector('.btn-like-photo').addEventListener('click', async () => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/${p.id}/liker`, { method: 'POST' });
    if (!res.ok) { const d = await res.json(); alert(d.erreur || 'Erreur'); return; }
    chargerPhotoDuJour();
  });

  el.querySelector('.case-libre-droit')?.addEventListener('change', async (e) => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/${p.id}/libre-de-droit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ libre_de_droit: e.target.checked }),
    });
    if (!res.ok) { e.target.checked = !e.target.checked; afficherToastMessage('Erreur lors de la mise à jour.', 'erreur'); return; }
    chargerPhotoDuJour();
  });

  if (!p.est_moi) {
    el.querySelector('.btn-valider-photo').addEventListener('click', async () => {
      const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/${p.id}/valider`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); alert(d.erreur || 'Erreur'); return; }
      traiterRecompense(await res.clone().json());
      chargerPhotoDuJour();
    });
    el.querySelector('.btn-signaler-photo').addEventListener('click', async () => {
      if (!confirm('Signaler cette photo comme inappropriée ? Elle sera masquée en attente de revue par la mairie.')) return;
      const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/${p.id}/signaler`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); alert(d.erreur || 'Erreur'); return; }
      chargerPhotoDuJour();
    });
    el.querySelector('.btn-deflouter-photo')?.addEventListener('click', async () => {
      const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/${p.id}/deflouter`, { method: 'PATCH' });
      if (!res.ok) { const d = await res.json(); alert(d.erreur || 'Erreur'); return; }
      chargerPhotoDuJour();
    });
  }

  return el;
}

function initFormulairePhotoDuJour() {
  const btn = document.getElementById('btn-ouvrir-creation-photo-jour');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationPhotoJour());
}

function ouvrirModaleCreationPhotoJour() {
  const html = `
    <form id="form-modale-photo-jour">
      <input type="file" id="fichier-photo-jour-modale" accept="image/*" required>
      <label style="font-size:12.5px;color:var(--roseau);display:flex;align-items:center;gap:6px;margin:8px 0;">
        <input type="checkbox" id="libre-droit-photo-jour-modale" style="width:auto;margin:0;">
        J'autorise la mairie à réutiliser cette photo (libre de droit)
      </label>
      <button type="submit">Publier ma photo du jour</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Photo du jour', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-photo-jour').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fichier = corps.querySelector('#fichier-photo-jour-modale').files[0];
    if (!fichier) return;
    const libreDeDroit = corps.querySelector('#libre-droit-photo-jour-modale').checked;

    try {
      const compresse = await compresserImage(fichier, 1400, 0.8);
      const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/upload`, {
        method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
      });
      if (!resUpload.ok) { alert('Upload refusé par le serveur.'); return; }
      const { key } = await resUpload.json();

      const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ r2_key: key, libre_de_droit: libreDeDroit }),
      });
      if (res.ok) {
        traiterRecompense(await res.clone().json());
        fermerModaleFormulaire(overlay);
        chargerPhotoDuJour();
      } else {
        const data = await res.json();
        alert(data.erreur || 'Erreur de publication');
      }
    } catch {
      alert('Échec de la publication de la photo.');
    }
  });
}
