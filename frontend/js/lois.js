// frontend/js/lois.js

const LABELS_SOURCE = {
  assemblee_nationale: '🏛️ Assemblée nationale',
  senat: '🏛️ Sénat',
  parlement_europeen: '🇪🇺 Parlement européen',
  autre: '📄 Autre',
};
const LABELS_STATUT = {
  depose: 'Déposé', commission: 'En commission', discussion: 'En discussion',
  adopte: 'Adopté', rejete: 'Rejeté',
};

async function chargerLois() {
  const conteneur = document.getElementById('liste-lois');
  if (!conteneur) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/lois`);
  if (!res.ok) return;
  const { lois } = await res.json();
  conteneur.innerHTML = '';
  if (!lois.length) {
    conteneur.innerHTML = `<p class="dechets-vide">Aucun texte pour l'instant.</p>`;
    return;
  }
  lois.forEach((l) => conteneur.appendChild(renderLoi(l)));
}

function renderLoi(l) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const dateAffichee = new Date(l.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  const estNouveau = (Date.now() - new Date(l.created_at).getTime()) < 48 * 3600 * 1000;
  const total = l.opinion_commune.pour + l.opinion_commune.contre + l.opinion_commune.mitige;
  const pct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide">⚖️</div>
      <div class="texte-entete-article">
        <div class="badges-event-compact">
          ${estNouveau ? '<span class="badge-categorie-article badge-nouveau-loi">🆕 Nouveau</span>' : ''}
          <span class="badge-categorie-article">${LABELS_SOURCE[l.source]}</span>
          <span class="badge-categorie-article">${LABELS_STATUT[l.statut]}</span>
        </div>
        <h3 class="titre-article-compact">${escapeAttr(l.titre)}</h3>
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
      remplirDetailLoi(zoneDepliee, l, total, pct);
      zoneDepliee.dataset.rempli = 'true';
      appelApi(`/${window.COMMUNE_SLUG}/lois/${l.id}/lu`, { method: 'POST' })
        .then((res) => res.ok && res.json())
        .then((data) => { if (data && !data.deja_lu) traiterRecompense?.(data); })
        .catch(() => {});
    }
  });

  return el;
}

function remplirDetailLoi(zoneDepliee, l, total, pct) {
  zoneDepliee.innerHTML = `
    <p>${escapeAttr(l.description)}</p>
    <a href="${l.url_source}" target="_blank" rel="noopener" style="font-size:12.5px;">📄 Lire le texte officiel</a>

    <p style="font-size:11.5px;color:var(--roseau);margin-top:12px;">⚠️ Vote symbolique d'opinion, pas un vote officiel.</p>
    <div class="boutons-vote-loi" style="display:flex;gap:6px;margin:8px 0;">
      <button type="button" class="btn-vote-loi ${l.mon_vote === 'pour' ? 'vote-actif' : ''}" data-position="pour">✅ Pour</button>
      <button type="button" class="btn-vote-loi ${l.mon_vote === 'contre' ? 'vote-actif' : ''}" data-position="contre">❌ Contre</button>
      <button type="button" class="btn-vote-loi ${l.mon_vote === 'mitige' ? 'vote-actif' : ''}" data-position="mitige">🤷 Mitigé</button>
    </div>

    <div class="ligne-jauge"><label>✅ Pour</label><div class="jauge"><div class="jauge-remplie" style="width:${pct(l.opinion_commune.pour)}%"></div></div><span>${l.opinion_commune.pour}</span></div>
    <div class="ligne-jauge"><label>❌ Contre</label><div class="jauge"><div class="jauge-remplie" style="width:${pct(l.opinion_commune.contre)}%;background:var(--rouge);"></div></div><span>${l.opinion_commune.contre}</span></div>
    <div class="ligne-jauge"><label>🤷 Mitigé</label><div class="jauge"><div class="jauge-remplie" style="width:${pct(l.opinion_commune.mitige)}%;background:var(--roseau);"></div></div><span>${l.opinion_commune.mitige}</span></div>
    <p style="font-size:11px;color:var(--roseau);">${total} habitant(s) de votre commune ont donné leur avis</p>

    <h4 style="margin-top:16px;font-size:13.5px;">💬 Commentaires</h4>
    <div class="liste-commentaires-loi"></div>
    <form class="form-commentaire-loi" style="margin-top:8px;">
      <textarea placeholder="Votre avis..." maxlength="1000" required></textarea>
      <button type="submit">Publier</button>
    </form>
  `;

  zoneDepliee.querySelectorAll('.btn-vote-loi').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const res = await appelApi(`/${window.COMMUNE_SLUG}/lois/${l.id}/voter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: btn.dataset.position }),
      });
      if (res.ok) chargerLois();
    });
  });

  chargerCommentairesLoi(zoneDepliee, l.id);

  zoneDepliee.querySelector('.form-commentaire-loi').addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const textarea = e.target.querySelector('textarea');
    const contenu = textarea.value.trim();
    if (!contenu) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/lois/${l.id}/commentaires`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contenu }),
    });
    if (res.ok) { textarea.value = ''; chargerCommentairesLoi(zoneDepliee, l.id); }
  });

  zoneDepliee.addEventListener('click', (e) => e.stopPropagation());
}

