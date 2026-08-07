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
      ${fiche.logo_url ? `<img src="${fiche.logo_url}" class="miniature-liste-article">` : '<div class="miniature-liste-article miniature-vide">📇</div>'}
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
  const documents = fiche.documents ?? [];
  zone.innerHTML = `
    ${fiche.description ? `<p>${texteAvecLiensCliquables(fiche.description)}</p>` : ''}
    ${fiche.telephone ? `<p style="white-space:pre-line;">📞 ${texteAvecLiensCliquables(fiche.telephone)}</p>` : ''}
    ${fiche.email ? `<p>✉️ <a href="mailto:${escapeAttr(fiche.email)}">${escapeAttr(fiche.email)}</a></p>` : ''}
    ${fiche.site_web ? `<p>🌐 <a href="${escapeAttr(normaliserSiteWeb(fiche.site_web))}" target="_blank" rel="noopener">${escapeAttr(fiche.site_web)}</a></p>` : ''}
    ${documents.length ? `<div class="liste-documents-annuaire">${documents.map(htmlDocumentAnnuaire).join('')}</div>` : ''}
  `;

  const estProprietaire = fiche.user_id === window.USER_ID;
  if (estProprietaire || ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
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

function ouvrirModaleAnnuaire() {
  const fiche = maFicheAnnuaireActuelle;
  const documents = fiche?.documents ?? [];
  const html = `
    <form id="form-modale-annuaire">
      <input type="text" id="nom-annuaire-modale" placeholder="Nom (personne, commerce, association...)" maxlength="150" required value="${fiche ? escapeAttr(fiche.nom) : ''}">
      <select id="categorie-annuaire-modale">
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
  const overlay = ouvrirModaleFormulaire(fiche ? 'Modifier ma fiche' : 'Créer ma fiche', html);
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
      categorie: corps.querySelector('#categorie-annuaire-modale').value,
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
