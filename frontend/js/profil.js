// frontend/js/profil.js

const LABELS_BADGES = {
  premier_pas: { nom: 'Premier pas', icone: '👣', description: 'Bienvenue sur Agora !' },
  assidu: { nom: 'Assidu', icone: '🔥', description: '7 jours de connexion d\'affilée' },
  super_assidu: { nom: 'Super assidu', icone: '⚡', description: '30 jours de connexion d\'affilée' },
  connexion_10: { nom: 'Habitué', icone: '🔥', description: '10 jours de connexion d\'affilée' },
  connexion_20: { nom: 'Régulier', icone: '🌿', description: '20 jours de connexion d\'affilée' },
  connexion_40: { nom: 'Fidèle', icone: '💪', description: '40 jours de connexion d\'affilée' },
  connexion_50: { nom: 'Mi-centaine', icone: '⭐', description: '50 jours de connexion d\'affilée' },
  connexion_75: { nom: 'Increvable', icone: '🔆', description: '75 jours de connexion d\'affilée' },
  connexion_100: { nom: 'Centenaire', icone: '💯', description: '100 jours de connexion d\'affilée' },
  connexion_150: { nom: 'Persévérant', icone: '🧗', description: '150 jours de connexion d\'affilée' },
  connexion_200: { nom: 'Bicentenaire', icone: '🌟', description: '200 jours de connexion d\'affilée' },
  connexion_300: { nom: 'Tricentenaire', icone: '☄️', description: '300 jours de connexion d\'affilée' },
  connexion_365: { nom: 'Une année entière', icone: '🎂', description: '365 jours de connexion d\'affilée — un an !' },
  connexion_400: { nom: 'Marathonien', icone: '🏅', description: '400 jours de connexion d\'affilée' },
  connexion_500: { nom: 'Demi-millénaire', icone: '🎖️', description: '500 jours de connexion d\'affilée' },
  connexion_600: { nom: 'Sentinelle du temps', icone: '⏳', description: '600 jours de connexion d\'affilée' },
  connexion_700: { nom: 'Vétéran', icone: '🛡️', description: '700 jours de connexion d\'affilée' },
  connexion_1000: { nom: 'Millénaire', icone: '👑', description: '1000 jours de connexion d\'affilée' },
  pilier_du_village: { nom: 'Pilier du village', icone: '🏛️', description: 'Niveau 5 atteint' },
  sentinelle: { nom: 'Sentinelle', icone: '👁️', description: '5 alertes signalées' },
  voisin_solidaire: { nom: 'Voisin solidaire', icone: '🤝', description: '3 annonces d\'entraide publiées' },
  premier_regard: { nom: 'Premier regard', icone: '👀', description: '5 photos du jour validées' },
  oeil_aiguise: { nom: 'Œil aiguisé', icone: '🔍', description: '20 photos du jour validées' },
  curateur_quartier: { nom: 'Curateur de quartier', icone: '🖼️', description: '50 photos du jour validées' },
  curateur_village: { nom: 'Curateur du village', icone: '🏘️', description: '150 photos du jour validées' },
  grand_curateur: { nom: 'Grand curateur', icone: '🎖️', description: '500 photos du jour validées' },
  legende_galerie: { nom: 'Légende de la galerie', icone: '👑', description: '1000 photos du jour validées' },
  protecteur_village: { nom: 'Protecteur du village', icone: '🛡️', description: '3 signalements confirmés par la mairie' },
  explorateur_debutant: { nom: 'Explorateur débutant', icone: '🧭', description: '3 énigmes photo résolues' },
  explorateur_confirme: { nom: 'Explorateur confirmé', icone: '🗺️', description: '10 énigmes photo résolues' },
  grand_explorateur: { nom: 'Grand explorateur', icone: '🏔️', description: '25 énigmes photo résolues' },
  chercheur_tresor: { nom: 'Chercheur de trésor', icone: '🧩', description: '5 étapes de chasse validées' },
  maitre_chasseur: { nom: 'Maître chasseur', icone: '🏆', description: '20 étapes de chasse validées' },
  legende_tresor: { nom: 'Légende du trésor', icone: '👑', description: '50 étapes de chasse validées' },
  finisseur: { nom: 'Finisseur', icone: '🎯', description: 'Une chasse au trésor terminée à 100%' },
  explorateur_assidu: { nom: 'Explorateur assidu', icone: '🔥', description: '5 jours d\'affilée avec une action d\'exploration' },
  maitre_exploration: { nom: 'Maître de l\'exploration', icone: '🌟', description: '20 étapes de chasse + 10 énigmes trouvées' },
  lecteur_assidu: { nom: 'Lecteur assidu', icone: '📰', description: '10 articles lus' },
  grand_lecteur: { nom: 'Grand lecteur', icone: '📚', description: '50 articles lus' },
  erudit_village: { nom: 'Érudit du village', icone: '🎓', description: '150 articles lus' },
  citoyen_eclaire: { nom: 'Citoyen éclairé', icone: '🧠', description: 'Au moins un article lu dans chacune des 5 catégories' },
  organisateur_debutant: { nom: 'Organisateur', icone: '🎪', description: '3 événements créés' },
  grand_organisateur: { nom: 'Grand organisateur', icone: '🎭', description: '10 événements créés' },
  pilier_evenements: { nom: 'Pilier des événements', icone: '🏟️', description: '25 événements créés' },
  evenement_reussi: { nom: 'Événement réussi', icone: '🎉', description: 'Un de vos événements a réuni au moins 10 participants' },
};

