// frontend/js/annuaire.js
const LABELS_CATEGORIE_ANNUAIRE = {
  commerce: 'Commerce', artisan: 'Artisan', association: 'Association',
  service_public: 'Service public', professionnel: 'Professionnel', autre: 'Autre',
};

let maFicheAnnuaireActuelle = null;

async function chargerAnnuaire(filtreCategorie = null) {
  const url = new URL(`${window.API_BASE}/${window.COMMUNE_SLUG}/annuaire`, window.location.origin);
  if (filtreCategorie) url.searchParams.set('categorie', filtreCategorie);

  const res = await appelApi(url);
  if (!res.ok) return;
  const { fiches, demandes_en_attente: demandes = [] } = await res.json();
  const conteneur = document.getElementById('liste-annuaire');
  conteneur.innerHTML = '';
  if (demandes.length) conteneur.appendChild(renderDemandesAssociations(demandes));
  if (!fiches.length) conteneur.insertAdjacentHTML('beforeend', `<p class="dechets-vide">Aucune fiche pour l'instant.</p>`);
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
      ${fiche.logo_url ? `<img src="${fiche.logo_url}" class="miniature-liste-article">` : '<div class="miniature-liste-article miniature-vide">📇</div>'}
      <div class="texte-entete-article">
        <span class="badge-categorie-article">${LABELS_CATEGORIE_ANNUAIRE[fiche.categorie] ?? fiche.categorie}</span>
        ${fiche.tenue_par_association ? '<span class="badge-categorie-article badge-tenue-association">✔ Tenue par l\'association</span>' : ''}
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
  const documents = fiche.documents ?? [];
  zone.innerHTML = `
    ${fiche.description ? `<p>${texteAvecLiensCliquables(fiche.description)}</p>` : ''}
    ${fiche.telephone ? `<p style="white-space:pre-line;">📞 ${texteAvecLiensCliquables(fiche.telephone)}</p>` : ''}
    ${fiche.email ? `<p>✉️ <a href="mailto:${escapeAttr(fiche.email)}">${escapeAttr(fiche.email)}</a></p>` : ''}
    ${fiche.site_web ? `<p>🌐 <a href="${escapeAttr(normaliserSiteWeb(fiche.site_web))}" target="_blank" rel="noopener">${escapeAttr(fiche.site_web)}</a></p>` : ''}
    ${documents.length ? `<div class="liste-documents-annuaire">${documents.map(htmlDocumentAnnuaire).join('')}</div>` : ''}
  `;

  const estProprietaire = fiche.user_id === window.USER_ID;
  const estGestionnaireAnnuaire = ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);
  const estResponsable = fiche.mon_statut_responsable === 'actif';
  if (estProprietaire || estResponsable || estGestionnaireAnnuaire) {
    const bar = document.createElement('div');
    bar.className = 'actions-admin';
    bar.innerHTML = `<button data-action="modifier">Modifier</button>`
      + (estProprietaire || estGestionnaireAnnuaire ? `<button data-action="supprimer">Supprimer</button>` : '')
      + (estGestionnaireAnnuaire && fiche.categorie === 'association' ? `<button data-action="responsables">👥 Responsables</button>` : '');
    bar.querySelector('[data-action="modifier"]').addEventListener('click', () => ouvrirModaleAnnuaire(fiche));
    bar.querySelector('[data-action="supprimer"]')?.addEventListener('click', async () => {
      if (!confirm('Supprimer cette fiche ?')) return;
      const res = await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}`, { method: 'DELETE' });
      if (!res.ok) { afficherToastMessage((await res.json()).erreur || 'Suppression impossible.', 'erreur'); return; }
      chargerAnnuaire();
    });
    bar.querySelector('[data-action="responsables"]')?.addEventListener('click', () => ouvrirModaleResponsables(fiche));
    zone.appendChild(bar);
  }

  if (fiche.categorie === 'association' && !estGestionnaireAnnuaire) {
    zone.appendChild(renderBlocBureauAssociation(fiche));
  }
}

// Habitant face à une fiche d'association : demander à la gérer, suivre sa demande, ou se retirer.
function renderBlocBureauAssociation(fiche) {
  const bloc = document.createElement('div');
  bloc.className = 'bloc-bureau-association';
  const statut = fiche.mon_statut_responsable;
  if (statut === 'actif') {
    bloc.innerHTML = `<p>✔ Vous gérez cette association : vous pouvez tenir sa fiche à jour.</p>
      <button type="button" class="lien-discret">Ne plus gérer cette association</button>`;
  } else if (statut === 'demande') {
    bloc.innerHTML = `<p>⏳ Votre demande est en attente de validation par la mairie.</p>
      <button type="button" class="lien-discret">Annuler ma demande</button>`;
  } else {
    bloc.innerHTML = `<button type="button" class="bouton-bureau-association">🙋 Je fais partie du bureau</button>`;
  }

  bloc.querySelector('button').addEventListener('click', async () => {
    if (statut) {
      const question = statut === 'actif' ? 'Ne plus gérer cette association ?' : 'Annuler votre demande ?';
      if (!confirm(question)) return;
      await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}/responsables/quitter`, { method: 'POST' });
    } else {
      if (!confirm(`Demander à gérer la fiche « ${fiche.nom} » ?\n\nLa mairie validera votre demande. Vous pourrez ensuite tenir la fiche à jour au nom de l'association.`)) return;
      const res = await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}/responsables/demande`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { afficherToastMessage(data.erreur || 'Demande impossible pour le moment.', 'erreur'); return; }
      afficherToastMessage('Demande envoyée à la mairie.');
    }
    chargerAnnuaire();
  });
  return bloc;
}

// Gestionnaires : demandes « Je fais partie du bureau » en attente, en tête de l'annuaire.
function renderDemandesAssociations(demandes) {
  const bloc = document.createElement('details');
  bloc.className = 'demandes-associations';
  bloc.open = true;
  bloc.innerHTML = `<summary>🤝 ${demandes.length} demande${demandes.length > 1 ? 's' : ''} d'association à valider</summary>`
    + demandes.map((d) => `
      <div class="ligne-responsable-association">
        <span><strong>${escapeAttr(`${d.prenom} ${d.nom}`.trim())}</strong> souhaite gérer « ${escapeAttr(d.fiche_nom || '')} »</span>
        <span class="actions-ligne-responsable">
          <button type="button" data-valider="${d.id}" data-fiche="${d.fiche_id}">Valider</button>
          <button type="button" data-refuser="${d.id}" data-fiche="${d.fiche_id}">Refuser</button>
        </span>
      </div>`).join('');

  bloc.querySelectorAll('[data-valider]').forEach((btn) => btn.addEventListener('click', async () => {
    await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${btn.dataset.fiche}/responsables/${btn.dataset.valider}`, { method: 'PATCH' });
    chargerAnnuaire();
  }));
  bloc.querySelectorAll('[data-refuser]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Refuser cette demande ?')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${btn.dataset.fiche}/responsables/${btn.dataset.refuser}`, { method: 'DELETE' });
    chargerAnnuaire();
  }));
  return bloc;
}

