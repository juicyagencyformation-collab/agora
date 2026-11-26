// frontend/js/moderation-publications.js
// Outils de modération de la mairie (2026-11-26, migration 122), partagés par articles.js,
// agenda.js et annuaire.js : retrait MOTIVÉ en 2 clics (l'auteur reçoit le motif par email),
// suspension d'une fiche, « Masquer chez nous » d'un contenu partagé par une autre commune,
// historique des décisions. Motifs : liste fermée servie par le Worker, chacun renvoie à un
// article de /charte-publication.html.

const ICONES_FICHE = { association: '🤝', commerce: '🏪', artisan: '🔨' };
const iconeFiche = (categorie) => ICONES_FICHE[categorie] || '🤝';
const estGestionnaireModeration = () => ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);

let motifsModerationCache = null;
async function chargerMotifsModeration() {
  if (motifsModerationCache) return motifsModerationCache;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/publications/motifs`);
  if (!res.ok) throw new Error('motifs');
  motifsModerationCache = await res.json();
  return motifsModerationCache;
}

function htmlLienCharte() {
  return '<p class="lien-charte-publication">En publiant, vous respectez la <a href="/charte-publication.html" target="_blank" rel="noopener">charte de publication</a>.</p>';
}

function htmlChoixMotif(motifs, prefixe) {
  return `
    <label class="label-champ-edition" for="motif-${prefixe}">Motif</label>
    <select id="motif-${prefixe}">
      ${motifs.map((m) => `<option value="${m.cle}">${escapeAttr(m.libelle)} (art. ${m.article})</option>`).join('')}
    </select>
    <label class="label-champ-edition" for="precision-${prefixe}">Précision (facultative, sauf « Autre »)</label>
    <textarea id="precision-${prefixe}" maxlength="500" rows="2" placeholder="Ex. : troisième promotion cette semaine"></textarea>
    <p class="aide-moderation">Le motif et la précision sont envoyés par email à l'auteur, avec le lien vers la
      <a href="/charte-publication.html" target="_blank" rel="noopener">charte</a> et la possibilité de contester.</p>`;
}

function lireMotif(corps, prefixe) {
  return {
    motif: corps.querySelector(`#motif-${prefixe}`).value,
    precision: corps.querySelector(`#precision-${prefixe}`).value.trim() || undefined,
  };
}

function messageErreurApi(data, defaut) {
  if (typeof data?.erreur === 'string') return data.erreur;
  if (data?.erreur?.fieldErrors?.precision) return 'Précisez le motif (obligatoire pour « Autre »).';
  return defaut;
}

// type : 'actus' ou 'agenda'. 1er clic = « 🚫 Retirer… », 2e clic = « Retirer et prévenir ».
async function ouvrirModaleRetrait(type, publication, onFait) {
  let donnees;
  try { donnees = await chargerMotifsModeration(); } catch { afficherToastMessage('Motifs indisponibles, réessayez.', 'erreur'); return; }
  const overlay = ouvrirModaleFormulaire('Retirer la publication', `
    <form id="form-retrait-publication">
      <p style="margin-top:0;">« ${escapeAttr(publication.titre || '')} » ne sera plus visible des habitants. Vous pourrez la rétablir.</p>
      ${htmlChoixMotif(donnees.motifs, 'retrait')}
      <button type="submit" class="bouton-danger">🚫 Retirer et prévenir l'auteur</button>
    </form>`);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  corps.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bouton = corps.querySelector('button[type="submit"]');
    bouton.disabled = true;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/${type}/${publication.id}/retirer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lireMotif(corps, 'retrait')),
    });
    const data = await res.json().catch(() => ({}));
    bouton.disabled = false;
    if (!res.ok) { afficherToastMessage(messageErreurApi(data, 'Retrait impossible.'), 'erreur'); return; }
    fermerModaleFormulaire(overlay);
    afficherToastMessage(data.auteur_prevenu ? 'Publication retirée, l\'auteur a été prévenu par email.' : 'Publication retirée (aucun email n\'a pu être envoyé à l\'auteur).', 'succes');
    onFait?.();
  });
}

async function ouvrirModaleSuspension(fiche, onFait) {
  let donnees;
  try { donnees = await chargerMotifsModeration(); } catch { afficherToastMessage('Motifs indisponibles, réessayez.', 'erreur'); return; }
  const overlay = ouvrirModaleFormulaire('Suspendre les publications', `
    <form id="form-suspension-fiche">
      <p style="margin-top:0;">« ${escapeAttr(fiche.nom)} » ne pourra plus publier d'actualité ni d'événement. Sa fiche reste dans l'annuaire.</p>
      <label class="label-champ-edition" for="duree-suspension">Durée</label>
      <select id="duree-suspension">
        ${donnees.durees_suspension.map((j) => `<option value="${j}">${j} jours</option>`).join('')}
      </select>
      ${htmlChoixMotif(donnees.motifs, 'suspension')}
      <button type="submit" class="bouton-danger">⏸️ Suspendre et prévenir les responsables</button>
    </form>`);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  corps.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}/suspendre`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jours: parseInt(corps.querySelector('#duree-suspension').value, 10), ...lireMotif(corps, 'suspension') }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { afficherToastMessage(messageErreurApi(data, 'Suspension impossible.'), 'erreur'); return; }
    fermerModaleFormulaire(overlay);
    afficherToastMessage('Publications suspendues, les responsables ont été prévenus.', 'succes');
    onFait?.();
  });
}

async function leverSuspensionFiche(fiche, onFait) {
  if (!confirm(`Lever la suspension de « ${fiche.nom} » ?`)) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/annuaire/${fiche.id}/suspendre`, { method: 'DELETE' });
  if (res.ok) { afficherToastMessage('Suspension levée.', 'succes'); onFait?.(); }
}

