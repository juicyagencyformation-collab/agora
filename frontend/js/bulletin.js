// frontend/js/bulletin.js
let editeurBulletin;
let editeurRubrique;

async function chargerBulletin() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin`);
  if (!res.ok) return;
  const { bulletins } = await res.json();
  const conteneur = document.getElementById('liste-bulletin');
  conteneur.innerHTML = '';
  if (!bulletins.length) conteneur.innerHTML = `<p class="dechets-vide">Aucun bulletin pour l'instant.</p>`;
  bulletins.forEach((b) => conteneur.appendChild(renderBulletin(b)));
  chargerRubriques();
}

function renderBulletin(bulletin) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const estBrouillon = bulletin.statut === 'brouillon';
  const extraitBrut = texteBrutDepuisHtml(bulletin.contenu_html).replace(/\s+/g, ' ').trim();
  const extrait = extraitBrut.slice(0, 110);

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide">📋</div>
      <div class="texte-entete-article">
        ${estBrouillon ? '<span class="badge-categorie-article badge-demain">Brouillon</span>' : ''}
        <h3 class="titre-article-compact">${escapeAttr(bulletin.titre)}</h3>
        <p class="extrait-article-compact">${escapeAttr(extrait)}${extraitBrut.length > 110 ? '…' : ''}</p>
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
      remplirContenuBulletin(zoneDepliee, bulletin, estBrouillon);
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}

function remplirContenuBulletin(zone, bulletin, estBrouillon) {
  zone.innerHTML = `<div class="contenu-article">${linkifierHtmlRiche(bulletin.contenu_html)}</div>`;

  if (['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
    const bar = document.createElement('div');
    bar.className = 'actions-admin';
    bar.innerHTML = estBrouillon && ['elu', 'maire', 'superadmin'].includes(window.ROLE)
      ? `<button data-action="publier">Valider et publier</button><button data-action="supprimer">Supprimer</button>`
      : `<button data-action="supprimer">Supprimer</button>`;

    bar.querySelector('[data-action="publier"]')?.addEventListener('click', async () => {
      if (!confirm('Publier ce bulletin ? Il deviendra visible par tous les citoyens.')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/bulletin/${bulletin.id}/publier`, { method: 'PATCH' });
      chargerBulletin();
    });
    bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer ce bulletin ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/bulletin/${bulletin.id}`, { method: 'DELETE' });
      chargerBulletin();
    });
    zone.appendChild(bar);
  }
}

function initFormulaireBulletin() {
  const btn = document.getElementById('btn-ouvrir-creation-bulletin');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationBulletin());
}

function ouvrirModaleCreationBulletin() {
  const html = `
    <form id="form-modale-bulletin">
      <input type="text" id="titre-bulletin-modale" placeholder="Titre" maxlength="200" required>
      <div id="editeur-bulletin-modale"></div>
      <p style="font-size:12px;color:var(--roseau);margin-top:10px;">Un brouillon doit être validé par un élu ou le superadmin avant d'être visible par les citoyens.</p>
      <button type="submit" style="margin-top:6px;">Enregistrer comme brouillon</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Rédiger un bulletin', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  editeurBulletin = creerEditeurRiche('editeur-bulletin-modale');

  corps.querySelector('#form-modale-bulletin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-bulletin-modale').value.trim();
    const contenu_html = editeurBulletin.getHtml();
    if (!titre || !contenu_html) return;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre, contenu_html }),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerBulletin();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de création');
    }
  });
}

// ── Rubriques : rédaction collaborative entre gestionnaires — un admin propose, un élu/maire/
// superadmin valide avant que ce soit visible des citoyens (même double regard que les
// bulletins complets ci-dessus). ──

async function chargerRubriques() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin/rubriques`);
  if (!res.ok) return;
  const { rubriques } = await res.json();

  const zoneAttente = document.getElementById('liste-rubriques-attente');
  if (zoneAttente) {
    const enAttente = rubriques.filter((r) => r.statut === 'attente');
    zoneAttente.innerHTML = '';
    if (!enAttente.length) {
      zoneAttente.innerHTML = `<p class="dechets-vide">Aucune rubrique en attente de validation.</p>`;
    } else {
      enAttente.forEach((r) => zoneAttente.appendChild(renderRubriqueAttente(r)));
    }
  }

  const zoneValidees = document.getElementById('liste-rubriques');
  if (zoneValidees) {
    const validees = rubriques.filter((r) => r.statut === 'validee');
    zoneValidees.innerHTML = '';
    if (!validees.length) {
      zoneValidees.innerHTML = `<p class="dechets-vide">Aucune rubrique pour l'instant.</p>`;
    } else {
      validees.forEach((r) => zoneValidees.appendChild(renderRubrique(r)));
    }
  }
}

