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
  const html = `
    <form id="form-modale-annonce">
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
      <button type="submit" style="margin-top:12px;">${annonce ? 'Mettre à jour' : 'Publier'}</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(annonce ? 'Modifier l\'annonce' : 'Publier une annonce', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-annonce').addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = Object.fromEntries(new FormData(e.target));
    const dureeSaisie = Number(donnees.duree_jours);

    const res = annonce
      ? await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main/${annonce.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: donnees.type, titre: donnees.titre, description: donnees.description,
            categorie: donnees.categorie, prix: donnees.prix, contact: donnees.contact, disponibilites: donnees.disponibilites,
            ...(dureeSaisie > 0 ? { duree_jours: dureeSaisie } : {}),
          }),
        })
      : await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: donnees.type, titre: donnees.titre, description: donnees.description,
            categorie: donnees.categorie, prix: donnees.prix, contact: donnees.contact, disponibilites: donnees.disponibilites,
            duree_jours: dureeSaisie > 0 ? dureeSaisie : 30,
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
