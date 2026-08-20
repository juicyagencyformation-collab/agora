// frontend/js/articles.js
let editeurArticleActuel;
let choixSondageCompteur = 0;
let filtreCategorieActuel = null;
let modeArchivesActu = false;

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
  if (modeArchivesActu) url.searchParams.set('archives', 'true');
  if (curseur) url.searchParams.set('curseur', curseur);
  const res = await appelApi(url);
  if (!res.ok) return;
  const { articles } = await res.json();
  const conteneur = document.getElementById('liste-articles');
  conteneur.innerHTML = '';
  if (!articles.length) {
    conteneur.innerHTML = modeArchivesActu
      ? `<p class="dechets-vide">Aucune actualité archivée.</p>`
      : `<p class="dechets-vide">Aucun article dans cette catégorie pour l'instant.</p>`;
  }
  articles.forEach(renderArticle);
}

function initToggleArchivesActu() {
  const btn = document.getElementById('btn-toggle-archives-actu');
  if (!btn) return;
  btn.addEventListener('click', () => {
    modeArchivesActu = !modeArchivesActu;
    btn.textContent = modeArchivesActu ? '← Retour aux actualités' : '🗄️ Voir les archives';
    chargerArticles();
  });
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

  const libelleCategorie = LABELS_CATEGORIE_ARTICLE[article.categorie] ?? article.categorie;

  el.innerHTML = miniature ? `
    <button type="button" class="entete-article-compact entete-article-banniere">
      <img src="${miniature}" class="banniere-article-img" loading="lazy" alt="">
      <span class="badge-categorie-article badge-categorie-banniere">${libelleCategorie}</span>
      <div class="banniere-article-degrade"></div>
      <div class="banniere-article-texte">
        <h3 class="titre-article-banniere">${escapeAttr(article.titre)}</h3>
        <span class="date-article-banniere">${dateAffichee}${article.deja_lu ? ' · lu ✓' : ''}</span>
      </div>
    </button>
    <div class="contenu-article-deplie" hidden></div>
  ` : `
    <button type="button" class="entete-article-compact">
      <div class="texte-entete-article">
        <span class="badge-categorie-article">${libelleCategorie}</span>
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
    <div class="contenu-article">${linkifierHtmlRiche(article.contenu_html)}</div>
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
    const labelArchive = article.archive ? 'Restaurer' : 'Archiver';
    bar.innerHTML = `<button data-action="modifier">Modifier</button><button data-action="archive-toggle">${labelArchive}</button><button data-action="supprimer">Supprimer</button>`;
    bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer cet article et ses images ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/actus/${article.id}`, { method: 'DELETE' });
      chargerArticles();
    });
    bar.querySelector('[data-action="archive-toggle"]').addEventListener('click', async () => {
      await appelApi(`/${window.COMMUNE_SLUG}/actus/${article.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archive: !article.archive }),
      });
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
  initToggleArchivesActu();
}

function htmlFormulaireArticle() {
  return `
    <form id="form-modale-article">
      <input type="text" id="titre-article-modale" placeholder="Titre de l'article" maxlength="200" required>
      <select id="categorie-article-modale">
        ${Object.entries(LABELS_CATEGORIE_ARTICLE).map(([cle, label]) => `<option value="${cle}">${label}</option>`).join('')}
      </select>
      <div id="editeur-article-modale"></div>
      <label style="display:block;margin:10px 0 4px;font-size:13px;color:var(--roseau);">Photos (optionnel — jusqu'à 10)</label>
      <input type="file" id="image-article-modale" accept="image/*" multiple>
      <div id="apercu-images-article-modale" class="apercu-images-modale"></div>
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

  const inputImages = corps.querySelector('#image-article-modale');
  const apercu = corps.querySelector('#apercu-images-article-modale');
  inputImages.addEventListener('change', () => {
    apercu.innerHTML = '';
    [...inputImages.files].slice(0, 10).forEach((fichier) => {
      const img = document.createElement('img');
      img.className = 'apercu-image-modale';
      img.src = URL.createObjectURL(fichier);
      img.onload = () => URL.revokeObjectURL(img.src);
      apercu.appendChild(img);
    });
  });

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

  const imageR2Keys = [];
  const fichiers = [...corps.querySelector('#image-article-modale').files].slice(0, 10);
  for (const fichier of fichiers) {
    try {
      const compresse = await compresserImage(fichier);
      const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/actus/upload`, {
        method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
      });
      if (resUpload.ok) { const { key } = await resUpload.json(); imageR2Keys.push(key); }
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
      <label style="display:block;margin:10px 0 4px;font-size:13px;color:var(--roseau);">Photos actuelles</label>
      <div id="images-existantes-edition" class="apercu-images-modale"></div>
      <label style="display:block;margin:10px 0 4px;font-size:13px;color:var(--roseau);">Ajouter des photos (jusqu'à 10)</label>
      <input type="file" id="image-edition-article-modale" accept="image/*" multiple>
      <div id="apercu-images-edition-modale" class="apercu-images-modale"></div>
      <button type="submit" style="margin-top:12px;">Enregistrer</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Modifier l\'article', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  const editeur = creerEditeurRiche('editeur-edition-article-modale');
  editeur.setHtml(article.contenu_html);

  // Photos existantes : chacune avec un bouton × qui la marque à supprimer (retrait
  // effectif à l'enregistrement seulement).
  const idsSupprimees = new Set();
  const zoneExistantes = corps.querySelector('#images-existantes-edition');
  const rendreImagesExistantes = () => {
    zoneExistantes.innerHTML = '';
    (article.images || []).forEach((img) => {
      if (idsSupprimees.has(img.id)) return;
      const vignette = document.createElement('div');
      vignette.className = 'vignette-image-editable';
      vignette.innerHTML = `<img src="${img.url}" class="apercu-image-modale">
        <button type="button" class="btn-retirer-image" title="Retirer">×</button>`;
      vignette.querySelector('.btn-retirer-image').addEventListener('click', () => {
        idsSupprimees.add(img.id);
        rendreImagesExistantes();
      });
      zoneExistantes.appendChild(vignette);
    });
    if (!zoneExistantes.children.length) {
      zoneExistantes.innerHTML = '<p style="font-size:12.5px;color:var(--roseau);margin:0;">Aucune photo.</p>';
    }
  };
  rendreImagesExistantes();

  const inputImages = corps.querySelector('#image-edition-article-modale');
  const apercu = corps.querySelector('#apercu-images-edition-modale');
  inputImages.addEventListener('change', () => {
    apercu.innerHTML = '';
    [...inputImages.files].slice(0, 10).forEach((fichier) => {
      const img = document.createElement('img');
      img.className = 'apercu-image-modale';
      img.src = URL.createObjectURL(fichier);
      img.onload = () => URL.revokeObjectURL(img.src);
      apercu.appendChild(img);
    });
  });

  corps.querySelector('#form-modale-edition-article').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-edition-article-modale').value.trim();
    const categorie = corps.querySelector('#categorie-edition-article-modale').value;
    const contenu_html = editeur.getHtml();
    if (!titre || !contenu_html) return;

    const boutonSubmit = corps.querySelector('button[type="submit"]');
    boutonSubmit.disabled = true;

    const imageR2Keys = [];
    for (const fichier of [...inputImages.files].slice(0, 10)) {
      try {
        const compresse = await compresserImage(fichier);
        const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/actus/upload`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (resUpload.ok) { const { key } = await resUpload.json(); imageR2Keys.push(key); }
      } catch { console.warn('Upload image échoué.'); }
    }

    const res = await appelApi(`/${window.COMMUNE_SLUG}/actus/${article.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titre, categorie, contenu_html,
        image_r2_keys: imageR2Keys,
        image_ids_supprimees: [...idsSupprimees],
      }),
    });
    boutonSubmit.disabled = false;
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerArticles();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de modification');
    }
  });
}
