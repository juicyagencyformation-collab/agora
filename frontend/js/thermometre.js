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

  if (['admin', 'elu', 'superadmin'].includes(window.ROLE)) {
    const bar = document.createElement('div');
    bar.className = 'actions-admin';
    bar.innerHTML = `<button data-action="modifier">Modifier</button><button data-action="supprimer">Supprimer</button>`;
    bar.querySelector('[data-action="modifier"]').addEventListener('click', async () => {
      const nouvelleQuestion = prompt('Nouvelle question :', sondage.question);
      if (!nouvelleQuestion || !nouvelleQuestion.trim()) return;
      const res = await appelApi(`/${window.COMMUNE_SLUG}/sondages/${sondage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: nouvelleQuestion.trim() }),
      });
      if (res.ok) chargerThermometre();
      else alert('Erreur lors de la modification.');
    });
    bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer ce sondage ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/sondages/${sondage.id}`, { method: 'DELETE' });
      chargerThermometre();
    });
    wrap.appendChild(bar);
  }

  return wrap;
}

// ── Formulaire de création (admin/élu/superadmin) ──

let choixSondageThermoCompteur = 0;

function initFormulaireSondage() {
  const btn = document.getElementById('btn-ouvrir-creation-sondage');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationSondage());
}

function ouvrirModaleCreationSondage() {
  const html = `
    <form id="form-modale-sondage">
      <input type="text" id="question-sondage-modale" placeholder="Question" maxlength="200" required>
      <label style="font-size:13px;color:var(--roseau);"><input type="checkbox" id="multi-choix-sondage-modale-thermo"> Plusieurs réponses possibles</label>
      <div id="liste-choix-sondage-modale-thermo"></div>
      <button type="button" id="btn-ajouter-choix-sondage-modale" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);font-size:12px;padding:6px 10px;">+ Ajouter un choix</button>
      <button type="submit" style="margin-top:12px;">Publier le sondage</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Créer un sondage', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  choixSondageThermoCompteur = 0;

  corps.querySelector('#btn-ajouter-choix-sondage-modale').addEventListener('click', () => ajouterChoixSondageThermo(corps));
  ajouterChoixSondageThermo(corps);
  ajouterChoixSondageThermo(corps);

  corps.querySelector('#form-modale-sondage').addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = corps.querySelector('#question-sondage-modale').value.trim();
    const multi_choix = corps.querySelector('#multi-choix-sondage-modale-thermo').checked;
    const choix = [...corps.querySelectorAll('.choix-sondage-modale-thermo-input')]
      .map((i) => i.value.trim()).filter(Boolean).map((label) => ({ label }));

    if (!question || choix.length < 2) {
      alert('Indique une question et au moins 2 choix.');
      return;
    }

    const res = await appelApi(`/${window.COMMUNE_SLUG}/sondages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, choix, multi_choix }),
    });

    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerThermometre();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de création');
    }
  });
}

function ajouterChoixSondageThermo(corps) {
  choixSondageThermoCompteur++;
  const conteneur = corps.querySelector('#liste-choix-sondage-modale-thermo');
  const ligne = document.createElement('div');
  ligne.innerHTML = `<input type="text" class="choix-sondage-modale-thermo-input" placeholder="Choix ${choixSondageThermoCompteur}" maxlength="120">`;
  conteneur.appendChild(ligne);
}