// cible : { article_id } ou { event_id } d'une AUTRE commune ; masquer = true / false.
async function basculerPartageMasque(cible, masquer, onFait) {
  if (masquer && !confirm('Masquer cette publication pour les habitants de votre commune ? Elle reste visible ailleurs.')) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/publications/partages-masques`, {
    method: masquer ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cible),
  });
  if (res.ok) { afficherToastMessage(masquer ? 'Masquée chez vous.' : 'De nouveau affichée chez vous.', 'succes'); onFait?.(); }
  else afficherToastMessage(messageErreurApi(await res.json().catch(() => ({})), 'Action impossible.'), 'erreur');
}

function boutonMasquerChezNous(cible, onFait) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lien-discret';
  btn.textContent = '🙈 Masquer chez nous';
  btn.addEventListener('click', () => basculerPartageMasque(cible, true, onFait));
  return btn;
}

const LIBELLES_DECISION = {
  retrait: '🚫 Retrait', restauration: '✓ Rétablie', suspension: '⏸️ Suspension', fin_suspension: '▶️ Fin de suspension',
  masquage_partage: '🙈 Masquée chez nous', fin_masquage_partage: '👁️ Réaffichée chez nous',
};

async function ouvrirHistoriqueModeration() {
  const overlay = ouvrirModaleFormulaire('Décisions de modération', '<p>Chargement…</p>');
  const corps = overlay.querySelector('.corps-modale-formulaire');
  const rendre = async () => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/publications/decisions`);
    if (!res.ok) { corps.innerHTML = '<p>Historique indisponible.</p>'; return; }
    const { decisions } = await res.json();
    if (!decisions.length) { corps.innerHTML = '<p>Aucune décision pour l\'instant.</p>'; return; }
    // Une publication masquée « chez nous » dont le dernier état est « masquée » peut être réaffichée.
    const dernierEtat = new Map();
    [...decisions].reverse().forEach((d) => { if (d.type.endsWith('masquage_partage')) dernierEtat.set(d.article_id || d.event_id, d.type); });
    corps.innerHTML = `
      <p class="aide-moderation">Les 50 dernières décisions de la mairie, gardées comme preuve en cas de contestation.</p>
      <ul class="liste-decisions-moderation">${decisions.map((d) => {
        const cle = d.article_id || d.event_id;
        const reafficher = d.type === 'masquage_partage' && dernierEtat.get(cle) === 'masquage_partage'
          ? `<button type="button" class="lien-discret" data-reafficher='${escapeAttr(JSON.stringify(d.article_id ? { article_id: d.article_id } : { event_id: d.event_id }))}'>Réafficher</button>` : '';
        return `<li>
          <strong>${LIBELLES_DECISION[d.type] || d.type}</strong> · ${new Date(d.created_at).toLocaleDateString('fr-FR')}
          <br>${escapeAttr(d.titre || d.fiche_nom || 'Publication supprimée depuis')}
          ${d.motif_libelle ? `<br><small>Motif : ${escapeAttr(d.motif_libelle)}${d.precision ? ` — ${escapeAttr(d.precision)}` : ''}</small>` : ''}
          ${d.jusqu_au ? `<br><small>Jusqu'au ${new Date(`${d.jusqu_au}T12:00:00`).toLocaleDateString('fr-FR')}</small>` : ''}
          ${['retrait', 'suspension'].includes(d.type) ? `<br><small>${d.auteur_prevenu ? '✉️ Auteur prévenu' : '⚠️ Email non envoyé'}</small>` : ''}
          ${reafficher}
        </li>`;
      }).join('')}</ul>`;
    corps.querySelectorAll('[data-reafficher]').forEach((btn) => btn.addEventListener('click', () =>
      basculerPartageMasque(JSON.parse(btn.dataset.reafficher), false, rendre)));
  };
  rendre();
}

// Bouton discret « 🛡️ Décisions de modération » (mairie seulement), placé sous une liste.
function boutonHistoriqueModeration() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lien-discret';
  btn.textContent = '🛡️ Décisions de modération';
  btn.addEventListener('click', ouvrirHistoriqueModeration);
  return btn;
}
