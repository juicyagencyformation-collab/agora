// frontend/js/annuaire.js
const LABELS_CATEGORIE_ANNUAIRE = {
  commerce: 'Commerce', artisan: 'Artisan', association: 'Association',
  service_public: 'Service public', professionnel: 'Professionnel', autre: 'Autre',
};

let maFicheAnnuaireActuelle = null;

async function chargerAnnuaire(filtreCategorie = null) {
  const url = new URL(`${window.API_BASE}/${window.COMMUNE_SLUG}/annuaire`);
  if (filtreCategorie) url.searchParams.set('categorie', filtreCategorie);

  const res = await appelApi(url);
  if (!res.ok) return;
  const { fiches } = await res.json();
  const conteneur = document.getElementById('liste-annuaire');
  conteneur.innerHTML = '';
  if (!fiches.length) conteneur.innerHTML = `<p class="dechets-vide">Aucune fiche pour l'instant.</p>`;
  fiches.forEach((f) => conteneur.appendChild(renderFicheAnnuaire(f)));

  maFicheAnnuaireActuelle = fiches.find((f) => f.user_id === window.USER_ID) ?? null;
  const btn = document.getElementById('btn-ouvrir-creation-annuaire');
  if (btn) btn.textContent = maFicheAnnuaireActuelle ? '✏️ Modifier ma fiche' : '+ Créer ma fiche';
}

function renderFicheAnnuaire(fiche) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const extrait = fiche.description ? fiche.description.slice(0, 90) : '';

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide">📇</div>
      <div class="texte-entete-article">
        <span class="badge-categorie-article">${LABELS_CATEGORIE_ANNUAIRE[fiche.categorie] ?? fiche.categorie}</span>
        <h3 class="titre-article-compact">${escapeAttr(fiche.nom)}</h3>
        ${extrait ? `<p class="extrait-article-compact">${escapeAttr(extrait)}${fiche.description.length > 90 ? '…' : ''}</p>` : ''}
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
      remplirContenuFicheAnnuaire(zoneDepliee, fiche);
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}

function remplirContenuFicheAnnuaire(zone, fiche) {
  zone.innerHTML = `
    ${fiche.description ? `<p>${escapeAttr(fiche.description)}</p>` : ''}
    ${fiche.telephone ? `<p>📞 ${escapeAttr(fiche.telephone)}</p>` : ''}
    ${fiche.email ? `<p>✉️ ${escapeAttr(fiche.email)}</p>` : ''}
  `;

  const estProprietaire = fiche.user_id === window.USER_ID;
  if (estProprietaire || ['admin', 'elu', 'superadmin'].includes(window.ROLE)) {
    const bar = document.createElement('div');
    bar.className = 'actions-admin';
    bar.innerHTML = `<button data-action="supprimer">Supprimer</button>`;
    bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer cette fiche ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}`, { method: 'DELETE' });
      chargerAnnuaire();
    });
    zone.appendChild(bar);
  }
}

function initFormulaireAnnuaire() {
  const btn = document.getElementById('btn-ouvrir-creation-annuaire');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleAnnuaire());
}

function ouvrirModaleAnnuaire() {
  const fiche = maFicheAnnuaireActuelle;
  const html = `
    <form id="form-modale-annuaire">
      <input type="text" id="nom-annuaire-modale" placeholder="Nom (personne, commerce, association...)" maxlength="150" required value="${fiche ? escapeAttr(fiche.nom) : ''}">
      <select id="categorie-annuaire-modale">
        ${Object.entries(LABELS_CATEGORIE_ANNUAIRE).map(([cle, label]) =>
          `<option value="${cle}" ${fiche?.categorie === cle ? 'selected' : ''}>${label}</option>`
        ).join('')}
      </select>
      <textarea id="description-annuaire-modale" placeholder="Description">${fiche ? escapeAttr(fiche.description || '') : ''}</textarea>
      <input type="tel" id="telephone-annuaire-modale" placeholder="Téléphone (optionnel)" value="${fiche ? escapeAttr(fiche.telephone || '') : ''}">
      <input type="email" id="email-annuaire-modale" placeholder="Email (optionnel)" value="${fiche ? escapeAttr(fiche.email || '') : ''}">
      <button type="submit" style="margin-top:12px;">${fiche ? 'Mettre à jour' : 'Créer ma fiche'}</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(fiche ? 'Modifier ma fiche' : 'Créer ma fiche', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-annuaire').addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = {
      nom: corps.querySelector('#nom-annuaire-modale').value.trim(),
      categorie: corps.querySelector('#categorie-annuaire-modale').value,
      description: corps.querySelector('#description-annuaire-modale').value.trim(),
      telephone: corps.querySelector('#telephone-annuaire-modale').value.trim(),
      email: corps.querySelector('#email-annuaire-modale').value.trim(),
    };
    if (!donnees.nom) return;

    const res = fiche
      ? await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(donnees),
        })
      : await appelApi(`/${window.COMMUNE_SLUG}/annuaire`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(donnees),
        });

    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerAnnuaire();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur');
    }
  });
}