async function chargerCommentairesLoi(zoneDepliee, loi_id) {
  const zone = zoneDepliee.querySelector('.liste-commentaires-loi');
  const res = await appelApi(`/${window.COMMUNE_SLUG}/lois/${loi_id}/commentaires`);
  if (!res.ok) return;
  const { commentaires } = await res.json();
  zone.innerHTML = commentaires.length ? '' : '<p style="font-size:12px;color:var(--roseau);">Aucun commentaire pour l\'instant.</p>';
  commentaires.forEach((cm) => {
    const div = document.createElement('div');
    div.className = 'commentaire-loi';
    div.innerHTML = `
      <strong>${escapeAttr(cm.auteur_prenom)} ${escapeAttr(cm.auteur_nom)}</strong>
      <p>${escapeAttr(cm.contenu)}</p>
      <button type="button" class="btn-signaler-commentaire-loi" style="font-size:10px;background:transparent;color:var(--roseau);border:none;padding:2px;">🚩 Signaler</button>
    `;
    div.querySelector('.btn-signaler-commentaire-loi').addEventListener('click', async () => {
      if (!confirm('Signaler ce commentaire comme inapproprié ?')) return;
      const res2 = await appelApi(`/${window.COMMUNE_SLUG}/lois/commentaires/${cm.id}/signaler`, { method: 'POST' });
      if (res2.ok) chargerCommentairesLoi(zoneDepliee, loi_id);
    });
    zone.appendChild(div);
  });
}

// ── Formulaire de création (admin/élu/superadmin) ──

function initFormulaireLoi() {
  const btn = document.getElementById('btn-ouvrir-creation-loi');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const html = `
      <form id="form-modale-loi">
        <input type="text" id="titre-loi-modale" placeholder="Titre du texte" maxlength="300" required>
        <textarea id="description-loi-modale" placeholder="Résumé / description" required></textarea>
        <label class="label-champ-edition">Source</label>
        <select id="source-loi-modale">
          <option value="assemblee_nationale">Assemblée nationale</option>
          <option value="senat">Sénat</option>
          <option value="parlement_europeen">Parlement européen</option>
          <option value="autre">Autre</option>
        </select>
        <label class="label-champ-edition">Statut</label>
        <select id="statut-loi-modale">
          <option value="depose">Déposé</option>
          <option value="commission">En commission</option>
          <option value="discussion">En discussion</option>
          <option value="adopte">Adopté</option>
          <option value="rejete">Rejeté</option>
        </select>
        <label class="label-champ-edition">Lien vers le texte officiel</label>
        <input type="url" id="url-loi-modale" placeholder="https://www.legifrance.gouv.fr/..." required>
        <button type="submit" style="margin-top:12px;">Publier</button>
      </form>
    `;
    const overlay = ouvrirModaleFormulaire('Ajouter un texte', html);
    const corps = overlay.querySelector('.corps-modale-formulaire');
    corps.querySelector('#form-modale-loi').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await appelApi(`/${window.COMMUNE_SLUG}/lois`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titre: corps.querySelector('#titre-loi-modale').value.trim(),
          description: corps.querySelector('#description-loi-modale').value.trim(),
          source: corps.querySelector('#source-loi-modale').value,
          statut: corps.querySelector('#statut-loi-modale').value,
          url_source: corps.querySelector('#url-loi-modale').value.trim(),
        }),
      });
      if (res.ok) { fermerModaleFormulaire(overlay); chargerLois(); }
      else { const d = await res.json(); afficherToastMessage(d.erreur ? JSON.stringify(d.erreur) : 'Erreur', 'erreur'); }
    });
  });
}
