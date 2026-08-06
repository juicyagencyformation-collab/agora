// frontend/js/articles.js
let editeurArticleActuel;
let choixSondageCompteur = 0;
let filtreCategorieActuel = null;

const LABELS_CATEGORIE_ARTICLE = {
  vie_village: 'Vie du village',
  projets_travaux: 'Projets & travaux',
  environnement: 'Environnement',
  agenda: 'Agenda',
  info_pratique: 'Info pratique',
};

async function chargerArticles(section = 'actualites', curseur = null) {
  const url = new URL(`${window.API_BASE}/${window.COMMUNE_SLUG}/actus`, window.location.origin);
  url.searchParams.set('section', section);
  if (filtreCategorieActuel) url.searchParams.set('categorie', filtreCategorieActuel);
  if (curseur) url.searchParams.set('curseur', curseur);
  const res = await appelApi(url);
  if (!res.ok) return;
  const { articles } = await res.json();
  const conteneur = document.getElementById('liste-articles');
  conteneur.innerHTML = '';
  if (!articles.length) {
    conteneur.innerHTML = `<p class="dechets-vide">Aucun article dans cette catégorie pour l'instant.</p>`;
  }
  articles.forEach(renderArticle);
}

// Ouvre un article précis (venant d'un lien de notification) : le trouve dans la liste
// déjà rendue, le déplie, et fait défiler la page jusqu'à lui.
function ouvrirArticleParId(id) {
  const carte = document.querySelector(`[data-article-id="${id}"]`);
  if (!carte) return;
  carte.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const zoneDepliee = carte.querySelector('.contenu-article-deplie');
  if (zoneDepliee?.hidden) carte.querySelector('.entete-article-compact').click();
}

function initFiltresCategorieArticle() {
  const zone = document.getElementById('filtres-categorie-articles');
  if (!zone) return;
  zone.innerHTML = `<button class="filtre-categorie-btn active" data-cat="">Tout</button>` +
    Object.entries(LABELS_CATEGORIE_ARTICLE).map(([cle, label]) =>
      `<button class="filtre-categorie-btn" data-cat="${cle}">${label}</button>`
    ).join('');

  zone.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      zone.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      filtreCategorieActuel = btn.dataset.cat || null;
      chargerArticles();
    });
  });
}

function renderArticle(article) {
  const conteneur = document.getElementById('liste-articles');
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  el.dataset.articleId = article.id;

  const extraitBrut = texteBrutDepuisHtml(article.contenu_html).replace(/\s+/g, ' ').trim();
  const extrait = extraitBrut.slice(0, 110);
  const miniature = article.images?.[0]?.url;
  const dateAffichee = new Date(article.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      ${miniature ? `<img src="${miniature}" class="miniature-liste-article">` : '<div class="miniature-liste-article miniature-vide">📰</div>'}
      <div class="texte-entete-article">
        <span class="badge-categorie-article">${LABELS_CATEGORIE_ARTICLE[article.categorie] ?? article.categorie}</span>
        <h3 class="titre-article-compact">${escapeAttr(article.titre)}</h3>
        <p class="extrait-article-compact">${escapeAttr(extrait)}${extraitBrut.length > 110 ? '…' : ''}</p>
        <span class="date-article-compact">${dateAffichee}${article.deja_lu ? ' · lu ✓' : ''}</span>
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
      remplirContenuDeplie(zoneDepliee, article);
      zoneDepliee.dataset.rempli = 'true';
      if (!article.deja_lu) {
        appelApi(`/${window.COMMUNE_SLUG}/actus/${article.id}/lu`, { method: 'POST' })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => data && traiterRecompense(data));
      }
    }
  });

  conteneur.appendChild(el);
}

function remplirContenuDeplie(zone, article) {
  zone.innerHTML = `
    <div class="contenu-article">${article.contenu_html}</div>
    <div class="images-article"></div>
    <div class="sondage-article"></div>
  `;

  const zoneImages = zone.querySelector('.images-article');
  article.images.forEach((img) => {
    const imgEl = document.createElement('img');
    imgEl.src = img.url;
    imgEl.loading = 'lazy';
    imgEl.className = 'miniature-article';
    imgEl.addEventListener('click', () => ouvrirLightbox(img.url));
    zoneImages.appendChild(imgEl);
  });

  if (article.sondage) {
    zone.querySelector('.sondage-article').appendChild(renderSondageArticle(article.sondage, article.id));
  }

  if (['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
    const bar = document.createElement('div');
    bar.className = 'actions-admin';
    bar.innerHTML = `<button data-action="modifier">Modifier</button><button data-action="supprimer">Supprimer</button>`;
    bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer cet article et ses images ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/actus/${article.id}`, { method: 'DELETE' });
      chargerArticles();
    });
    bar.querySelector('[data-action="modifier"]').addEventListener('click', () => ouvrirModaleEditionArticle(article));
    zone.appendChild(bar);
  }
}

function renderSondageArticle(sondage, articleId) {
  return renderSondageJoli({
    id: `article-${sondage.id}`,
    question: sondage.question,
    choix: sondage.choix || [],
    totalVotes: sondage.total_votes || 0,
    mesVotes: sondage.mes_votes || [],
    multiChoix: sondage.multi_choix,
    onVoter: async (choix_ids) => {
      await appelApi(`/${window.COMMUNE_SLUG}/actus/${articleId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choix_ids }),
      });
      chargerArticles();
    },
  });
}

// ── Modal de création ──

function initFormulaireArticle() {
  const btn = document.getElementById('btn-ouvrir-creation-article');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationArticle());
  initFiltresCategorieArticle();
}

