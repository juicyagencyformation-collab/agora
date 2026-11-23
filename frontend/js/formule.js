// frontend/js/formule.js
// Volet « Votre formule » de Ma commune et demande de changement de formule (2026-11-18,
// migration 105, serveur : worker/src/lib/formule-commune.ts). Partagé avec la fenêtre des onglets
// grisés (navigation.js, ouvrirModaleModuleVerrouille). Rien ne s'active d'ici : la demande part
// à l'équipe Plateforme-Agora, qui rappelle ; la formule est activée à la main ensuite.

// Ce que chaque onglet payant apporte, en une ligne (affiché dans le menu « En plus »).
const DESCRIPTIONS_ONGLETS_FORMULE = {
  conseil: ['🏛️', 'Conseil municipal', 'Délibérations et comptes rendus consultables par tous.'],
  bulletin: ['📰', 'Bulletin municipal', 'Le bulletin rédigé à plusieurs, publié dans l’appli.'],
  annuaire: ['📇', 'Annuaire et associations', 'Artisans, services ; les associations tiennent leur fiche à jour.'],
  coups_de_main: ['🤝', 'Coups de main', 'Covoiturage, prêt d’outils, courses entre voisins.'],
  mur: ['💬', 'Mur des voisins', 'Petits messages du quotidien, effacés au bout de 48 h.'],
  thermometre: ['🌡️', 'Thermomètre', 'Des sondages rapides pour prendre l’avis des habitants.'],
  photo_du_jour: ['📸', 'Photo du jour', 'Les habitants partagent leurs plus belles vues du village.'],
  memoire: ['📜', 'Mémoire du village', 'Souvenirs, photos anciennes, histoire des familles.'],
  lois: ['⚖️', 'Lois', 'Les textes qui concernent les communes, à suivre.'],
};
const JOURNAL_PAPIER_FORMULE = ['🗞️', 'Journal papier automatique', 'Le journal de la commune préparé tout seul à partir des actualités et de l’agenda, prêt à imprimer.'];
const LIBELLES_ONGLETS_INCLUS = {
  actualites: 'Actualités', agenda: 'Agenda', alertes: 'Signalements', chasse_tresor: 'Chasse au trésor', enigmes: 'Énigme photo',
};

