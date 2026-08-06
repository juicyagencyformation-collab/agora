// frontend/js/bulletin.js
let editeurBulletin;

async function chargerBulletin() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin`);
  if (!res.ok) return;
  const { bulletins } = await res.json();
  const conteneur = document.getElementById('liste-bulletin');
  conteneur.innerHTML = '';
  if (!bulletins.length) conteneur.innerHTML = `<p class="dechets-vide">Aucun bulletin pour l'instant.</p>`;
  bulletins.forEach((b) => conteneur.appendChild(renderBulletin(b)));
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
  zone.innerHTML = `<div class="contenu-article">${bulletin.contenu_html}</div>`;

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
