// frontend/js/coups-de-main.js
const LABELS_CATEGORIE = {
  bricolage: 'Bricolage', jardinage: 'Jardinage', garde_enfants: "Garde d'enfants",
  transport: 'Transport', courses: 'Courses', autre: 'Autre',
};

// Ouvre une annonce précise (venant d'un lien de notification) : la déplie et y fait défiler.
function ouvrirAnnonceParId(id) {
  const carte = document.querySelector(`[data-annonce-id="${id}"]`);
  if (!carte) return;
  carte.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const zoneDepliee = carte.querySelector('.contenu-article-deplie');
  if (zoneDepliee?.hidden) carte.querySelector('.entete-article-compact').click();
}

async function chargerCoupsDeMain(filtreType = null, filtreCategorie = null) {
  const url = new URL(`${window.API_BASE}/${window.COMMUNE_SLUG}/coups-de-main`, window.location.origin);
  if (filtreType) url.searchParams.set('type', filtreType);
  if (filtreCategorie) url.searchParams.set('categorie', filtreCategorie);

  const res = await appelApi(url);
  if (!res.ok) return;
  const { annonces } = await res.json();
  const conteneur = document.getElementById('liste-annonces');
  conteneur.innerHTML = '';
  if (!annonces.length) conteneur.innerHTML = `<p class="dechets-vide">Aucune annonce pour l'instant.</p>`;
  annonces.forEach((a) => conteneur.appendChild(renderAnnonce(a)));
}

function renderAnnonce(annonce) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  el.dataset.annonceId = annonce.id;
  const joursRestants = Math.ceil((new Date(annonce.expires_at) - Date.now()) / 86_400_000);
  const extrait = annonce.description.slice(0, 90);

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide">${annonce.type === 'offre' ? '🤲' : '🙏'}</div>
      <div class="texte-entete-article">
        <div class="badges-event-compact">
          <span class="badge-categorie-article">${annonce.type === 'offre' ? 'Offre' : 'Demande'}</span>
          <span class="badge-categorie-article">${LABELS_CATEGORIE[annonce.categorie]}</span>
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
      zoneDepliee.innerHTML = `<p>${texteAvecLiensCliquables(annonce.description)}</p>`;
      if (annonce.user_id === window.USER_ID || ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
        const bar = document.createElement('div');
        bar.className = 'actions-admin';
        bar.innerHTML = `<button data-action="modifier">Modifier</button><button data-action="supprimer">Supprimer</button>`;
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