// Ancienneté façon Reddit ("6 mois") — pas de précision au jour près, juste un repère.
function formaterAnciennete(dateCreation) {
  const jours = Math.floor((Date.now() - new Date(dateCreation).getTime()) / 86400000);
  if (jours < 1) return 'Aujourd\'hui';
  if (jours < 30) return `${jours} jour${jours > 1 ? 's' : ''}`;
  if (jours < 365) { const mois = Math.floor(jours / 30); return `${mois} mois`; }
  const annees = Math.floor(jours / 365);
  return `${annees} an${annees > 1 ? 's' : ''}`;
}

async function chargerProfil() {
  const zone = document.getElementById('contenu-profil');
  if (!zone) return;
  zone.innerHTML = `<p class="dechets-vide">Chargement…</p>`;

  const res = await appelApi(`/${window.COMMUNE_SLUG}/profil`);
  if (!res.ok) {
    zone.innerHTML = `<p class="dechets-vide">Impossible de charger le profil.</p>`;
    return;
  }
  const data = await res.json();

  const xpDansNiveau = data.xp - data.xp_niveau_actuel;
  const xpPourNiveau = data.xp_niveau_suivant - data.xp_niveau_actuel;
  const pct = xpPourNiveau > 0 ? Math.round((xpDansNiveau / xpPourNiveau) * 100) : 100;
  // La photo perso remplace le logo de la commune (repli sur le logo, puis sur l'icône par défaut).
  const photoOuLogo = data.photo_profil_url || window.COMMUNE_LOGO_URL;

  zone.innerHTML = `
    <div class="banniere-profil" style="${data.banniere_url ? `background-image:url('${data.banniere_url}');` : ''}">
      <button type="button" id="btn-changer-banniere" class="bouton-changer-media bouton-changer-banniere" title="Changer la bannière">📷</button>
      <div class="badge-xp-commune badge-xp-profil-hero" style="--pct: ${pct};">
        <div class="interieur-badge-xp">
          ${photoOuLogo ? `<img src="${photoOuLogo}" alt="">` : '<span class="logo-defaut-badge-xp">🏛️</span>'}
        </div>
        <div class="niveau-overlay-badge-xp">${data.niveau}</div>
        <button type="button" id="btn-changer-photo" class="bouton-changer-media bouton-changer-photo" title="Changer la photo">📷</button>
      </div>
    </div>
    <input type="file" id="input-photo-profil" accept="image/jpeg,image/png,image/webp" hidden>
    <input type="file" id="input-banniere-profil" accept="image/jpeg,image/png,image/webp" hidden>

    <div class="identite-profil-hero">
      <strong>${escapeAttr(data.prenom)} ${escapeAttr(data.nom)} <button type="button" id="btn-editer-identite" title="Modifier mon nom" style="background:none;border:none;cursor:pointer;font-size:14px;padding:0 0 0 4px;">✏️</button></strong>
      <small>${xpDansNiveau} / ${xpPourNiveau} XP vers le niveau ${data.niveau + 1}</small>
    </div>

    <div class="recap-stats-profil">
      <div><strong>${data.contributions_total}</strong><span>Contribution${data.contributions_total > 1 ? 's' : ''}</span></div>
      <div><strong>${data.score_citoyen ?? 0}</strong><span>Score citoyen</span></div>
      <div><strong>${formaterAnciennete(data.created_at)}</strong><span>Ancienneté</span></div>
    </div>

    <div class="carte-categorie-profil">
      <button type="button" class="entete-categorie-profil"><span>🏆 Progression</span><span class="chevron">▲</span></button>
      <div class="corps-categorie-profil">
        <div class="carte-dashboard streak-carte">
          <div><span class="streak-nombre">🔥 ${data.streak_actuel}</span><span class="streak-label">jour(s) d'affilée</span></div>
          <div><span class="streak-nombre">🏆 ${data.streak_record}</span><span class="streak-label">record personnel</span></div>
        </div>
        <h3 style="font-size:15px;margin-top:18px;">Badges obtenus (${data.badges.length}/${Object.keys(LABELS_BADGES).length})</h3>
        <div class="grille-badges">
          ${Object.entries(LABELS_BADGES).map(([cle, info]) => {
            const obtenu = data.badges.find((b) => b.cle_badge === cle);
            return `
              <div class="badge-item ${obtenu ? 'badge-obtenu' : 'badge-verrouille'}" title="${escapeAttr(info.description)}">
                <div class="badge-icone">${info.icone}</div>
                <div class="badge-nom">${escapeAttr(info.nom)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>

    <div class="carte-categorie-profil">
      <button type="button" class="entete-categorie-profil"><span>🌍 Participation citoyenne</span><span class="chevron">▾</span></button>
      <div class="corps-categorie-profil" hidden>
        ${renderSectionParticipationCitoyenne(data.participation)}
      </div>
    </div>

    <div class="carte-categorie-profil">
      <button type="button" class="entete-categorie-profil"><span>⭐ Noter l'application</span><span class="chevron">▾</span></button>
      <div class="corps-categorie-profil" hidden>
        <p style="font-size:12.5px;color:var(--roseau);margin:0 0 10px;">Ton avis nous aide à améliorer Agora.</p>
        <div class="etoiles-note" id="etoiles-note-app">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="etoile-note" data-note="${n}" aria-label="${n} étoile(s)">★</button>`).join('')}
        </div>
        <textarea id="commentaire-avis-app" placeholder="Un petit commentaire (optionnel)" maxlength="1000">${escapeAttr(data.mon_avis?.commentaire || '')}</textarea>
        <button type="button" id="btn-envoyer-avis" class="bouton-pilule-profil" style="color:var(--eau);border-color:var(--eauL);">Envoyer mon avis</button>
        <p id="msg-avis-app" style="font-size:12px;margin-top:6px;"></p>
      </div>
    </div>
  `;

  initUploadsMediaProfil();
  initNoterApplication(data.mon_avis);
  initReglagesRgpdProfil();
  initEditionIdentite(data);
}

// ── Modifier son prénom / nom ──

function initEditionIdentite(data) {
  const btn = document.getElementById('btn-editer-identite');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const html = `
      <form id="form-identite">
        <label style="display:block;font-size:12.5px;color:var(--roseau);margin-bottom:3px;">Prénom</label>
        <input type="text" id="edit-prenom" maxlength="80" required value="${escapeAttr(data.prenom || '')}">
        <label style="display:block;font-size:12.5px;color:var(--roseau);margin:10px 0 3px;">Nom</label>
        <input type="text" id="edit-nom" maxlength="80" required value="${escapeAttr(data.nom || '')}">
        <button type="submit" style="margin-top:12px;">Enregistrer</button>
      </form>
    `;
    const overlay = ouvrirModaleFormulaire('Modifier mon identité', html);
    overlay.querySelector('#form-identite').addEventListener('submit', async (e) => {
      e.preventDefault();
      const prenom = overlay.querySelector('#edit-prenom').value.trim();
      const nom = overlay.querySelector('#edit-nom').value.trim();
      if (!prenom || !nom) return;
      const res = await appelApi(`/${window.COMMUNE_SLUG}/profil/identite`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prenom, nom }),
      });
      if (res.ok) {
        fermerModaleFormulaire(overlay);
        afficherToastMessage('Identité mise à jour.', 'succes');
        chargerProfil();
      } else {
        const d = await res.json();
        afficherToastMessage(d.erreur ? JSON.stringify(d.erreur) : 'Erreur', 'erreur');
      }
    });
  });
}

