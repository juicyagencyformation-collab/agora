// frontend/js/conseil.js
let editeurPv;

async function chargerConseil() {
  chargerDeliberations();
  chargerPv();
}

// ── Délibérations ──

async function chargerDeliberations() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/deliberations`);
  if (!res.ok) return;
  const { deliberations } = await res.json();
  const conteneur = document.getElementById('liste-deliberations');
  conteneur.innerHTML = '';
  if (!deliberations.length) conteneur.innerHTML = `<p class="dechets-vide">Aucune délibération pour l'instant.</p>`;
  deliberations.forEach((d) => conteneur.appendChild(renderDeliberation(d)));
}

function renderDeliberation(d) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const publiee = d.statut === 'publiee';
  const statutTexte = publiee ? 'Résultats publiés' : (d.mon_vote ? `Vous avez voté : ${d.mon_vote}` : 'En attente de votre vote');

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide">🗳️</div>
      <div class="texte-entete-article">
        <span class="badge-categorie-article ${publiee ? '' : 'badge-demain'}">${publiee ? 'Publiée' : 'En cours'}</span>
        <h3 class="titre-article-compact">${escapeAttr(d.titre)}</h3>
        <span class="date-article-compact">${escapeAttr(statutTexte)}</span>
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
      remplirContenuDeliberation(zoneDepliee, d, publiee);
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}

function remplirContenuDeliberation(zone, d, publiee) {
  let contenuResultats;
  if (publiee && d.resultats) {
    const total = d.resultats.pour + d.resultats.contre + d.resultats.abstention;
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
    contenuResultats = `
      <div class="ligne-jauge"><label>✅ Pour</label><div class="jauge"><div class="jauge-remplie" style="width:${pct(d.resultats.pour)}%"></div></div><span>${d.resultats.pour}</span></div>
      <div class="ligne-jauge"><label>❌ Contre</label><div class="jauge"><div class="jauge-remplie" style="width:${pct(d.resultats.contre)}%;background:var(--rouge);"></div></div><span>${d.resultats.contre}</span></div>
      <div class="ligne-jauge"><label>➖ Abstention</label><div class="jauge"><div class="jauge-remplie" style="width:${pct(d.resultats.abstention)}%;background:var(--roseau);"></div></div><span>${d.resultats.abstention}</span></div>
      <a href="${window.API_BASE}/${window.COMMUNE_SLUG}/deliberations/${d.id}/export" target="_blank">Voir la version imprimable</a>
    `;
  } else {
    contenuResultats = `<p style="color:var(--roseau);font-size:13px;">Résultats masqués jusqu'à publication par la mairie.${d.mon_vote ? ' Votre vote est enregistré : <strong>' + escapeAttr(d.mon_vote) + '</strong>.' : ''}</p>`;
  }

  zone.innerHTML = `<p>${texteAvecLiensCliquables(d.description)}</p>${contenuResultats}`;

  if (!publiee && !d.cloturee) {
    const form = document.createElement('form');
    form.style.marginTop = '8px';
    form.innerHTML = `
      <label><input type="radio" name="vote-${d.id}" value="pour" ${d.mon_vote === 'pour' ? 'checked' : ''}> Pour</label>
      <label style="margin-left:10px;"><input type="radio" name="vote-${d.id}" value="contre" ${d.mon_vote === 'contre' ? 'checked' : ''}> Contre</label>
      <label style="margin-left:10px;"><input type="radio" name="vote-${d.id}" value="abstention" ${d.mon_vote === 'abstention' ? 'checked' : ''}> Abstention</label>
    `;
    form.querySelectorAll('input').forEach((r) => r.addEventListener('change', async () => {
      await appelApi(`/${window.COMMUNE_SLUG}/deliberations/${d.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choix: r.value }),
      });
      chargerDeliberations();
    }));
    zone.appendChild(form);
  }

  if (['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
    const bar = document.createElement('div');
    bar.className = 'actions-admin';
    bar.innerHTML = publiee
      ? `<button data-action="supprimer">Supprimer</button>`
      : `<button data-action="publier">Publier les résultats</button><button data-action="supprimer">Supprimer</button>`;

    bar.querySelector('[data-action="publier"]')?.addEventListener('click', async () => {
      if (!confirm('Publier les résultats ? Le vote sera définitivement clos.')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/deliberations/${d.id}/publier`, { method: 'PATCH' });
      chargerDeliberations();
    });
    bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer cette délibération ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/deliberations/${d.id}`, { method: 'DELETE' });
      chargerDeliberations();
    });
    zone.appendChild(bar);
  }
}

function initFormulaireDeliberation() {
  const btn = document.getElementById('btn-ouvrir-creation-deliberation');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationDeliberation());
}

function ouvrirModaleCreationDeliberation() {
  const html = `
    <form id="form-modale-deliberation">
      <input type="text" id="titre-deliberation-modale" placeholder="Titre" maxlength="200" required>
      <textarea id="description-deliberation-modale" placeholder="Description" required></textarea>
      <button type="submit" style="margin-top:12px;">Créer</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Créer une délibération', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-deliberation').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-deliberation-modale').value.trim();
    const description = corps.querySelector('#description-deliberation-modale').value.trim();
    if (!titre || !description) return;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/deliberations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titre, description }),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerDeliberations();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de création');
    }
  });
}

// ── Comptes-rendus de séance (PV) — réutilise le système d'articles, section="conseil" ──

