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
    const peutModifierDirectement = estBrouillon
      && (bulletin.auteur_id === window.USER_ID || ['elu', 'maire', 'superadmin'].includes(window.ROLE));

    const bar = document.createElement('div');
    bar.className = 'actions-admin';
    bar.innerHTML = [
      peutModifierDirectement ? '<button data-action="modifier">Modifier</button>' : '',
      estBrouillon && ['elu', 'maire', 'superadmin'].includes(window.ROLE) ? '<button data-action="publier">Valider et publier</button>' : '',
      '<button data-action="supprimer">Supprimer</button>',
    ].join('');

    bar.querySelector('[data-action="modifier"]')?.addEventListener('click', () => ouvrirModaleCreationBulletin(bulletin));
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

  // Rédaction collaborative sur un brouillon : un autre gestionnaire propose sa propre
  // version (corrections, reformulation...) sans toucher au texte original tant qu'elle n'est
  // pas adoptée — celui qui adopte choisit laquelle devient le contenu officiel du brouillon.
  if (estBrouillon && ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
    const zonePropositions = document.createElement('div');
    zonePropositions.className = 'zone-propositions-bulletin';
    zonePropositions.innerHTML = `
      <h4 style="margin:14px 0 6px;font-size:13.5px;">Versions proposées</h4>
      <div class="liste-propositions-bulletin"></div>
      <button type="button" data-action="proposer" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);font-size:12.5px;padding:6px 12px;border-radius:100px;margin-top:6px;">+ Proposer ma version</button>
    `;
    zonePropositions.querySelector('[data-action="proposer"]').addEventListener('click', () => ouvrirModaleProposition(bulletin));
    zone.appendChild(zonePropositions);
    chargerPropositions(bulletin.id, zonePropositions.querySelector('.liste-propositions-bulletin'));
  }
}

function initFormulaireBulletin() {
  const btn = document.getElementById('btn-ouvrir-creation-bulletin');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationBulletin());
}

// bulletin (optionnel) : pré-remplit et bascule en modification directe plutôt que création —
// réservée à son auteur ou à élu/maire/superadmin (voir PATCH /:id côté serveur) ; les autres
// gestionnaires passent par "Proposer ma version" pour ne jamais écraser le travail d'autrui.
function ouvrirModaleCreationBulletin(bulletin = null) {
  const html = `
    <form id="form-modale-bulletin">
      <input type="text" id="titre-bulletin-modale" placeholder="Titre" maxlength="200" required value="${bulletin ? escapeAttr(bulletin.titre) : ''}">
      <div id="editeur-bulletin-modale"></div>
      ${bulletin ? '' : '<p style="font-size:12px;color:var(--roseau);margin-top:10px;">Un brouillon doit être validé par un élu ou le superadmin avant d\'être visible par les citoyens.</p>'}
      <button type="submit" style="margin-top:6px;">${bulletin ? 'Enregistrer les modifications' : 'Enregistrer comme brouillon'}</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(bulletin ? 'Modifier le brouillon' : 'Rédiger un bulletin', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  editeurBulletin = creerEditeurRiche('editeur-bulletin-modale');
  if (bulletin) editeurBulletin.setHtml(bulletin.contenu_html);

  corps.querySelector('#form-modale-bulletin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-bulletin-modale').value.trim();
    const contenu_html = editeurBulletin.getHtml();
    if (!titre || !contenu_html) return;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin${bulletin ? '/' + bulletin.id : ''}`, {
      method: bulletin ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre, contenu_html }),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerBulletin();
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur d\'enregistrement', 'erreur');
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

// ── Versions proposées sur un brouillon : rédaction à plusieurs mains sans jamais écraser
// le texte en place tant que personne n'a choisi d'adopter une proposition. ──

async function chargerPropositions(bulletinId, zone) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin/${bulletinId}/propositions`);
  if (!res.ok) return;
  const { propositions } = await res.json();

  zone.innerHTML = '';
  if (!propositions.length) {
    zone.innerHTML = `<p class="dechets-vide">Aucune version proposée pour l'instant.</p>`;
    return;
  }
  propositions.forEach((p) => zone.appendChild(renderProposition(bulletinId, p)));
}

function renderProposition(bulletinId, p) {
  const el = document.createElement('div');
  el.className = 'carte-dashboard';
  const extraitBrut = texteBrutDepuisHtml(p.contenu_html).replace(/\s+/g, ' ').trim();
  const dateAffichee = new Date(p.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  el.innerHTML = `
    <strong>${escapeAttr(p.titre)}</strong>
    <p style="font-size:12px;color:var(--roseau);margin:2px 0 8px;">Proposé le ${dateAffichee}</p>
    <p style="font-size:13px;">${escapeAttr(extraitBrut.slice(0, 160))}${extraitBrut.length > 160 ? '…' : ''}</p>
    <div class="ligne-soutien-alerte">
      <button type="button" class="btn-soutenir ${p.je_soutiens ? 'soutenu' : ''}">👍 <span class="txt-soutien">${p.je_soutiens ? 'Soutenu' : 'Soutenir'}</span> · <span class="compteur-soutien">${p.soutiens}</span></button>
    </div>
    <div class="actions-admin" style="margin-top:8px;">
      <button data-action="adopter">Adopter cette version</button>
      <button data-action="rejeter">Rejeter</button>
    </div>
  `;
  el.querySelector('.btn-soutenir').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin/${bulletinId}/propositions/${p.id}/soutenir`, { method: 'POST' });
    btn.disabled = false;
    if (!res.ok) return;
    const { soutiens, je_soutiens } = await res.json();
    btn.classList.toggle('soutenu', je_soutiens);
    btn.querySelector('.txt-soutien').textContent = je_soutiens ? 'Soutenu' : 'Soutenir';
    btn.querySelector('.compteur-soutien').textContent = soutiens;
  });
  el.querySelector('[data-action="adopter"]').addEventListener('click', async () => {
    if (!confirm('Remplacer le brouillon par cette version ? Les autres propositions seront retirées.')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/bulletin/${bulletinId}/propositions/${p.id}/adopter`, { method: 'PATCH' });
    afficherToastMessage('Version adoptée.', 'succes');
    chargerBulletin();
  });
  el.querySelector('[data-action="rejeter"]').addEventListener('click', async () => {
    if (!confirm('Rejeter cette proposition ?')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/bulletin/${bulletinId}/propositions/${p.id}`, { method: 'DELETE' });
    chargerBulletin();
  });
  return el;
}

function ouvrirModaleProposition(bulletin) {
  const html = `
    <form id="form-modale-proposition">
      <input type="text" id="titre-proposition-modale" placeholder="Titre" maxlength="200" required value="${escapeAttr(bulletin.titre)}">
      <div id="editeur-proposition-modale"></div>
      <p style="font-size:12px;color:var(--roseau);margin-top:10px;">Part du texte actuel du brouillon — corrige-le ou réécris-le librement. Le brouillon original n'est pas modifié tant que personne n'adopte ta version.</p>
      <button type="submit" style="margin-top:6px;">Proposer cette version</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Proposer une version', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  const editeurProposition = creerEditeurRiche('editeur-proposition-modale');
  editeurProposition.setHtml(bulletin.contenu_html);

  corps.querySelector('#form-modale-proposition').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-proposition-modale').value.trim();
    const contenu_html = editeurProposition.getHtml();
    if (!titre || !contenu_html) return;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/bulletin/${bulletin.id}/propositions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre, contenu_html }),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      afficherToastMessage('Version proposée.', 'succes');
      chargerBulletin();
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur d\'envoi', 'erreur');
    }
  });
}
