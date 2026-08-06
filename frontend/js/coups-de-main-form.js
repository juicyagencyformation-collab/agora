// frontend/js/coups-de-main-form.js
function initFormulaireCoupDeMain() {
  const btn = document.getElementById('btn-ouvrir-creation-coup-de-main');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationCoupDeMain());
}

function ouvrirModaleCreationCoupDeMain() {
  const html = `
    <form id="form-modale-annonce">
      <input name="titre" placeholder="Titre" required>
      <textarea name="description" placeholder="Description" required></textarea>
      <select name="type"><option value="offre">Offre</option><option value="demande">Demande</option></select>
      <select name="categorie">
        <option value="bricolage">Bricolage</option><option value="jardinage">Jardinage</option>
        <option value="garde_enfants">Garde d'enfants</option><option value="transport">Transport</option>
        <option value="courses">Courses</option><option value="autre">Autre</option>
      </select>
      <label class="label-champ-edition">Durée de l'annonce (jours)</label>
      <input name="duree_jours" type="number" value="30">
      <button type="submit" style="margin-top:12px;">Publier</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Publier une annonce', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-annonce').addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = Object.fromEntries(new FormData(e.target));
    const res = await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: donnees.type, titre: donnees.titre, description: donnees.description,
        categorie: donnees.categorie, duree_jours: Number(donnees.duree_jours) || 30,
      }),
    });
    if (res.ok) {
      traiterRecompense(await res.clone().json());
      fermerModaleFormulaire(overlay);
      chargerCoupsDeMain();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de publication');
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