// Gestionnaires : responsables d'une association (valider, retirer, désigner par email).
async function ouvrirModaleResponsables(fiche) {
  const overlay = ouvrirModaleFormulaire(`Responsables — ${escapeAttr(fiche.nom)}`, '<div id="contenu-modale-responsables">Chargement…</div>');
  const zone = overlay.querySelector('#contenu-modale-responsables');
  const base = `/${window.COMMUNE_SLUG}/annuaire/${fiche.id}/responsables`;

  // Après chaque changement, la liste de l'annuaire derrière la fenêtre suit aussi (badge
  // « Tenue par l'association », demandes en attente).
  async function rafraichir(apresChangement = true) {
    if (apresChangement) chargerAnnuaire();
    const res = await appelApi(base);
    if (!res.ok) { zone.textContent = 'Impossible de charger les responsables.'; return; }
    const { responsables } = await res.json();
    zone.innerHTML = `
      <p class="texte-aide-responsables">Les responsables tiennent la fiche à jour au nom de l'association. Vous gardez la main : catégorie, suppression, et liste des responsables.</p>
      ${responsables.length ? responsables.map((r) => `
        <div class="ligne-responsable-association">
          <span><strong>${escapeAttr(`${r.prenom} ${r.nom}`.trim())}</strong>${r.statut === 'demande' ? ' — <em>demande en attente</em>' : ''}</span>
          <span class="actions-ligne-responsable">
            ${r.statut === 'demande' ? `<button type="button" data-valider="${r.id}">Valider</button>` : ''}
            <button type="button" data-retirer="${r.id}">${r.statut === 'demande' ? 'Refuser' : 'Retirer'}</button>
          </span>
        </div>`).join('') : '<p class="dechets-vide">Aucun responsable pour l\'instant.</p>'}
      <form id="form-ajout-responsable">
        <label class="label-champ-edition">Désigner un habitant déjà inscrit (son adresse email)</label>
        <input type="email" id="email-ajout-responsable" placeholder="president@exemple.fr" maxlength="200" required>
        <button type="submit">Ajouter comme responsable</button>
      </form>`;

    zone.querySelectorAll('[data-valider]').forEach((btn) => btn.addEventListener('click', async () => {
      await appelApi(`${base}/${btn.dataset.valider}`, { method: 'PATCH' });
      rafraichir();
    }));
    zone.querySelectorAll('[data-retirer]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('Retirer ce responsable ?')) return;
      await appelApi(`${base}/${btn.dataset.retirer}`, { method: 'DELETE' });
      rafraichir();
    }));
    zone.querySelector('#form-ajout-responsable').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await appelApi(base, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: zone.querySelector('#email-ajout-responsable').value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { afficherToastMessage(data.erreur || 'Ajout impossible.', 'erreur'); return; }
      afficherToastMessage('Responsable ajouté.');
      rafraichir();
    });
  }

  await rafraichir(false);
}

