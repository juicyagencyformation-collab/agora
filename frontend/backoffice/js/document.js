// frontend/backoffice/js/document.js — rend un devis ou une facture (?type=devis|facture&id=...)
// à partir des informations légales de l'entreprise (Réglages) et des données du document.
// Mentions volontairement complètes (SIRET, TVA ou exonération, numéro séquentiel, désignation,
// délai/pénalités de retard) — voir worker/src/backoffice/facturation.ts pour le contexte légal
// (une facture adressée à une commune doit ensuite être déposée sur Chorus Pro).
(async function () {
  const params = new URLSearchParams(location.search);
  const type = ['facture', 'contrat-dpa'].includes(params.get('type')) ? params.get('type') : 'devis';
  const id = params.get('id');

  const echapper = (s) => (s || '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
  const euros = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const dateFr = (s) => s ? new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  const feuille = document.getElementById('feuille');
  if (!id) { feuille.textContent = 'Document introuvable (id manquant).'; return; }

  // Le contrat DPA est déjà entièrement rendu côté Worker (voir contrat-dpa.ts) — pas de table
  // montants/mentions à construire ici, juste l'afficher tel quel.
  // La convention « Commune fondatrice » est elle aussi rendue côté Worker (convention-document.ts).
  if (type === 'convention') {
    try {
      const { html, commune_nom } = await boFetch('/conventions/' + id + '/document');
      document.title = 'Convention Commune fondatrice — ' + (commune_nom || '') + ' — Backoffice Plateforme-Agora';
      feuille.innerHTML = html;
    } catch (e) {
      feuille.textContent = 'Impossible de charger la convention : ' + (e.message || 'erreur inconnue');
    }
    return;
  }

  if (type === 'contrat-dpa') {
    try {
      await initContratDpa(id);
    } catch (e) {
      feuille.textContent = 'Impossible de charger le contrat : ' + (e.message || 'erreur inconnue');
    }
    return;
  }

  // Contrat DPA + panneau « Informations à compléter » : chaque trou du document ([● …],
  // span.a-completer[data-champ]) correspond à un champ du panneau. Seuls les champs modifiés
  // sont enregistrés : un champ laissé tel quel continue de suivre sa source (convention,
  // annuaire…). Valeurs posées via .value, jamais injectées en HTML.
  async function initContratDpa(communeId) {
    const AIDES = {
      habilitation: "Ce qui autorise le signataire : délibération du conseil, ou délégation générale du maire.",
      telephone_alerte: 'Appelé en cas de fuite de données (article 10), en plus du courriel.',
      dpo: 'Obligatoire pour une commune : souvent le DPO mutualisé du centre de gestion (CDG) ou de l\'intercommunalité.',
      dpa_plafond_responsabilite: 'Montant minimum de votre responsabilité (article 17.2), en euros.',
      entreprise_siret: 'Valable pour toutes les communes, comme les champs suivants.',
    };
    const RACCOURCIS_HABILITATION = [
      ['Délibération', 'la délibération n° … du …'],
      ['Délégation L2122-22', "la délégation consentie par le conseil municipal en application de l'article L2122-22 du CGCT"],
    ];
    const panneau = document.createElement('aside');
    panneau.className = 'panneau';
    panneau.setAttribute('aria-label', 'Informations à compléter');
    document.body.insertBefore(panneau, feuille);
    document.body.classList.add('avec-panneau');
    let manquants = 0;
    let initiales = {};

    const boutonImprimer = document.querySelector('.barre-actions .btn:not(.btn--sec)');
    boutonImprimer.onclick = () => {
      if (manquants && !confirm(`Il reste ${manquants} information(s) à compléter (en rouge). Imprimer quand même ?`)) return;
      window.print();
    };

    const surligner = (cle) => {
      feuille.querySelectorAll('.a-completer.actif').forEach((s) => s.classList.remove('actif'));
      const cibles = feuille.querySelectorAll(`.a-completer[data-champ="${cle}"]`);
      cibles.forEach((s) => s.classList.add('actif'));
      if (cibles[0]) cibles[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    };
    feuille.addEventListener('click', (e) => {
      const trou = e.target.closest('.a-completer');
      const champ = trou && panneau.querySelector(`[name="${trou.dataset.champ}"]`);
      if (!champ) return;
      champ.focus();
      surligner(champ.name);
      champ.classList.remove('flash'); void champ.offsetWidth; champ.classList.add('flash');
    });

    const dessiner = (champs) => {
      const bloc = (groupe, titre) => `<h3>${titre}</h3>` + champs.filter((ch) => ch.groupe === groupe).map((ch) => `
        <div class="champ${ch.valeur ? '' : ' vide'}">
          <label for="dpa-${ch.cle}"><span><span class="point"></span>${echapper(ch.libelle)}</span>${ch.source ? `<span class="source">repris : ${echapper(ch.source)}</span>` : ''}</label>
          ${ch.cle === 'dpa_assurance'
            ? `<select id="dpa-${ch.cle}" name="${ch.cle}"><option value="">— à choisir —</option><option value="titulaire">Déjà souscrite</option><option value="engagement">À souscrire (engagement)</option></select>`
            : `<input id="dpa-${ch.cle}" name="${ch.cle}" type="text" maxlength="300" autocomplete="off"${ch.cle === 'dpa_plafond_responsabilite' ? ' inputmode="numeric" placeholder="ex. 10 000"' : ''}>`}
          ${ch.cle === 'habilitation' ? `<div class="raccourcis">${RACCOURCIS_HABILITATION.map(([lib], i) => `<button type="button" data-raccourci="${i}">${lib}</button>`).join('')}</div>` : ''}
          ${AIDES[ch.cle] ? `<div class="aide">${AIDES[ch.cle]}</div>` : ''}
        </div>`).join('');
      panneau.innerHTML = `
        <div class="panneau__tete">
          <h2>Informations à compléter</h2>
          <span class="pastille ${manquants ? 'pastille--manque' : 'pastille--ok'}">${manquants ? `● ${manquants} manquante${manquants > 1 ? 's' : ''}` : '✓ Contrat complet'}</span>
        </div>
        <form class="panneau__corps" novalidate>
          ${bloc('commune', 'La commune')}
          ${bloc('prestataire', 'Vous (Prestataire)')}
        </form>
        <div class="panneau__pied">
          <button type="button" class="btn" id="dpa-enregistrer">Enregistrer</button>
          <div class="panneau__message" role="status"></div>
        </div>`;
      initiales = {};
      for (const ch of champs) { panneau.querySelector(`[name="${ch.cle}"]`).value = ch.valeur; initiales[ch.cle] = ch.valeur; }
      panneau.querySelectorAll('input, select').forEach((el) => {
        el.addEventListener('focus', () => surligner(el.name));
        el.addEventListener('input', () => el.closest('.champ').classList.toggle('vide', !el.value.trim()));
      });
      panneau.querySelectorAll('[data-raccourci]').forEach((b) => b.addEventListener('click', () => {
        const champ = panneau.querySelector('[name="habilitation"]');
        champ.value = RACCOURCIS_HABILITATION[b.dataset.raccourci][1];
        champ.dispatchEvent(new Event('input'));
        champ.focus();
        const pos = champ.value.indexOf('…');
        if (pos >= 0) champ.setSelectionRange(pos, pos + 1);
      }));
      panneau.querySelector('#dpa-enregistrer').addEventListener('click', enregistrer);
      panneau.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); enregistrer(); });
    };

    const charger = async () => {
      const d = await boFetch('/administration/contrat-dpa/' + communeId);
      document.title = 'Contrat DPA — ' + d.commune_nom + ' — Backoffice Plateforme-Agora';
      feuille.innerHTML = d.html;
      manquants = d.manquants;
      dessiner(d.champs);
    };

    async function enregistrer() {
      const message = panneau.querySelector('.panneau__message');
      const corps = {};
      panneau.querySelectorAll('input, select').forEach((el) => {
        if (el.value.trim() !== (initiales[el.name] || '')) corps[el.name] = el.value.trim();
      });
      if (!Object.keys(corps).length) { message.className = 'panneau__message'; message.textContent = 'Aucune modification.'; return; }
      const bouton = panneau.querySelector('#dpa-enregistrer');
      bouton.disabled = true;
      try {
        await boFetch('/administration/contrat-dpa/' + communeId, { method: 'PUT', body: JSON.stringify(corps) });
        const y = window.scrollY;
        await charger();
        window.scrollTo(0, y);
        const m = panneau.querySelector('.panneau__message');
        m.className = 'panneau__message ok';
        m.textContent = manquants ? 'Enregistré.' : 'Enregistré — le contrat est complet.';
      } catch (e) {
        message.className = 'panneau__message erreur';
        message.textContent = e.message || "L'enregistrement a échoué.";
        bouton.disabled = false;
      }
    }

    await charger();
  }

  let entreprise, doc;
  try {
    entreprise = (await boFetch('/administration/parametres-entreprise')).parametres;
    const chemin = type === 'facture' ? '/administration/factures/' + id : '/administration/devis/' + id;
    doc = (await boFetch(chemin))[type];
  } catch (e) {
    feuille.textContent = 'Impossible de charger le document : ' + (e.message || 'erreur inconnue');
    return;
  }

  document.title = `${type === 'facture' ? 'Facture' : 'Devis'} ${doc.numero} — Backoffice Plateforme-Agora`;

  const montantTva = doc.montant_ttc - doc.montant_ht;
  const ligneTva = doc.taux_tva > 0
    ? `<tr><td class="lib">TVA (${doc.taux_tva}&nbsp;%)</td><td class="val">${euros(montantTva)}</td></tr>`
    : '';

  const mentionsCommunes = `
    <p><strong>${echapper(entreprise.entreprise_raison_sociale)}</strong>${entreprise.entreprise_forme_juridique ? ' — ' + echapper(entreprise.entreprise_forme_juridique) : ''} —
    SIRET&nbsp;: ${echapper(entreprise.entreprise_siret) || '—'}</p>
    <p>${echapper(entreprise.entreprise_adresse)}${entreprise.entreprise_adresse ? ', ' : ''}${echapper(entreprise.entreprise_cp_ville)}</p>
    <p>${echapper(entreprise.entreprise_mention_tva) || 'TVA non applicable, art. 293 B du CGI'}</p>`;

  const blocDroite = type === 'facture'
    ? `<div class="meta__bloc" style="text-align:right">
         <b>Date d'émission</b>${dateFr(doc.date_emission)}<br /><br />
         <b>Date d'échéance</b>${dateFr(doc.date_echeance)}
       </div>`
    : `<div class="meta__bloc" style="text-align:right">
         <b>Date</b>${dateFr(doc.created_at)}<br /><br />
         <b>Validité</b>${doc.validite_jours} jours
       </div>`;

  const mentionsBas = type === 'facture'
    ? `<p><strong>Conditions de règlement</strong> — paiement à réception, délai de ${echapper(entreprise.entreprise_delai_paiement_jours) || '30'} jours à compter de la date d'émission.</p>
       <p><strong>Pénalités de retard</strong> — ${echapper(entreprise.entreprise_taux_penalites) || 'taux légal en vigueur'} ; indemnité forfaitaire pour frais de recouvrement de 40&nbsp;€ en cas de retard de paiement.</p>
       ${entreprise.entreprise_iban ? `<p><strong>Règlement</strong> — IBAN&nbsp;: ${echapper(entreprise.entreprise_iban)}${entreprise.entreprise_bic ? ' · BIC : ' + echapper(entreprise.entreprise_bic) : ''}</p>` : ''}
       <p>Facture adressée à une administration publique : dépôt sur Chorus Pro requis en complément de ce document.</p>`
    : `<p>Devis valable ${doc.validite_jours} jours à compter de sa date d'émission. Bon pour accord à retourner signé, ou par bon de commande.</p>`;

  const signature = type === 'devis'
    ? `<div class="signature"><div class="signature__bloc"><b>Bon pour accord</b>Date et signature</div></div>`
    : '';

  feuille.innerHTML = `
    <header>
      <div>
        <div class="marque">Plateforme-Agora</div>
        <div class="emetteur">
          ${echapper(entreprise.entreprise_raison_sociale)}<br />
          ${echapper(entreprise.entreprise_adresse)}<br />
          ${echapper(entreprise.entreprise_cp_ville)}<br />
          SIRET ${echapper(entreprise.entreprise_siret) || '—'}<br />
          ${echapper(entreprise.entreprise_email)} ${entreprise.entreprise_telephone ? '· ' + echapper(entreprise.entreprise_telephone) : ''}
        </div>
      </div>
      <div class="titre-doc">
        <h1>${type === 'facture' ? 'FACTURE' : 'DEVIS'}</h1>
        <div class="numero">N° ${echapper(doc.numero)}</div>
      </div>
    </header>

    <div class="meta">
      <div class="dest">
        <b>${echapper(doc.nom_destinataire)}</b>
        <span>${echapper(doc.adresse_destinataire) || ''}</span>
      </div>
      ${blocDroite}
    </div>

    <table class="lignes">
      <thead><tr><th>Désignation</th><th class="montant">Montant HT</th></tr></thead>
      <tbody>
        <tr><td>${echapper(doc.objet)}${doc.duree_engagement_mois ? `<br /><span style="color:var(--gris);font-size:12px">Engagement ${doc.duree_engagement_mois} mois</span>` : ''}</td><td class="montant">${euros(doc.montant_ht)}</td></tr>
      </tbody>
    </table>

    <div class="totaux">
      <table>
        <tr><td class="lib">Total HT</td><td class="val">${euros(doc.montant_ht)}</td></tr>
        ${ligneTva}
        <tr class="total"><td class="lib">Total ${type === 'facture' ? 'à payer' : ''} TTC</td><td class="val">${euros(doc.montant_ttc)}</td></tr>
      </table>
    </div>

    ${signature}

    <div class="mentions">
      ${mentionsCommunes}
      ${mentionsBas}
    </div>

    <footer>${echapper(entreprise.entreprise_raison_sociale)} · plateforme-agora.fr</footer>
  `;
})();