function htmlFormulaireArticle() {
  return `
    <form id="form-modale-article">
      <input type="text" id="titre-article-modale" placeholder="Titre de l'article" maxlength="200" required>
      <select id="categorie-article-modale">
        ${Object.entries(LABELS_CATEGORIE_ARTICLE).map(([cle, label]) => `<option value="${cle}">${label}</option>`).join('')}
      </select>
      <div id="editeur-article-modale"></div>
      <label style="display:block;margin:10px 0 4px;font-size:13px;color:var(--roseau);">Image (optionnel)</label>
      <input type="file" id="image-article-modale" accept="image/*">
      <button type="button" id="btn-ajouter-sondage-modale" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);">+ Ajouter un sondage</button>
      <div id="zone-sondage-article-modale" style="display:none;margin-top:10px;">
        <input type="text" id="question-sondage-article-modale" placeholder="Question du sondage" maxlength="200">
        <label style="font-size:13px;color:var(--roseau);"><input type="checkbox" id="multi-choix-sondage-modale"> Plusieurs réponses possibles</label>
        <div id="liste-choix-sondage-modale"></div>
        <button type="button" id="btn-ajouter-choix-modale" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);font-size:12px;padding:6px 10px;">+ Ajouter un choix</button>
      </div>
      <button type="submit" style="margin-top:12px;">Publier</button>
    </form>
  `;
}

function ouvrirModaleCreationArticle() {
  const overlay = ouvrirModaleFormulaire('Publier un article', htmlFormulaireArticle());
  const corps = overlay.querySelector('.corps-modale-formulaire');
  editeurArticleActuel = creerEditeurRiche('editeur-article-modale');
  choixSondageCompteur = 0;

  corps.querySelector('#btn-ajouter-sondage-modale').addEventListener('click', () => {
    const zone = corps.querySelector('#zone-sondage-article-modale');
    const ouvert = zone.style.display !== 'none';
    zone.style.display = ouvert ? 'none' : 'block';
    if (!ouvert && corps.querySelectorAll('.choix-sondage-modale-input').length === 0) {
      ajouterChoixSondageModale(corps);
      ajouterChoixSondageModale(corps);
    }
  });
  corps.querySelector('#btn-ajouter-choix-modale').addEventListener('click', () => ajouterChoixSondageModale(corps));

  corps.querySelector('#form-modale-article').addEventListener('submit', async (e) => {
    e.preventDefault();
    await soumettreArticleModale(corps, overlay);
  });
}

function ajouterChoixSondageModale(corps) {
  choixSondageCompteur++;
  const conteneur = corps.querySelector('#liste-choix-sondage-modale');
  const ligne = document.createElement('div');
  ligne.innerHTML = `<input type="text" class="choix-sondage-modale-input" placeholder="Choix ${choixSondageCompteur}" maxlength="120">`;
  conteneur.appendChild(ligne);
}

async function soumettreArticleModale(corps, overlay) {
  const titre = corps.querySelector('#titre-article-modale').value.trim();
  const categorie = corps.querySelector('#categorie-article-modale').value;
  const contenuHtml = editeurArticleActuel.getHtml();
  if (!titre || !contenuHtml) return;

  const boutonSubmit = corps.querySelector('button[type="submit"]');
  boutonSubmit.disabled = true;

  let imageR2Keys = [];
  const fichierImage = corps.querySelector('#image-article-modale').files[0];
  if (fichierImage) {
    try {
      const compresse = await compresserImage(fichierImage);
      const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/actus/upload`, {
        method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
      });
      if (resUpload.ok) { const { key } = await resUpload.json(); imageR2Keys = [key]; }
    } catch { console.warn('Upload image échoué.'); }
  }

  let sondage = null;
  const zoneSondage = corps.querySelector('#zone-sondage-article-modale');
  if (zoneSondage.style.display !== 'none') {
    const question = corps.querySelector('#question-sondage-article-modale').value.trim();
    const multiChoix = corps.querySelector('#multi-choix-sondage-modale').checked;
    const choix = [...corps.querySelectorAll('.choix-sondage-modale-input')]
      .map((i) => i.value.trim()).filter(Boolean).map((label) => ({ label }));
    if (question && choix.length >= 2) sondage = { question, multi_choix: multiChoix, choix };
  }

  const res = await appelApi(`/${window.COMMUNE_SLUG}/actus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section: 'actualites', categorie, titre, contenu_html: contenuHtml, image_r2_keys: imageR2Keys, sondage }),
  });
  boutonSubmit.disabled = false;

  if (res.ok) {
    fermerModaleFormulaire(overlay);
    chargerArticles();
  } else {
    const data = await res.json();
    alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de publication');
  }
}

// ── Modal d'édition ──

function ouvrirModaleEditionArticle(article) {
  const html = `
    <form id="form-modale-edition-article">
      <input type="text" id="titre-edition-article-modale" value="${escapeAttr(article.titre)}" maxlength="200">
      <select id="categorie-edition-article-modale">
        ${Object.entries(LABELS_CATEGORIE_ARTICLE).map(([cle, label]) =>
          `<option value="${cle}" ${article.categorie === cle ? 'selected' : ''}>${label}</option>`
        ).join('')}
      </select>
      <div id="editeur-edition-article-modale"></div>
      <button type="submit" style="margin-top:12px;">Enregistrer</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Modifier l\'article', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  const editeur = creerEditeurRiche('editeur-edition-article-modale');
  editeur.setHtml(article.contenu_html);

  corps.querySelector('#form-modale-edition-article').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-edition-article-modale').value.trim();
    const categorie = corps.querySelector('#categorie-edition-article-modale').value;
    const contenu_html = editeur.getHtml();
    if (!titre || !contenu_html) return;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/actus/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre, categorie, contenu_html }),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerArticles();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de modification');
    }
  });
}