function renderRubriqueAttente(r) {
  const el = document.createElement('div');
  el.className = 'carte-dashboard';
  el.innerHTML = `
    <strong>${escapeAttr(r.titre)}</strong>
    <p style="font-size:12px;color:var(--roseau);margin:2px 0 8px;">${r.nom_auteur ? 'Signé : ' + escapeAttr(r.nom_auteur) : 'Mairie'}</p>
    <div class="contenu-article">${linkifierHtmlRiche(r.contenu_html)}</div>
    <div class="actions-admin" style="margin-top:8px;">
      <button data-action="valider">Valider</button>
      <button data-action="refuser">Refuser</button>
    </div>
  `;
  el.querySelector('[data-action="valider"]').addEventListener('click', async () => {
    await appelApi(`/${window.COMMUNE_SLUG}/bulletin/rubriques/${r.id}/valider`, { method: 'PATCH' });
    chargerRubriques();
  });
  el.querySelector('[data-action="refuser"]').addEventListener('click', async () => {
    if (!confirm('Refuser cette rubrique ? Elle sera définitivement supprimée.')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/bulletin/rubriques/${r.id}`, { method: 'DELETE' });
    chargerRubriques();
  });
  return el;
}

function renderRubrique(r) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const extraitBrut = texteBrutDepuisHtml(r.contenu_html).replace(/\s+/g, ' ').trim();
  const extrait = extraitBrut.slice(0, 110);

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide">✍️</div>
      <div class="texte-entete-article">
        <span class="badge-categorie-article">${r.nom_auteur ? escapeAttr(r.nom_auteur) : 'Mairie'}</span>
        <h3 class="titre-article-compact">${escapeAttr(r.titre)}</h3>
        <p class="extrait-article-compact">${escapeAttr(extrait)}${extraitBrut.length > 110 ? '…' : ''}</p>
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
      zoneDepliee.innerHTML = `<div class="contenu-article">${linkifierHtmlRiche(r.contenu_html)}</div>`;
      if (['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
        const bar = document.createElement('div');
        bar.className = 'actions-admin';
        bar.innerHTML = `<button data-action="retirer">Retirer</button>`;
        bar.querySelector('[data-action="retirer"]').addEventListener('click', async () => {
          if (!confirm('Retirer cette rubrique du bulletin ?')) return;
          await appelApi(`/${window.COMMUNE_SLUG}/bulletin/rubriques/${r.id}`, { method: 'DELETE' });
          chargerRubriques();
        });
        zoneDepliee.appendChild(bar);
      }
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}

function initFormulaireRubrique() {
  const btn = document.getElementById('btn-ouvrir-creation-rubrique');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationRubrique());
}

function ouvrirModaleCreationRubrique() {
  const html = `
    <form id="form-modale-rubrique">
      <input type="text" id="titre-rubrique-modale" placeholder="Titre (ex : L'assemblée générale du club de pétanque)" maxlength="150" required>
      <input type="text" id="nom-auteur-rubrique-modale" placeholder="Signature — ex : Club de pétanque (optionnel)" maxlength="100">
      <div id="editeur-rubrique-modale"></div>
      <p style="font-size:12px;color:var(--roseau);margin-top:10px;">Visible des habitants une fois validée par un élu, le maire ou le superadmin.</p>
      <button type="submit" style="margin-top:6px;">Proposer</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Proposer une rubrique', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  editeurRubrique = creerEditeurRiche('editeur-rubrique-modale');

  corps.querySelector('#form-modale-rubrique').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-rubrique-modale').value.trim();
    const nom_auteur = corps.querySelector('#nom-auteur-rubrique-modale').value.trim();
    const contenu_html = editeurRubrique.getHtml();
    if (!titre || !contenu_html) return;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin/rubriques`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre, nom_auteur, contenu_html }),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      afficherToastMessage('Rubrique proposée, en attente de validation.', 'succes');
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur d\'envoi', 'erreur');
    }
  });
}