function htmlDocumentAnnuaire(doc) {
  const icone = doc.type === 'pdf' ? '📄' : '🖼️';
  const nom = doc.nom_original || (doc.type === 'pdf' ? 'Document PDF' : 'Image');
  return `<a href="${escapeAttr(doc.url)}" target="_blank" rel="noopener" class="lien-document-annuaire">${icone} ${escapeAttr(nom)}</a>`;
}

function initFormulaireAnnuaire() {
  const btn = document.getElementById('btn-ouvrir-creation-annuaire');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleAnnuaire());
}

// fiche: passée explicitement quand un gestionnaire modifie la fiche de quelqu'un d'autre
// (bouton "Modifier" de la vue détaillée) ; sinon la sienne, via le bouton "+ Créer ma fiche".
function ouvrirModaleAnnuaire(fiche = maFicheAnnuaireActuelle) {
  const documents = fiche?.documents ?? [];
  // Un responsable d'association (ni créateur, ni mairie) ne change pas la catégorie : le Worker
  // l'ignorerait de toute façon, autant ne pas laisser croire le contraire.
  const categorieVerrouillee = !!fiche && fiche.user_id !== window.USER_ID
    && !['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);
  const html = `
    <form id="form-modale-annuaire">
      <input type="text" id="nom-annuaire-modale" placeholder="Nom (personne, commerce, association...)" maxlength="150" required value="${fiche ? escapeAttr(fiche.nom) : ''}">
      <select id="categorie-annuaire-modale" ${categorieVerrouillee ? 'disabled' : ''}>
        ${Object.entries(LABELS_CATEGORIE_ANNUAIRE).map(([cle, label]) =>
          `<option value="${cle}" ${fiche?.categorie === cle ? 'selected' : ''}>${label}</option>`
        ).join('')}
      </select>
      <textarea id="description-annuaire-modale" placeholder="Description">${fiche ? escapeAttr(fiche.description || '') : ''}</textarea>
      <textarea id="telephone-annuaire-modale" placeholder="Téléphone (optionnel) — un numéro par ligne, ex: Président : 06 12 34 56 78" rows="2">${fiche ? escapeAttr(fiche.telephone || '') : ''}</textarea>
      <input type="email" id="email-annuaire-modale" placeholder="Email (optionnel)" value="${fiche ? escapeAttr(fiche.email || '') : ''}">
      <input type="text" id="site-web-annuaire-modale" placeholder="Site web (optionnel)" value="${fiche ? escapeAttr(fiche.site_web || '') : ''}">

      <label class="label-champ-edition">Logo (optionnel)</label>
      ${fiche?.logo_url ? `<div class="apercu-logo-commune"><img src="${fiche.logo_url}" alt=""></div>` : ''}
      <input type="file" id="logo-annuaire-modale" accept="image/jpeg,image/png,image/webp">

      <label class="label-champ-edition">Documents (statuts, plaquette, photos... — PDF ou image, plusieurs possibles)</label>
      <div id="documents-existants-annuaire-modale">${documents.map((doc) => htmlLigneDocumentModale(doc)).join('')}</div>
      <input type="file" id="documents-annuaire-modale" accept="application/pdf,image/jpeg,image/png,image/webp" multiple>

      <button type="submit" style="margin-top:12px;">${fiche ? 'Mettre à jour' : 'Créer ma fiche'}</button>
    </form>
  `;
  const titreModale = fiche ? (fiche.user_id === window.USER_ID ? 'Modifier ma fiche' : 'Modifier la fiche') : 'Créer ma fiche';
  const overlay = ouvrirModaleFormulaire(titreModale, html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelectorAll('.btn-suppr-document-annuaire-modale').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Supprimer ce document ?')) return;
      const res = await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}/documents/${btn.dataset.docId}`, { method: 'DELETE' });
      if (res.ok) btn.closest('.ligne-document-annuaire-modale').remove();
    });
  });

  corps.querySelector('#form-modale-annuaire').addEventListener('submit', async (e) => {
    e.preventDefault();
    const siteWebSaisi = corps.querySelector('#site-web-annuaire-modale').value.trim();
    const donnees = {
      nom: corps.querySelector('#nom-annuaire-modale').value.trim(),
      ...(categorieVerrouillee ? {} : { categorie: corps.querySelector('#categorie-annuaire-modale').value }),
      description: corps.querySelector('#description-annuaire-modale').value.trim(),
      telephone: corps.querySelector('#telephone-annuaire-modale').value.trim(),
      email: corps.querySelector('#email-annuaire-modale').value.trim(),
      // Normalisé ici (pas seulement à l'affichage) : le backend valide avec z.string().url(),
      // qui exige un protocole — "monasso.fr" seul serait sinon rejeté.
      site_web: siteWebSaisi ? normaliserSiteWeb(siteWebSaisi) : '',
    };
    if (!donnees.nom) return;

    const boutonSubmit = corps.querySelector('button[type="submit"]');
    boutonSubmit.disabled = true;

    // Pas de compresserImage() ici : elle convertit systématiquement en JPEG, ce qui
    // détruirait la transparence d'un logo en PNG (même raison que le logo de la commune).
    const fichierLogo = corps.querySelector('#logo-annuaire-modale').files[0];
    if (fichierLogo) {
      const resLogo = await appelApi(`/${window.COMMUNE_SLUG}/annuaire/logo-upload`, {
        method: 'POST', headers: { 'Content-Type': fichierLogo.type }, body: fichierLogo,
      });
      if (resLogo.ok) { const { key } = await resLogo.json(); donnees.logo_r2_key = key; }
      else { afficherToastMessage('Échec de l\'envoi du logo.', 'erreur'); }
    }

    const fichiersDocuments = [...corps.querySelector('#documents-annuaire-modale').files];
    if (fichiersDocuments.length) {
      donnees.documents = [];
      for (const fichier of fichiersDocuments) {
        const resDoc = await appelApi(`/${window.COMMUNE_SLUG}/annuaire/document-upload`, {
          method: 'POST', headers: { 'Content-Type': fichier.type }, body: fichier,
        });
        if (resDoc.ok) {
          const { key, type } = await resDoc.json();
          donnees.documents.push({ r2_key: key, type, nom_original: fichier.name });
        } else {
          afficherToastMessage(`Échec de l'envoi de "${fichier.name}".`, 'erreur');
        }
      }
    }

    const res = fiche
      ? await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(donnees),
        })
      : await appelApi(`/${window.COMMUNE_SLUG}/annuaire`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(donnees),
        });

    boutonSubmit.disabled = false;

    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerAnnuaire();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur');
    }
  });
}

function htmlLigneDocumentModale(doc) {
  const icone = doc.type === 'pdf' ? '📄' : '🖼️';
  const nom = doc.nom_original || (doc.type === 'pdf' ? 'Document PDF' : 'Image');
  return `
    <div class="ligne-document-annuaire-modale">
      <a href="${escapeAttr(doc.url)}" target="_blank" rel="noopener">${icone} ${escapeAttr(nom)}</a>
      <button type="button" class="btn-suppr-document-annuaire-modale" data-doc-id="${doc.id}">🗑️</button>
    </div>
  `;
}
