// frontend/js/coups-de-main.js
const LABELS_CATEGORIE = {
  bricolage: 'Bricolage', jardinage: 'Jardinage', garde_enfants: "Garde d'enfants",
  transport: 'Transport', courses: 'Courses', informatique: 'Informatique',
  cuisine: 'Cuisine', autre: 'Autre',
};

// Couleur de thème par catégorie : liseré de la carte + teinte du badge.
const COULEURS_CATEGORIE = {
  bricolage: '#E8833A', jardinage: '#4CAF50', garde_enfants: '#E86AA6',
  transport: '#3B82C4', courses: '#F0B429', informatique: '#7C5CD6',
  cuisine: '#E4572E', autre: '#8A94A6',
};

let filtreTypeActuel = null;

// Barre de tri Tout / Offres / Demandes (vue principale).
function initFiltresTypeAnnonces() {
  const zone = document.getElementById('filtres-type-annonces');
  if (!zone) return;
  const options = [['', 'Tout'], ['offre', 'Offres'], ['demande', 'Demandes']];
  zone.innerHTML = options.map(([val, label], i) =>
    `<button class="filtre-categorie-btn${i === 0 ? ' active' : ''}" data-type="${val}">${label}</button>`
  ).join('');
  zone.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      zone.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filtreTypeActuel = btn.dataset.type || null;
      chargerCoupsDeMain();
    });
  });
}

// Ouvre une annonce précise (venant d'un lien de notification) : la déplie et y fait défiler.
function ouvrirAnnonceParId(id) {
  const carte = document.querySelector(`[data-annonce-id="${id}"]`);
  if (!carte) return;
  carte.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const zoneDepliee = carte.querySelector('.contenu-article-deplie');
  if (zoneDepliee?.hidden) carte.querySelector('.entete-article-compact').click();
}

async function chargerCoupsDeMain(filtreType = filtreTypeActuel, filtreCategorie = null) {
  const url = new URL(`${window.API_BASE}/${window.COMMUNE_SLUG}/coups-de-main`, window.location.origin);
  if (filtreType) url.searchParams.set('type', filtreType);
  if (filtreCategorie) url.searchParams.set('categorie', filtreCategorie);

  const res = await appelApi(url);
  if (!res.ok) return;
  const { annonces } = await res.json();
  const conteneur = document.getElementById('liste-annonces');
  conteneur.innerHTML = '';
  if (!annonces.length) conteneur.innerHTML = `<p class="dechets-vide">Aucune annonce pour l'instant.</p>`;
  // Les annonces pourvues restent visibles (preuve que l'entraide fonctionne) mais reléguées
  // en bas de liste plutôt que de se mélanger aux annonces encore actives.
  [...annonces].sort((a, b) => (a.pourvu === b.pourvu ? 0 : a.pourvu ? 1 : -1))
    .forEach((a) => conteneur.appendChild(renderAnnonce(a)));
}

