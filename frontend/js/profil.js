// frontend/js/profil.js

const LABELS_BADGES = {
  premier_pas: { nom: 'Premier pas', icone: '👣', description: 'Bienvenue sur Agora !' },
  assidu: { nom: 'Assidu', icone: '🔥', description: '7 jours de connexion d\'affilée' },
  super_assidu: { nom: 'Super assidu', icone: '⚡', description: '30 jours de connexion d\'affilée' },
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

  zone.innerHTML = `
    <div class="carte-dashboard carte-profil-entete">
      <div class="niveau-cercle">Nv. ${data.niveau}</div>
      <div style="flex:1;">
        <strong>${escapeAttr(data.prenom)} ${escapeAttr(data.nom)}</strong>
        <div class="jauge" style="margin-top:6px;"><div class="jauge-remplie" style="width:${pct}%"></div></div>
        <small style="color:var(--roseau);">${xpDansNiveau} / ${xpPourNiveau} XP vers le niveau ${data.niveau + 1}</small>
      </div>
    </div>

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

    <button id="btn-deconnexion" style="margin-top:20px;background:transparent;color:var(--rouge);border:1.5px solid var(--rouge);">Se déconnecter</button>
  `;

  document.getElementById('btn-deconnexion').addEventListener('click', async () => {
    await appelApi(`/${window.COMMUNE_SLUG}/auth/logout`, { method: 'POST' });
    document.location.href = 'connexion.html';
  });

  initReglagesRgpdProfil();
}

// ── Droits RGPD : export de mes données, suppression de mon compte ──

function initReglagesRgpdProfil() {
  const zone = document.getElementById('reglages-rgpd-profil');
  if (!zone) return;

  zone.innerHTML = `
    <h3 style="margin-top:22px;">🔒 Mes données</h3>
    <button type="button" id="btn-telecharger-donnees" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);">📥 Télécharger mes données</button>
    <button type="button" id="btn-supprimer-compte" style="margin-top:8px;background:transparent;color:var(--rouge);border:1.5px solid var(--rouge);">🗑️ Supprimer mon compte</button>
    <p style="font-size:11.5px;color:var(--roseau);margin-top:6px;">
      La suppression efface définitivement vos données personnelles (email, mot de passe, nom).
      Le contenu que vous avez publié reste visible mais n'est plus rattaché à votre identité.
    </p>
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