let infosFormuleCache = null;
async function chargerInfosFormule(forcer = false) {
  if (infosFormuleCache && !forcer) return infosFormuleCache;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune/formule`).catch(() => null);
  infosFormuleCache = res?.ok ? await res.json() : null;
  return infosFormuleCache;
}

const euros = (n) => `${Math.round(n).toLocaleString('fr-FR')} €`;
// Au-delà du seuil du barème (sur_devis, voir lib/formule-commune.ts) : jamais de prix calculé.
// Prix 0 = Autonomie gratuite à vie sous le seuil du barème (tarification.ts, estGratuitAVie).
const prixAn = (infos, cle) => (infos.sur_devis ? 'sur devis'
  : infos.prix_annuels[cle] === 0 ? 'gratuit à vie' : `${euros(infos.prix_annuels[cle])}/an`);
// Par habitant et par mois, en centimes tant que c'est moins d'un euro.
function parHabitantMois(prixAnnuel, population) {
  if (!population) return '';
  const centimes = Math.round((prixAnnuel / 12 / population) * 100);
  return centimes < 100 ? `${centimes} centime${centimes > 1 ? 's' : ''} par habitant et par mois`
    : `${(centimes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € par habitant et par mois`;
}
function libelleFormule(infos) {
  return {
    gratuite: 'Gratuite', autonomie: infos.offres.autonomie.label, accompagne: infos.offres.accompagne.label,
    premium: `${infos.offres.accompagne.label}, avec balades du patrimoine`, fondateur: 'Commune fondatrice', complete: 'Version complète',
  }[infos.formule] || infos.formule;
}
const dateCourte = (iso) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

function htmlCarteOffre(infos, cle) {
  const offre = infos.offres[cle];
  const prix = infos.prix_annuels[cle];
  return `
    <div class="carte-offre-formule ${cle === 'autonomie' ? 'mise-en-avant' : ''}">
      ${cle === 'autonomie' && offre.badge ? `<span class="etiquette-offre-formule">${escapeAttr(offre.badge)}</span>` : ''}
      <span class="nom-offre-formule">${escapeAttr(offre.label)}</span>
      <span class="titre-offre-formule">${escapeAttr(offre.titre)}</span>
      ${infos.sur_devis ? '<span class="montant-offre-formule">Sur devis</span>'
        : prix === 0 ? '<span class="montant-offre-formule">Gratuit</span><span class="mois-offre-formule">à vie, pour votre commune</span>' : `
      <span class="montant-offre-formule">${euros(prix)} <small>/ an</small></span>
      <span class="mois-offre-formule">soit ${euros(prix / 12)} / mois</span>
      ${infos.population ? `<span class="hab-offre-formule">${parHabitantMois(prix, infos.population)}</span>` : ''}`}
      <details class="detail-offre-formule"><summary>Ce qui est compris</summary><ul>${offre.features.map((f) => `<li>${escapeAttr(f)}</li>`).join('')}</ul></details>
    </div>`;
}

async function chargerPanneauFormule() {
  const zone = document.getElementById('panneau-formule');
  if (!zone) return;
  const infos = await chargerInfosFormule(true);
  if (!infos) { zone.innerHTML = '<p class="dechets-vide">Impossible de charger votre formule pour le moment.</p>'; return; }

  const inclus = infos.onglets_inclus.map((cle) => LIBELLES_ONGLETS_INCLUS[cle] || DESCRIPTIONS_ONGLETS_FORMULE[cle]?.[1] || cle);
  const enPlus = infos.onglets_verrouilles.map((cle) => DESCRIPTIONS_ONGLETS_FORMULE[cle] || ['🔒', cle, '']);
  if (infos.formule === 'gratuite') enPlus.push(JOURNAL_PAPIER_FORMULE);
  const cartes = infos.formule === 'gratuite' ? ['autonomie', 'accompagne'] : infos.formule === 'autonomie' ? ['accompagne'] : [];

  zone.innerHTML = `
    <div class="formule-actuelle"><div><span>Formule actuelle</span><strong>${escapeAttr(libelleFormule(infos))}</strong></div></div>
    <p class="groupe-formule">✓ Inclus</p>
    <div class="pastilles-inclus-formule">${inclus.map((n) => `<span>${escapeAttr(n)}</span>`).join('')}</div>
    ${enPlus.length ? `
      <details class="en-plus-formule">
        <summary>🔒 En plus avec une formule payante : ${infos.onglets_verrouilles.length} onglet${infos.onglets_verrouilles.length > 1 ? 's' : ''}${infos.formule === 'gratuite' ? ' et le journal papier' : ''}</summary>
        <ul>${enPlus.map(([icone, nom, texte]) => `<li><span>${icone}</span><span><b>${escapeAttr(nom)}${nom === JOURNAL_PAPIER_FORMULE[1] ? ' <span class="beta-formule">Bêta</span>' : ''}</b>${escapeAttr(texte)}</span></li>`).join('')}</ul>
      </details>` : ''}
    ${cartes.length ? `
      <p class="groupe-formule">Prix pour votre commune${infos.population ? ` (${infos.population.toLocaleString('fr-FR')} habitants)` : ''}</p>
      <div class="cartes-offres-formule">${cartes.map((c) => htmlCarteOffre(infos, c)).join('')}</div>
      <p class="note-formule">Facturé annuellement, déposé sur Chorus Pro. Sans engagement de durée.</p>` : `
      <p class="note-formule">Votre commune a accès à toutes les fonctionnalités de l’application.</p>`}
    <div class="option-patrimoine-formule"><span>🏰</span><span><b>En option : balades du patrimoine</b>Un pack de parcours pour faire découvrir le patrimoine de votre commune, créé avec vous. Sur devis.</span></div>
    ${infos.demande_en_cours ? `<div class="demande-en-cours-formule">⏳ Demande envoyée le ${dateCourte(infos.demande_en_cours.created_at)} : l’équipe Plateforme-Agora vous rappelle très vite.</div>` : ''}
    ${infos.peut_demander ? '<button type="button" class="btn-demander-formule">Demander à changer de formule</button>' : ''}
  `;
  zone.querySelector('.btn-demander-formule')?.addEventListener('click', () => ouvrirDemandeFormule(infos));
}

function ouvrirDemandeFormule(infos) {
  const option = (valeur, titre, sousTitre, coche) => `
    <label class="choix-formule"><input type="radio" name="formule_souhaitee" value="${valeur}" ${coche ? 'checked' : ''}>
      <span><b>${titre}</b><small>${sousTitre}</small></span></label>`;
  const overlay = ouvrirModaleFormulaire('Changer de formule', `
    <form id="form-demande-formule">
      <div class="choix-formules">
        ${infos.formule === 'gratuite' ? option('autonomie', `${escapeAttr(infos.offres.autonomie.label)} · ${prixAn(infos, 'autonomie')}`, escapeAttr(infos.offres.autonomie.titre), false) : ''}
        ${option('accompagne', `${escapeAttr(infos.offres.accompagne.label)} · ${prixAn(infos, 'accompagne')}`, escapeAttr(infos.offres.accompagne.titre), true)}
        ${option('conseil', 'Je ne sais pas encore', 'Conseillez-moi au téléphone', false)}
      </div>
      <label for="tel-demande-formule" class="label-formule">Téléphone pour vous rappeler</label>
      <input type="tel" id="tel-demande-formule" required maxlength="30" value="${escapeAttr(infos.telephone_mairie || '')}">
      <label for="msg-demande-formule" class="label-formule">Un mot à ajouter (facultatif)</label>
      <textarea id="msg-demande-formule" maxlength="1000" placeholder="Ex. : plutôt le mardi matin, le conseil se réunit le 4 décembre."></textarea>
      <button type="submit">Envoyer ma demande</button>
      <p class="note-formule" style="text-align:center;margin-top:8px;">Rien n’est activé ni facturé à cette étape.</p>
    </form>
  `);
  overlay.querySelector('#form-demande-formule').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bouton = e.currentTarget.querySelector('button[type="submit"]');
    bouton.disabled = true;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune/demande-formule`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        formule_souhaitee: overlay.querySelector('input[name="formule_souhaitee"]:checked').value,
        telephone: overlay.querySelector('#tel-demande-formule').value.trim(),
        message: overlay.querySelector('#msg-demande-formule').value.trim(),
      }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({})) ?? {};
    if (!res?.ok) {
      bouton.disabled = false;
      afficherToastMessage(data.erreur || 'Envoi impossible pour le moment, réessayez.', 'erreur');
      return;
    }
    fermerModaleFormulaire(overlay);
    afficherConfirmationDemandeFormule(data.demande);
    chargerPanneauFormule();
  });
}