function renderAnnonce(annonce) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte carte-annonce-coloree';
  if (annonce.pourvu) el.classList.add('annonce-pourvue');
  el.dataset.annonceId = annonce.id;
  const couleur = COULEURS_CATEGORIE[annonce.categorie] || COULEURS_CATEGORIE.autre;
  el.style.borderLeftColor = couleur;
  const joursRestants = Math.ceil((new Date(annonce.expires_at) - Date.now()) / 86_400_000);
  const extrait = annonce.description.slice(0, 90);
  const miniature = annonce.photo_url
    ? `<img src="${annonce.photo_url}" class="miniature-liste-article" loading="lazy" alt="">`
    : `<div class="miniature-liste-article miniature-vide">${annonce.type === 'offre' ? '🤲' : '🙏'}</div>`;

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      ${miniature}
      <div class="texte-entete-article">
        <div class="badges-event-compact">
          ${annonce.pourvu ? '<span class="badge-statut-alerte badge-statut-resolue">✅ Pourvu</span>' : ''}
          <span class="badge-categorie-article">${annonce.type === 'offre' ? 'Offre' : 'Demande'}</span>
          <span class="badge-categorie-article" style="color:${couleur};background:${couleur}1A;">${LABELS_CATEGORIE[annonce.categorie]}</span>
        </div>
        <h3 class="titre-article-compact">${escapeAttr(annonce.titre)}</h3>
        <p class="extrait-article-compact">${escapeAttr(extrait)}${annonce.description.length > 90 ? '…' : ''}</p>
        <span class="date-article-compact">${escapeAttr(annonce.auteur_prenom)} ${escapeAttr(annonce.auteur_nom)} · expire dans ${joursRestants} jour(s)</span>
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
      const estAuteurOuGestionnaire = annonce.user_id === window.USER_ID || ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);

      zoneDepliee.innerHTML = (annonce.photo_url ? `<img src="${annonce.photo_url}" class="miniature-article" loading="lazy" style="cursor:pointer;margin-bottom:8px;">` : '')
        + `<p>${texteAvecLiensCliquables(annonce.description)}</p>`
        + (annonce.prix ? `<p class="detail-annonce">💶 ${escapeAttr(annonce.prix)}</p>` : '')
        + (annonce.disponibilites ? `<p class="detail-annonce">🗓️ ${escapeAttr(annonce.disponibilites)}</p>` : '')
        + (annonce.contact ? `<p class="detail-annonce">📞 ${texteAvecLiensCliquables(annonce.contact)}</p>` : '')
        + (annonce.user_id === window.USER_ID ? '' : '<div class="zone-interet-coup-de-main"></div>')
        + (estAuteurOuGestionnaire ? '<div class="zone-interets-recus"></div>' : '');

      if (annonce.photo_url) {
        zoneDepliee.querySelector('img.miniature-article').addEventListener('click', () => ouvrirLightbox(annonce.photo_url));
      }

      // Exprimer un intérêt : jamais pour sa propre annonce (déjà exclu ci-dessus côté HTML).
      // Un seul envoi par personne (contrainte serveur) — le bouton se remplace par une
      // confirmation après coup, sans recharger toute la liste.
      const zoneInteret = zoneDepliee.querySelector('.zone-interet-coup-de-main');
      if (zoneInteret) {
        zoneInteret.innerHTML = `
          <button type="button" class="btn-interet-coup-de-main">🙋 Je suis intéressé(e)</button>
          <div class="formulaire-interet-coup-de-main" hidden>
            <textarea class="message-interet-coup-de-main" placeholder="Message pour l'auteur (optionnel) — vos coordonnées si vous voulez qu'on vous rappelle" maxlength="500"></textarea>
            <button type="button" class="btn-envoyer-interet-coup-de-main">Envoyer</button>
          </div>
        `;
        const btnOuvrir = zoneInteret.querySelector('.btn-interet-coup-de-main');
        const formulaire = zoneInteret.querySelector('.formulaire-interet-coup-de-main');
        btnOuvrir.addEventListener('click', () => { btnOuvrir.hidden = true; formulaire.hidden = false; });
        zoneInteret.querySelector('.btn-envoyer-interet-coup-de-main').addEventListener('click', async (e) => {
          const bouton = e.currentTarget;
          bouton.disabled = true;
          const message = zoneInteret.querySelector('.message-interet-coup-de-main').value.trim();
          const res = await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main/${annonce.id}/interet`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message || undefined }),
          });
          if (res.ok) {
            zoneInteret.innerHTML = '<p class="detail-annonce">✓ Votre intérêt a été envoyé à l\'auteur.</p>';
            afficherToastMessage('Intérêt envoyé !', 'succes');
          } else {
            const d = await res.json().catch(() => ({}));
            afficherToastMessage(d.erreur || 'Échec de l\'envoi.', 'erreur');
            bouton.disabled = false;
          }
        });
      }

      // Auteur (ou gestionnaire) : liste privée des personnes intéressées, jamais visible par
      // les autres citoyens (voir GET /:id/interets, réservé côté serveur).
      const zoneInterets = zoneDepliee.querySelector('.zone-interets-recus');
      if (zoneInterets) {
        appelApi(`/${window.COMMUNE_SLUG}/coups-de-main/${annonce.id}/interets`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (!data) return;
            if (!data.interets.length) {
              zoneInterets.innerHTML = '<p class="detail-annonce" style="opacity:.7;">Personne n\'a encore exprimé d\'intérêt.</p>';
              return;
            }
            zoneInterets.innerHTML = `<div class="label-champ-edition">Personnes intéressées (${data.interets.length})</div>`
              + data.interets.map((i) => `
                <div class="carte-interet-coup-de-main">
                  <strong>${escapeAttr(i.prenom)} ${escapeAttr(i.nom)}</strong>
                  ${i.message ? `<p>${texteAvecLiensCliquables(i.message)}</p>` : ''}
                </div>
              `).join('');
          });
      }

      if (estAuteurOuGestionnaire) {
        const bar = document.createElement('div');
        bar.className = 'actions-admin';
        const libellePourvu = annonce.pourvu ? '↩️ Remettre active' : '✅ Marquer comme pourvu';
        bar.innerHTML = `<button data-action="pourvu">${libellePourvu}</button><button data-action="modifier">Modifier</button><button data-action="supprimer">Supprimer</button>`;
        bar.querySelector('[data-action="pourvu"]').addEventListener('click', async () => {
          await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main/${annonce.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pourvu: !annonce.pourvu }),
          });
          chargerCoupsDeMain();
        });
        bar.querySelector('[data-action="modifier"]').addEventListener('click', () => ouvrirModaleCreationCoupDeMain(annonce));
        bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
          if (!confirm('Supprimer cette annonce ?')) return;
          await appelApi(`/${window.COMMUNE_SLUG}/coups-de-main/${annonce.id}`, { method: 'DELETE' });
          chargerCoupsDeMain();
        });
        zoneDepliee.appendChild(bar);
      }
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}