async function chargerPv() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/actus?section=conseil`);
  if (!res.ok) return;
  const { articles } = await res.json();
  const conteneur = document.getElementById('liste-pv');
  conteneur.innerHTML = '';
  if (!articles.length) conteneur.innerHTML = `<p class="dechets-vide">Aucun compte-rendu pour l'instant.</p>`;
  articles.forEach((a) => conteneur.appendChild(renderPv(a)));
}

function renderPv(a) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const extraitBrut = texteBrutDepuisHtml(a.contenu_html).replace(/\s+/g, ' ').trim();
  const extrait = extraitBrut.slice(0, 110);
  const dateAffichee = new Date(a.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide">${a.fichier_pv_type === 'pdf' ? '📄' : '📝'}</div>
      <div class="texte-entete-article">
        <h3 class="titre-article-compact">${escapeAttr(a.titre)}</h3>
        <p class="extrait-article-compact">${escapeAttr(extrait)}${extraitBrut.length > 110 ? '…' : ''}</p>
        <span class="date-article-compact">${dateAffichee}</span>
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
      zoneDepliee.innerHTML = `<div class="contenu-article">${linkifierHtmlRiche(a.contenu_html)}</div>`;

      if (a.fichier_pv_url) {
        if (a.fichier_pv_type === 'pdf') {
          const lien = document.createElement('a');
          lien.href = a.fichier_pv_url;
          lien.target = '_blank';
          lien.rel = 'noopener';
          lien.className = 'lien-fichier-pv-pdf';
          lien.textContent = '📄 Ouvrir le compte-rendu (PDF)';
          zoneDepliee.appendChild(lien);
        } else {
          const conteneurImg = document.createElement('div');
          conteneurImg.className = 'fichier-pv-apercu';
          const img = document.createElement('img');
          img.src = a.fichier_pv_url;
          img.addEventListener('click', () => ouvrirLightbox(a.fichier_pv_url));
          conteneurImg.appendChild(img);
          zoneDepliee.appendChild(conteneurImg);
        }
      }

      if (['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
        const bar = document.createElement('div');
        bar.className = 'actions-admin';
        bar.innerHTML = `<button data-action="supprimer">Supprimer</button>`;
        bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
          if (!confirm('Supprimer ce compte-rendu ?')) return;
          await appelApi(`/${window.COMMUNE_SLUG}/actus/${a.id}`, { method: 'DELETE' });
          chargerPv();
        });
        zoneDepliee.appendChild(bar);
      }
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}

function initFormulairePv() {
  const btn = document.getElementById('btn-ouvrir-creation-pv');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationPv());
}

function ouvrirModaleCreationPv() {
  const html = `
    <form id="form-modale-pv">
      <input type="text" id="titre-pv-modale" placeholder="Titre (ex: Conseil du 12 septembre 2026)" maxlength="150" required>
      <div id="editeur-pv-modale"></div>
      <label class="label-champ-edition">Joindre le compte-rendu (PDF, JPEG ou PNG — 15 Mo max, optionnel)</label>
      <input type="file" id="fichier-pv-modale" accept="application/pdf,image/jpeg,image/png">
      <button type="submit" style="margin-top:12px;">Publier</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Rédiger un compte-rendu', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  editeurPv = creerEditeurRiche('editeur-pv-modale');

  corps.querySelector('#form-modale-pv').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-pv-modale').value.trim();
    const contenu_html = editeurPv.getHtml() || '<p></p>';
    if (!titre) return;

    let fichier_pv_url;
    let fichier_pv_type;
    const fichier = corps.querySelector('#fichier-pv-modale').files[0];
    if (fichier) {
      if (fichier.size > 15 * 1024 * 1024) {
        afficherToastMessage('Fichier trop volumineux (15 Mo maximum).', 'erreur');
        return;
      }
      const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/actus/pv-upload`, {
        method: 'POST',
        headers: { 'Content-Type': fichier.type },
        body: fichier,
      });
      if (!resUpload.ok) {
        const d = await resUpload.json().catch(() => ({}));
        afficherToastMessage(d.erreur || 'Échec de l\'envoi du fichier.', 'erreur');
        return;
      }
      const data = await resUpload.json();
      fichier_pv_url = data.url;
      fichier_pv_type = data.type;
    }

    const res = await appelApi(`/${window.COMMUNE_SLUG}/actus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'conseil', titre, contenu_html, fichier_pv_url, fichier_pv_type }),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerPv();
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de publication', 'erreur');
    }
  });
}

// ── Date du prochain conseil (admin/élu/superadmin) ──

function initFormulaireProchainConseil() {
  const form = document.getElementById('form-prochain-conseil');
  if (!form) return;

  appelApi(`/${window.COMMUNE_SLUG}/commune`).then(async (res) => {
    if (!res.ok) return;
    const { commune } = await res.json();
    if (commune.prochain_conseil_date) {
      const input = document.getElementById('prochain-conseil-input');
      const d = new Date(commune.prochain_conseil_date);
      const pad = (n) => String(n).padStart(2, '0');
      input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valeur = document.getElementById('prochain-conseil-input').value;
    if (!valeur) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prochain_conseil_date: new Date(valeur).toISOString() }),
    });
    if (res.ok) afficherToastMessage('Date du prochain conseil enregistrée.', 'succes');
    else afficherToastMessage('Erreur lors de l\'enregistrement.', 'erreur');
  });
}