// ── Noter l'application (1 à 5 étoiles + commentaire), destiné au futur back-office ──

function initNoterApplication(monAvis) {
  const zoneEtoiles = document.getElementById('etoiles-note-app');
  if (!zoneEtoiles) return;
  let note = monAvis?.note || 0;

  const peindreEtoiles = () => {
    zoneEtoiles.querySelectorAll('.etoile-note').forEach((etoile) => {
      etoile.classList.toggle('active', Number(etoile.dataset.note) <= note);
    });
  };
  peindreEtoiles();

  zoneEtoiles.querySelectorAll('.etoile-note').forEach((etoile) => {
    etoile.addEventListener('click', () => { note = Number(etoile.dataset.note); peindreEtoiles(); });
  });

  document.getElementById('btn-envoyer-avis').addEventListener('click', async () => {
    const msg = document.getElementById('msg-avis-app');
    if (!note) { msg.style.color = 'var(--rouge)'; msg.textContent = 'Choisis une note (1 à 5 étoiles).'; return; }
    const commentaire = document.getElementById('commentaire-avis-app').value.trim();
    const res = await appelApi(`/${window.COMMUNE_SLUG}/profil/avis`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, commentaire }),
    });
    if (res.ok) { msg.style.color = 'var(--prairie)'; msg.textContent = 'Merci pour ton avis ! 🙏'; }
    else { msg.style.color = 'var(--rouge)'; msg.textContent = 'Erreur, réessaie.'; }
  });
}