function afficherConfirmationDemandeFormule(demande) {
  const formule = { autonomie: 'Autonomie', accompagne: 'Accompagné', conseil: 'à choisir avec vous' }[demande?.formule_souhaitee] || '';
  ouvrirModaleFormulaire('Demande envoyée', `
    <div class="confirmation-formule">
      <div class="coche-formule">✓</div>
      <p>L’équipe Plateforme-Agora vous rappelle sous 48 h (jours ouvrés).</p>
      <ol class="etapes-formule">
        <li class="fait"><span>✓</span><span><b>Votre demande</b><small>Formule ${formule}, envoyée le ${dateCourte(demande?.created_at || Date.now())}.</small></span></li>
        <li><span>2</span><span><b>Un appel</b><small>Pour répondre à vos questions et préparer la convention.</small></span></li>
        <li><span>3</span><span><b>La convention</b><small>Signée en ligne, sans courrier. Vous pouvez la présenter au conseil.</small></span></li>
        <li><span>4</span><span><b>Les onglets s’ouvrent</b><small>Dès la signature, sans rien à installer.</small></span></li>
      </ol>
    </div>
  `);
}

// Fenêtre d'un onglet grisé (navigation.js) : ce qu'apporte le module, le prix de la commune et
// le bouton de demande. Si le volet ne se charge pas, la fenêtre garde son texte habituel.
async function completerPopupModuleVerrouille(overlay, cleApi) {
  const infos = await chargerInfosFormule();
  if (!infos || !overlay.isConnected) return;
  const corps = overlay.querySelector('.corps-modale-formulaire');
  const description = DESCRIPTIONS_ONGLETS_FORMULE[cleApi]?.[2];
  const bloc = document.createElement('div');
  bloc.className = 'complement-popup-formule';
  bloc.innerHTML = `
    ${description ? `<p class="apport-module-formule">${escapeAttr(description)}</p>` : ''}
    ${infos.formule === 'gratuite' ? (infos.sur_devis ? '<p>Pour votre commune : tarif <b>sur devis</b>.</p>'
      : `<p>Pour votre commune : <b>${escapeAttr(infos.offres.autonomie.label)} ${prixAn(infos, 'autonomie')}</b> ou <b>${escapeAttr(infos.offres.accompagne.label)} ${prixAn(infos, 'accompagne')}</b>.</p>`) : ''}
    ${infos.demande_en_cours ? `<p class="demande-en-cours-formule">⏳ Demande envoyée le ${dateCourte(infos.demande_en_cours.created_at)} : l’équipe vous rappelle très vite.</p>` : ''}
    ${infos.peut_demander ? '<button type="button" class="btn-demander-formule">Demander à changer de formule</button>' : ''}
    <button type="button" class="btn-voir-formules">Voir ce que comprend chaque formule</button>
  `;
  corps.appendChild(bloc);
  bloc.querySelector('.btn-demander-formule')?.addEventListener('click', () => { fermerModaleFormulaire(overlay); ouvrirDemandeFormule(infos); });
  bloc.querySelector('.btn-voir-formules').addEventListener('click', () => {
    fermerModaleFormulaire(overlay);
    activerOnglet('commune');
    const volet = document.querySelector('#volet-formule .volet-contenu');
    if (volet && !volet.classList.contains('ouvert')) volet.previousElementSibling.click();
    setTimeout(() => document.getElementById('volet-formule')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  });
}
