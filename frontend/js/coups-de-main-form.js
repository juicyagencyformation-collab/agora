// frontend/js/coups-de-main-form.js
function initFormulaireCoupDeMain() {
  initFiltresTypeAnnonces();
  const btn = document.getElementById('btn-ouvrir-creation-coup-de-main');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationCoupDeMain());
}

// annonce fournie = édition (PATCH, préremplie) ; sinon création (POST).
function ouvrirModaleCreationCoupDeMain(annonce = null) {
  const sel = (v, valeur) => v === valeur ? 'selected' : '';
  // Raccourcis de création : un clic préremplit titre + catégorie (toujours modifiables).
  const SUGGESTIONS = [
    ['🚗 Covoiturage', 'Covoiturage', 'transport'],
    ['👶 Garde d\'enfants', 'Garde d\'enfants', 'garde_enfants'],
    ['🔧 Prêt d\'outils', 'Prêt d\'outils', 'bricolage'],
    ['🌱 Jardin', 'Coup de main au jardin', 'jardinage'],
    ['🛒 Courses', 'Courses pour un voisin', 'courses'],
    ['📦 Aide ponctuelle', 'Aide ponctuelle', 'autre'],
  ];
  const puces = annonce ? '' : `
      <div class="filtres-categorie-articles" id="suggestions-annonce" style="flex-wrap:wrap;">
        <span style="width:100%;font-size:12px;color:var(--roseau);">Idées d'annonces :</span>
        ${SUGGESTIONS.map(([libelle], i) => `<button type="button" class="filtre-categorie-btn" data-i="${i}">${libelle}</button>`).join('')}
      </div>`;
  const html = `
    <form id="form-modale-annonce">${puces}
      <input name="titre" placeholder="Titre" required value="${annonce ? escapeAttr(annonce.titre) : ''}">
      <textarea name="description" placeholder="Description" required>${annonce ? escapeAttr(annonce.description) : ''}</textarea>
      <select name="type">
        <option value="offre" ${annonce ? sel(annonce.type, 'offre') : ''}>Offre</option>
        <option value="demande" ${annonce ? sel(annonce.type, 'demande') : ''}>Demande</option>
      </select>
      <select name="categorie">
        <option value="bricolage" ${annonce ? sel(annonce.categorie, 'bricolage') : ''}>Bricolage</option>
        <option value="jardinage" ${annonce ? sel(annonce.categorie, 'jardinage') : ''}>Jardinage</option>
        <option value="garde_enfants" ${annonce ? sel(annonce.categorie, 'garde_enfants') : ''}>Garde d'enfants</option>
        <option value="transport" ${annonce ? sel(annonce.categorie, 'transport') : ''}>Transport</option>
        <option value="courses" ${annonce ? sel(annonce.categorie, 'courses') : ''}>Courses</option>
        <option value="informatique" ${annonce ? sel(annonce.categorie, 'informatique') : ''}>Informatique</option>
        <option value="cuisine" ${annonce ? sel(annonce.categorie, 'cuisine') : ''}>Cuisine</option>
        <option value="autre" ${annonce ? sel(annonce.categorie, 'autre') : ''}>Autre</option>
      </select>
      <input name="prix" placeholder="Prix (optionnel — ex: gratuit, 15€, à débattre)" value="${annonce ? escapeAttr(annonce.prix || '') : ''}">
      <input name="contact" placeholder="Contact — téléphone ou email (optionnel)" value="${annonce ? escapeAttr(annonce.contact || '') : ''}">
      <input name="disponibilites" placeholder="Disponibilités (optionnel — ex: week-ends, soirées)" value="${annonce ? escapeAttr(annonce.disponibilites || '') : ''}">
      <label class="label-champ-edition">${annonce ? 'Prolonger de (jours, optionnel)' : 'Durée de l\'annonce (jours)'}</label>
      <input name="duree_jours" type="number" ${annonce ? 'placeholder="Laisser vide pour ne pas changer"' : 'value="30"'}>
      <label class="label-champ-edition">Photo (optionnel)</label>
      <div id="photo-existante-annonce"></div>
      <input type="file" id="photo-annonce-modale" accept="image/jpeg,image/png,image/webp">
      <button type="submit" style="margin-top:12px;">${annonce ? 'Mettre à jour' : 'Publier'}</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(annonce ? 'Modifier l\'annonce' : 'Publier une annonce', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelectorAll('#suggestions-annonce button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [, titre, categorie] = SUGGESTIONS[btn.dataset.i];
      const form = corps.querySelector('#form-modale-annonce');
      form.titre.value = titre;
      form.categorie.value = categorie;
      corps.querySelectorAll('#suggestions-annonce button').forEach((b) => b.classList.toggle('active', b === btn));
      form.description.focus();
    });
  });

  // Photo existante (édition) : un bouton × la marque pour retrait à l'enregistrement — même
  // logique que la bannière/photo de profil (profil.js), pas de suppression avant validation.
  let photoRetiree = false;
  const zonePhotoExistante = corps.querySelector('#photo-existante-annonce');
  const rendrePhotoExistante = () => {
    if (!annonce?.photo_url || photoRetiree) { zonePhotoExistante.innerHTML = ''; return; }
    zonePhotoExistante.innerHTML = `
      <div class="vignette-image-editable" style="display:inline-flex;">
        <img src="${annonce.photo_url}" class="apercu-image-modale">
        <button type="button" class="btn-retirer-image" title="Retirer">×</button>
      </div>
    `;
    zonePhotoExistante.querySelector('.btn-retirer-image').addEventListener('click', () => {
      photoRetiree = true;
      rendrePhotoExistante();
    });
  };
  rendrePhotoExistante();

  corps.querySelector('#form-modale-annonce').addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = Object.fromEntries(new FormData(e.target));
    const dureeSaisie = Number(donnees.duree_jours);

    const fichierPhoto = corps.querySelector('#photo-annonce-modale').files[0];
    let photo_r2_key;
    if (fichierPhoto) {
      try {
        const compresse = await compresserImage(fichierPhoto);
        const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main/upload`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (resUpload.ok) { ({ key: photo_r2_key } = await resUpload.json()); }
        else { const d = await resUpload.json().catch(() => ({})); alert(d.erreur || 'Échec de l\'envoi de la photo.'); return; }
      } catch { alert('Échec de l\'envoi de la photo.'); return; }
    } else if (photoRetiree) {
      photo_r2_key = null;
    }

    const res = annonce
      ? await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main/${annonce.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: donnees.type, titre: donnees.titre, description: donnees.description,
            categorie: donnees.categorie, prix: donnees.prix, contact: donnees.contact, disponibilites: donnees.disponibilites,
            ...(dureeSaisie > 0 ? { duree_jours: dureeSaisie } : {}),
            ...(photo_r2_key !== undefined ? { photo_r2_key } : {}),
          }),
        })
      : await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: donnees.type, titre: donnees.titre, description: donnees.description,
            categorie: donnees.categorie, prix: donnees.prix, contact: donnees.contact, disponibilites: donnees.disponibilites,
            duree_jours: dureeSaisie > 0 ? dureeSaisie : 30,
            ...(photo_r2_key ? { photo_r2_key } : {}),
          }),
        });

    if (res.ok) {
      if (!annonce) traiterRecompense(await res.clone().json());
      fermerModaleFormulaire(overlay);
      chargerCoupsDeMain();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur');
    }
  });
}

// Version minimale, accessible depuis l'accueil ("Demander de l'aide") : seule la
// description est à remplir, le reste est préréglé (demande / Autre / 30 jours).
function ouvrirModaleDemandeAideRapide() {
  const html = `
    <form id="form-modale-demande-aide-rapide">
      <p style="font-size:12.5px;color:var(--roseau);margin:0 0 10px;">Décrivez en quelques mots de quoi vous avez besoin. Votre nom apparaîtra sur l'annonce.</p>
      <textarea name="description" placeholder="Ex : besoin d'aide pour déplacer un meuble samedi matin" required></textarea>
      <button type="submit" style="margin-top:12px;">Publier ma demande</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Demander un coup de main', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-demande-aide-rapide').addEventListener('submit', async (e) => {
    e.preventDefault();
    const description = new FormData(e.target).get('description');
    const res = await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'demande', titre: 'Besoin d\'un coup de main', description,
        categorie: 'autre', duree_jours: 30,
      }),
    });
    if (res.ok) {
      traiterRecompense(await res.clone().json());
      fermerModaleFormulaire(overlay);
      afficherToastMessage('Votre demande a été publiée !', 'succes');
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de publication');
    }
  });
}