// ── Photo de profil et bannière personnelles ──

function initUploadsMediaProfil() {
  const inputPhoto = document.getElementById('input-photo-profil');
  const inputBanniere = document.getElementById('input-banniere-profil');

  document.getElementById('btn-changer-photo')?.addEventListener('click', () => inputPhoto.click());
  document.getElementById('btn-changer-banniere')?.addEventListener('click', () => inputBanniere.click());

  inputPhoto?.addEventListener('change', (e) => {
    if (e.target.files[0]) envoyerMediaProfil('photo', e.target.files[0]);
  });
  inputBanniere?.addEventListener('change', (e) => {
    if (e.target.files[0]) envoyerMediaProfil('banniere', e.target.files[0]);
  });
}

async function envoyerMediaProfil(type, fichier) {
  // Pas de compresserImage() : elle convertit systématiquement en JPEG, ce qui détruirait la
  // transparence d'un PNG (même raison que le logo de la commune et de l'annuaire).
  const res = await appelApi(`/${window.COMMUNE_SLUG}/profil/${type}`, {
    method: 'POST', headers: { 'Content-Type': fichier.type }, body: fichier,
  });
  if (res.ok) {
    chargerProfil();
  } else {
    const data = await res.json();
    afficherToastMessage(data.erreur || 'Échec de l\'envoi.', 'erreur');
  }
}

// ── Déconnexion + volets repliables des catégories — attachés une seule fois (éléments
// statiques de index.html), pas à chaque rechargement du profil. ──

function initBoutonDeconnexionProfil() {
  const btn = document.getElementById('btn-deconnexion');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    await appelApi(`/${window.COMMUNE_SLUG}/auth/logout`, { method: 'POST' });
    document.location.href = 'connexion.html';
  });
}

function initTogglesCategoriesProfil() {
  document.getElementById('onglet-profil')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.entete-categorie-profil');
    if (!btn) return;
    const corps = btn.nextElementSibling;
    const seraOuvert = corps.hidden;
    corps.hidden = !seraOuvert;
    btn.querySelector('.chevron').textContent = seraOuvert ? '▲' : '▾';
  });
}

// ── Score de participation citoyenne — système séparé de l'XP/niveau ci-dessus, voir
// worker/src/lib/points-citoyens.ts. Les badges sont récupérés dynamiquement (contrairement
// à LABELS_BADGES codé en dur) car pilotés en base par le superadmin. ──

