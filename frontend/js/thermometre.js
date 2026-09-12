// frontend/js/thermometre.js
// Fait défiler jusqu'à un sondage précis et le déplie (venant d'un lien de notification).
function ouvrirSondageParId(id) {
  const carte = document.querySelector(`[data-sondage-id="${id}"]`);
  if (!carte) return;
  carte.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const volet = carte.querySelector('.sondage-options-volet');
  if (volet && !volet.classList.contains('ouvert')) carte.querySelector('.sondage-entete').click();
}

async function chargerThermometre() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/sondages`);
  if (!res.ok) return;
  const { sondages } = await res.json();
  const conteneur = document.getElementById('liste-sondages');
  conteneur.innerHTML = '';
  sondages.forEach((s) => conteneur.appendChild(renderJaugeSondage(s)));
}

function renderJaugeSondage(sondage) {
  const wrap = renderSondageJoli({
    id: `thermo-${sondage.id}`,
    question: sondage.question,
    choix: sondage.choix,
    totalVotes: sondage.total_votes,
    mesVotes: sondage.mes_votes || [],
    multiChoix: sondage.multi_choix,
    onVoter: async (choix_ids) => {
      const res = await appelApi(`/${window.COMMUNE_SLUG}/sondages/${sondage.id}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choix_ids }),
      });
      if (res.ok) traiterRecompense(await res.json());
      chargerThermometre();
    },
  });
  wrap.dataset.sondageId = sondage.id;

  if (['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
    const bar = document.createElement('div');
    bar.className = 'actions-admin';
    bar.innerHTML = `<button data-action="modifier">Modifier</button><button data-action="supprimer">Supprimer</button>`;
    bar.querySelector('[data-action="modifier"]').addEventListener('click', () => ouvrirModaleCreationSondage(sondage));
    bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer ce sondage ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/sondages/${sondage.id}`, { method: 'DELETE' });
      chargerThermometre();
    });
    wrap.appendChild(bar);
  }

  return wrap;
}

// ── Formulaire de création ET d'édition (admin/élu/superadmin) ──
// sondage fourni = édition (PATCH, préremplie, choix existants conservés par leur id pour ne
// pas perdre les votes déjà exprimés dessus) ; sinon création (POST). Même modale pour les
// deux, comme coups-de-main-form.js (ouvrirModaleCreationCoupDeMain).

let choixSondageThermoCompteur = 0;

function initFormulaireSondage() {
  const btn = document.getElementById('btn-ouvrir-creation-sondage');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationSondage());
}

function ouvrirModaleCreationSondage(sondage = null) {
  const html = `
    <form id="form-modale-sondage">
      <input type="text" id="question-sondage-modale" placeholder="Question" maxlength="200" required value="${sondage ? escapeAttr(sondage.question) : ''}">
      <label style="font-size:13px;color:var(--roseau);"><input type="checkbox" id="multi-choix-sondage-modale-thermo" ${sondage?.multi_choix ? 'checked' : ''}> Plusieurs réponses possibles</label>
      <div id="liste-choix-sondage-modale-thermo"></div>
      <button type="button" id="btn-ajouter-choix-sondage-modale" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);font-size:12px;padding:6px 10px;">+ Ajouter un choix</button>
      <label class="label-champ-edition">Date de clôture (optionnel)</label>
      <input type="datetime-local" id="closes-at-sondage-modale" value="${sondage ? isoVersDatetimeLocal(sondage.closes_at) : ''}">
      <button type="submit" style="margin-top:12px;">${sondage ? 'Mettre à jour' : 'Publier le sondage'}</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(sondage ? 'Modifier le sondage' : 'Créer un sondage', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  choixSondageThermoCompteur = 0;

  corps.querySelector('#btn-ajouter-choix-sondage-modale').addEventListener('click', () => ajouterChoixSondageThermo(corps));
  if (sondage) {
    sondage.choix.forEach((ch) => ajouterChoixSondageThermo(corps, ch.label, ch.id));
  } else {
    ajouterChoixSondageThermo(corps);
    ajouterChoixSondageThermo(corps);
  }

  corps.querySelector('#form-modale-sondage').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = corps.querySelector('#question-sondage-modale').value.trim();
    const multi_choix = corps.querySelector('#multi-choix-sondage-modale-thermo').checked;
    const closesAtSaisi = corps.querySelector('#closes-at-sondage-modale').value;
    const choix = [...corps.querySelectorAll('.ligne-choix-sondage-modale')]
      .map((ligne) => ({
        id: ligne.dataset.choixId || undefined,
        label: ligne.querySelector('.choix-sondage-modale-thermo-input').value.trim(),
      }))
      .filter((ch) => ch.label);

    if (!question || choix.length < 2) {
      alert('Indique une question et au moins 2 choix.');
      return;
    }

    const donnees = {
      question, multi_choix, choix,
      closes_at: closesAtSaisi ? new Date(closesAtSaisi).toISOString() : null,
    };
    const res = sondage
      ? await appelApi(`/${window.COMMUNE_SLUG}/sondages/${sondage.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(donnees),
        })
      : await appelApi(`/${window.COMMUNE_SLUG}/sondages`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, multi_choix, choix, ...(donnees.closes_at ? { closes_at: donnees.closes_at } : {}) }),
        });

    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerThermometre();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur lors de l\'enregistrement');
    }
  });
}

// texte/id fournis = choix existant (édition) ; sinon ligne vide (création).
function ajouterChoixSondageThermo(corps, texte = '', id = '') {
  choixSondageThermoCompteur++;
  const conteneur = corps.querySelector('#liste-choix-sondage-modale-thermo');
  const ligne = document.createElement('div');
  ligne.className = 'ligne-choix-sondage-modale';
  ligne.dataset.choixId = id;
  ligne.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;';
  ligne.innerHTML = `
    <input type="text" class="choix-sondage-modale-thermo-input" placeholder="Choix ${choixSondageThermoCompteur}" maxlength="120" value="${escapeAttr(texte)}" style="flex:1;margin:0;">
    <button type="button" class="btn-retirer-choix-sondage" title="Retirer ce choix" style="background:transparent;color:var(--rouge);border:1.5px solid var(--eauL);font-size:12px;padding:6px 9px;flex-shrink:0;">✕</button>
  `;
  ligne.querySelector('.btn-retirer-choix-sondage').addEventListener('click', () => {
    if (conteneur.children.length <= 2) { alert('Un sondage doit avoir au moins 2 choix.'); return; }
    ligne.remove();
  });
  conteneur.appendChild(ligne);
}
