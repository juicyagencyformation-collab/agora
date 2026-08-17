// frontend/backoffice/js/document.js — rend un devis ou une facture (?type=devis|facture&id=...)
// à partir des informations légales de l'entreprise (Réglages) et des données du document.
// Mentions volontairement complètes (SIRET, TVA ou exonération, numéro séquentiel, désignation,
// délai/pénalités de retard) — voir worker/src/backoffice/facturation.ts pour le contexte légal
// (une facture adressée à une commune doit ensuite être déposée sur Chorus Pro).
(async function () {
  const params = new URLSearchParams(location.search);
  const type = params.get('type') === 'facture' ? 'facture' : 'devis';
  const id = params.get('id');

  const echapper = (s) => (s || '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
  const euros = (n) => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const dateFr = (s) => s ? new Date(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  const feuille = document.getElementById('feuille');
  if (!id) { feuille.textContent = 'Document introuvable (id manquant).'; return; }

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