function renderSectionParticipationCitoyenne(participation) {
  if (!participation) return '';

  const badgesDebloques = participation.badges.filter((b) => b.debloque).length;

  return `
    <div class="carte-dashboard carte-score-citoyen">
      <div class="palier-cercle">${participation.palier_actuel ? '🌍' : '🌱'}</div>
      <div class="details-score-citoyen">
        <strong>${participation.palier_actuel ? escapeAttr(participation.palier_actuel.nom) : 'Pas encore de palier'}</strong>
        <div class="jauge" style="margin-top:6px;"><div class="jauge-remplie" style="width:${participation.progression_pct}%"></div></div>
        <small style="color:var(--roseau);">${participation.palier_suivant
          ? `Prochain palier : ${escapeAttr(participation.palier_suivant.nom)}`
          : (participation.palier_actuel ? 'Palier maximum atteint 🎉' : 'Participez à une première action pour débuter')}</small>
        <p style="font-family:'DM Mono',monospace;font-size:13px;color:var(--prairie);font-weight:700;margin:6px 0 0;">${participation.score_citoyen} points</p>
      </div>
    </div>

    <div class="carte-dashboard streak-carte">
      <div><span class="streak-nombre">🔥 ${participation.streak_actuel}</span><span class="streak-label">action(s) d'affilée</span></div>
      <div><span class="streak-nombre">🏆 ${participation.streak_record}</span><span class="streak-label">record personnel</span></div>
    </div>

    ${participation.suspendu_jusqu_au ? `<p class="suspension-participation">⏸️ Inscriptions à de nouvelles actions suspendues jusqu'au ${new Date(participation.suspendu_jusqu_au).toLocaleDateString('fr-FR')} (plusieurs absences non signalées).</p>` : ''}

    <h3 style="font-size:15px;margin-top:18px;">Badges citoyens (${badgesDebloques}/${participation.badges.length})</h3>
    <div class="grille-badges">
      ${participation.badges.length ? participation.badges.map((b) => `
        <div class="badge-item ${b.debloque ? 'badge-obtenu' : 'badge-verrouille'}" title="${escapeAttr(b.description || '')}">
          <div class="badge-icone">${b.visuel_url ? `<img src="${b.visuel_url}" alt="">` : '🏅'}</div>
          <div class="badge-nom">${escapeAttr(b.nom)}</div>
        </div>
      `).join('') : '<p class="dechets-vide">Aucun badge citoyen pour l\'instant.</p>'}
    </div>

    <h3 style="font-size:15px;margin-top:18px;">Historique récent</h3>
    <div class="historique-participation">
      ${participation.historique_recent.length ? participation.historique_recent.map((h) => `
        <div class="ligne-toggle-onglet">
          <span>${escapeAttr(h.raison)}${h.valide_par_nom ? ` · validé par ${escapeAttr(h.valide_par_nom)}` : ''}</span>
          <span style="font-family:'DM Mono',monospace;color:${h.montant >= 0 ? 'var(--prairie)' : 'var(--rouge)'};">${h.montant >= 0 ? '+' : ''}${h.montant}</span>
        </div>
      `).join('') : '<p class="dechets-vide">Aucune activité pour l\'instant.</p>'}
    </div>
  `;
}

// ── Droits RGPD : export de mes données, suppression de mon compte ──

function initReglagesRgpdProfil() {
  const zone = document.getElementById('reglages-rgpd-profil');
  if (!zone) return;

  zone.innerHTML = `
    <button type="button" id="btn-telecharger-donnees" class="bouton-pilule-profil" style="color:var(--eau);border-color:var(--eauL);">📥 Télécharger mes données</button>
    <button type="button" id="btn-supprimer-compte" class="bouton-pilule-profil" style="margin-top:8px;color:var(--rouge);border-color:var(--rouge);">🗑️ Supprimer mon compte</button>
    <p style="font-size:11.5px;color:var(--roseau);margin-top:6px;">
      La suppression efface définitivement vos données personnelles (email, mot de passe, nom).
      Le contenu que vous avez publié reste visible mais n'est plus rattaché à votre identité.
    </p>

    <div class="liens-legaux-profil">
      <a href="/confidentialite.html" target="_blank" rel="noopener">📄 Politique de confidentialité (RGPD)</a>
      <a href="/mentions-legales.html" target="_blank" rel="noopener">📄 Mentions légales</a>
      <a href="/conditions-utilisation.html" target="_blank" rel="noopener">📄 Conditions générales d'utilisation</a>
    </div>
  `;

  zone.querySelector('#btn-telecharger-donnees').addEventListener('click', async () => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/auth/mes-donnees`);
    if (!res.ok) { afficherToastMessage('Erreur lors de la récupération de vos données.', 'erreur'); return; }
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = 'mes-donnees-agora.json';
    lien.click();
    URL.revokeObjectURL(url);
  });

  zone.querySelector('#btn-supprimer-compte').addEventListener('click', async () => {
    if (!confirm('Supprimer définitivement votre compte ? Cette action est irréversible : votre email, votre nom et votre mot de passe seront effacés. Le contenu que vous avez publié restera visible mais anonyme.')) return;
    if (!confirm('Dernière confirmation : voulez-vous vraiment continuer ?')) return;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/auth/moi`, { method: 'DELETE' });
    if (res.ok) {
      document.location.href = 'connexion.html';
    } else {
      afficherToastMessage('Erreur lors de la suppression du compte.', 'erreur');
    }
  });
}
