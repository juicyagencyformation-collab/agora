// frontend/js/moderation.js
const LABELS_ONGLET = {
  actualites: 'Actualités', alertes: 'Alertes', thermometre: 'Thermomètre',
  mur: 'Mur des voisins', agenda: 'Agenda', coups_de_main: 'Coup de main',
  chasse_tresor: 'Chasse au trésor', conseil: 'Conseil', profil: 'Mon profil',
  annuaire: 'Annuaire', bulletin: 'Bulletin municipal', photo_du_jour: 'Photo du jour', enigmes: 'Trouve la photo',
  lois: 'Lois', memoire: 'Mémoire du village',
};

const LABELS_DECHET_MOD = {
  ordures_menageres: 'Ordures ménagères', tri_selectif: 'Tri sélectif',
  verre: 'Verre', encombrants: 'Encombrants', dechets_verts: 'Déchets verts',
};

const LABELS_JOUR = { 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi', 7: 'Dimanche' };

// ── Vue d'ensemble de la commune, en tête de l'onglet Modération ──

async function chargerStatsModeration() {
  const zone = document.getElementById('recap-stats-moderation');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/stats`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const s = await res.json();

  const stats = [
    { valeur: s.citoyens, label: 'Comptes citoyens' },
    { valeur: s.en_attente_moderation, label: 'En attente de modération', alerte: s.en_attente_moderation > 0 },
    { valeur: s.alertes_en_cours, label: 'Alertes en cours', alerte: s.alertes_en_cours > 0 },
    { valeur: s.alertes_resolues, label: 'Alertes résolues' },
    { valeur: s.articles, label: 'Articles publiés' },
    { valeur: s.messages_mur, label: 'Messages du mur' },
    { valeur: s.sondages, label: 'Sondages' },
    { valeur: s.evenements_a_venir, label: 'Événements à venir' },
    { valeur: s.annonces_entraide, label: "Annonces d'entraide" },
    { valeur: s.fiches_annuaire, label: 'Fiches annuaire' },
    { valeur: s.explorations_actives, label: 'Chasses & énigmes actives' },
    { valeur: s.photos_jour, label: 'Photos du jour' },
    { valeur: s.avis_lois, label: 'Avis sur des lois' },
    { valeur: s.score_citoyen_total, label: 'Score citoyen cumulé' },
  ];

  zone.innerHTML = stats.map((st) => `
    <div class="stat-moderation${st.alerte ? ' stat-moderation-alerte' : ''}">
      <strong>${st.valeur}</strong>
      <span>${escapeAttr(st.label)}</span>
    </div>
  `).join('');
}

// Fréquentation : actifs aujourd'hui / 7j / 30j + % population + courbe des connexions par jour.
async function chargerStatsConnexions() {
  const zone = document.getElementById('stats-connexions');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/stats-connexions`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const d = await res.json();

  const pct = (n) => d.population ? ` <span class="pct-freq">(${Math.round((n / d.population) * 100)}%)</span>` : '';
  const maxSerie = Math.max(1, ...d.serie.map((s) => s.count));

  zone.innerHTML = `
    <div class="grille-freq">
      <div class="carte-freq"><strong>${d.actifs_aujourdhui}</strong><span>actifs aujourd'hui${pct(d.actifs_aujourdhui)}</span></div>
      <div class="carte-freq"><strong>${d.actifs_semaine}</strong><span>actifs sur 7 jours${pct(d.actifs_semaine)}</span></div>
      <div class="carte-freq"><strong>${d.actifs_mois}</strong><span>actifs sur 30 jours${pct(d.actifs_mois)}</span></div>
      <div class="carte-freq"><strong>${d.inscrits}</strong><span>comptes inscrits${pct(d.inscrits)}</span></div>
    </div>
    ${d.population ? `<p style="font-size:11.5px;color:var(--roseau);margin:8px 2px 0;">Population de la commune : ${d.population} habitants.</p>`
      : `<p style="font-size:11.5px;color:var(--roseau);margin:8px 2px 0;">Population non renseignée : les pourcentages n'apparaissent pas (à renseigner en base : communes.population).</p>`}
    <h4 style="font-size:13px;margin:16px 0 6px;color:var(--roseau);">Connexions par jour (30 derniers jours)</h4>
    <div class="graph-freq">
      ${d.serie.map((s) => `<div class="barre-freq" style="height:${Math.round((s.count / maxSerie) * 100)}%" title="${s.jour} : ${s.count} connexion(s)"></div>`).join('')}
    </div>
  `;
}

// Volets génériques (contrairement aux volets historiques ci-dessous, qui ont chacun leur
// propre initVolet*() car ils embarquent une logique spécifique) : juste replier/déplier,
// écouteur unique posé une fois sur le conteneur plutôt qu'un par volet.
function initVoletsGeneriquesModeration() {
  document.getElementById('onglet-moderation')?.addEventListener('click', (e) => {
    const toggle = e.target.closest('.volet-entete-generique');
    if (!toggle) return;
    const volet = toggle.nextElementSibling;
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });
}

async function chargerPanneauModeration() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/onglets`);
  if (!res.ok) return;
  const { onglets } = await res.json();

  const conteneur = document.getElementById('panneau-onglets');
  conteneur.innerHTML = '';

  onglets.forEach(({ cle, actif }) => {
    const estSuperadmin = window.ROLE === 'superadmin';
    const ligne = document.createElement('label');
    ligne.className = 'ligne-toggle-onglet';
    ligne.innerHTML = `
      <span>${LABELS_ONGLET[cle] ?? cle}</span>
      <input type="checkbox" ${actif ? 'checked' : ''} ${estSuperadmin ? '' : 'disabled'} data-cle="${cle}">
    `;
    if (!estSuperadmin) {
      ligne.title = 'Seul le superadmin peut activer/désactiver un onglet';
      ligne.style.opacity = '0.6';
    }
    ligne.querySelector('input').addEventListener('change', async (e) => {
      const nouvelEtat = e.target.checked;
      const rep = await appelApi(`/${window.COMMUNE_SLUG}/moderation/onglets/${cle}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actif: nouvelEtat }),
      });
      if (!rep.ok) { e.target.checked = !nouvelEtat; alert('Action réservée au superadmin'); }
    });
    conteneur.appendChild(ligne);
  });

  chargerStatsModeration();
  chargerStatsConnexions();
  chargerListeDechetsModeration();
  chargerListeUtilisateurs();
  chargerApercuLogoCommune();
  chargerPhotosEnAttente();
  chargerEnigmesEnAttente();
  chargerMurEnAttente();
  chargerMemoireEnAttente();
  chargerReglageSeuilPhoto();
  chargerReglageCouleurs();
  chargerReglageRayonEnigme();
  chargerReglageDureeMur();
  chargerReglageContactRgpd();
  chargerReglagePartageRegional();
  chargerBadgesCitoyensModeration();
}

// Infos mairie (horaires, permanences, tél, email) — configurables par les élus/maire, affichées
// en bas de l'accueil. Init une seule fois (préremplit + branche l'envoi).
async function initFormulaireInfosMairie() {
  const form = document.getElementById('form-infos-mairie');
  if (!form) return;

  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (res.ok) {
    const { commune } = await res.json();
    document.getElementById('horaires-mairie-input').value = commune.horaires_ouverture || '';
    document.getElementById('permanences-mairie-input').value = commune.permanences || '';
    document.getElementById('telephone-mairie-input').value = commune.telephone_mairie || '';
    document.getElementById('email-mairie-input').value = commune.email_mairie || '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rep = await appelApi(`/${window.COMMUNE_SLUG}/commune/infos-mairie`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        horaires_ouverture: document.getElementById('horaires-mairie-input').value,
        permanences: document.getElementById('permanences-mairie-input').value,
        telephone_mairie: document.getElementById('telephone-mairie-input').value,
        email_mairie: document.getElementById('email-mairie-input').value,
      }),
    });
    if (rep.ok) afficherToastMessage('Infos mairie enregistrées.', 'succes');
    else { const d = await rep.json().catch(() => ({})); afficherToastMessage(typeof d.erreur === 'string' ? d.erreur : 'Erreur lors de l\'enregistrement.', 'erreur'); }
  });
}

async function chargerReglagePartageRegional() {
  const input = document.getElementById('partage-regional-input');
  if (!input) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) return;
  const { commune } = await res.json();
  input.checked = !!commune.partage_regional;
}

function initVoletSyncLois() {
  const toggle = document.getElementById('toggle-volet-sync-lois');
  const volet = document.getElementById('volet-sync-lois-contenu');
  if (!toggle || !volet) return;

  toggle.addEventListener('click', () => {
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });

  document.getElementById('btn-sync-lois-manuel').addEventListener('click', async () => {
    const zoneResultat = document.getElementById('resultat-sync-lois');
    zoneResultat.textContent = 'Synchronisation en cours…';
    const res = await appelApi(`/${window.COMMUNE_SLUG}/lois/sync-manuel`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { zoneResultat.textContent = `Erreur : ${data.erreur}`; return; }

    const total = data.an.ajoutes + data.ue.ajoutes;
    zoneResultat.innerHTML = `
      🏛️ Assemblée nationale : ${data.an.trouves} trouvé(s), ${data.an.ajoutes} nouveau(x)<br>
      🇪🇺 Parlement européen : ${data.ue.trouves} trouvé(s), ${data.ue.ajoutes} nouveau(x)
      ${[...data.an.erreurs, ...data.ue.erreurs].length ? `<br>⚠️ ${[...data.an.erreurs, ...data.ue.erreurs].join(' / ')}` : ''}
    `;
    if (total > 0) chargerLois?.();
  });
}

function initVoletRegional() {
  const toggle = document.getElementById('toggle-volet-regional');
  const volet = document.getElementById('volet-regional-contenu');
  if (!toggle || !volet) return;

  toggle.addEventListener('click', () => {
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });

  document.getElementById('btn-enregistrer-regional').addEventListener('click', async () => {
    const partage_regional = document.getElementById('partage-regional-input').checked;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partage_regional }),
    });
    if (res.ok) alert('Réglage mis à jour.');
    else alert('Erreur lors de la mise à jour.');
  });
}

async function chargerReglageContactRgpd() {
  const input = document.getElementById('contact-rgpd-input');
  if (!input) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) return;
  const { commune } = await res.json();
  input.value = commune.contact_email ?? '';
}

function initVoletRgpd() {
  const toggle = document.getElementById('toggle-volet-rgpd');
  const volet = document.getElementById('volet-rgpd-contenu');
  if (!toggle || !volet) return;

  toggle.addEventListener('click', () => {
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });

  document.getElementById('form-contact-rgpd').addEventListener('submit', async (e) => {
    e.preventDefault();
    const contact_email = document.getElementById('contact-rgpd-input').value.trim();
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_email }),
    });
    if (res.ok) alert('Réglage mis à jour.');
    else alert('Erreur lors de la mise à jour.');
  });
}

async function chargerReglageDureeMur() {
  const input = document.getElementById('duree-mur-input');
  if (!input) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) return;
  const { commune } = await res.json();
  input.value = commune.mur_duree ?? '48h';
}

function initVoletMur() {
  const toggle = document.getElementById('toggle-volet-mur');
  const volet = document.getElementById('volet-mur-contenu');
  if (!toggle || !volet) return;

  toggle.addEventListener('click', () => {
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });

  document.getElementById('form-duree-mur').addEventListener('submit', async (e) => {
    e.preventDefault();
    const duree = document.getElementById('duree-mur-input').value;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mur_duree: duree }),
    });
    if (res.ok) alert('Réglage mis à jour.');
    else alert('Erreur lors de la mise à jour.');
  });
}

async function chargerReglageRayonEnigme() {
  const input = document.getElementById('rayon-enigme-input');
  if (!input) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) return;
  const { commune } = await res.json();
  input.value = commune.rayon_validation_enigme ?? 40;
  document.getElementById('duree-enigme-input').value = commune.enigme_duree ?? 'mois';
}

function initVoletEnigme() {
  const toggle = document.getElementById('toggle-volet-enigme');
  const volet = document.getElementById('volet-enigme-contenu');
  if (!toggle || !volet) return;

  toggle.addEventListener('click', () => {
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });

  document.getElementById('form-rayon-enigme').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rayon = parseInt(document.getElementById('rayon-enigme-input').value, 10);
    const duree = document.getElementById('duree-enigme-input').value;
    if (!rayon || rayon < 5) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rayon_validation_enigme: rayon, enigme_duree: duree }),
    });
    if (res.ok) alert('Réglage mis à jour.');
    else alert('Erreur lors de la mise à jour.');
  });
}

async function chargerApercuLogoCommune() {
  const zone = document.getElementById('apercu-logo-commune');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) return;
  const { commune } = await res.json();
  zone.innerHTML = commune.logo_url
    ? `<img src="${commune.logo_url}" alt="Logo actuel de la commune">`
    : `<p class="dechets-vide">Aucun logo pour l'instant — une icône par défaut est utilisée sur l'accueil.</p>`;
}

function initVoletLogo() {
  const toggle = document.getElementById('toggle-volet-logo');
  const volet = document.getElementById('volet-logo-contenu');
  if (!toggle || !volet) return;

  toggle.addEventListener('click', () => {
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });

  document.getElementById('logo-commune-input').addEventListener('change', async (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    if (!['image/jpeg', 'image/png'].includes(fichier.type)) {
      afficherToastMessage('Format non autorisé (JPEG ou PNG uniquement).', 'erreur');
      return;
    }
    // Pas de compresserImage() ici : elle convertit systématiquement en JPEG, ce qui
    // détruirait la transparence d'un logo/blason en PNG. Les logos restent de toute façon
    // des fichiers légers, la compression n'apporte rien ici.
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune/logo`, {
      method: 'POST', headers: { 'Content-Type': fichier.type }, body: fichier,
    });
    if (res.ok) {
      afficherToastMessage('Logo mis à jour !', 'succes');
      chargerApercuLogoCommune();
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur || 'Erreur lors de l\'upload', 'erreur');
    }
  });
}

async function chargerReglageCouleurs() {
  const inputTheme = document.getElementById('couleur-theme-input');
  if (!inputTheme) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) return;
  const { commune } = await res.json();
  inputTheme.value = commune.couleur_theme || '#2C5F6E';
  document.getElementById('couleur-accent-input').value = commune.couleur_accent || '#E2C97E';
}

function initVoletCouleurs() {
  const toggle = document.getElementById('toggle-volet-couleurs');
  const volet = document.getElementById('volet-couleurs-contenu');
  if (!toggle || !volet) return;

  toggle.addEventListener('click', () => {
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });

  document.getElementById('form-couleurs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const couleur_theme = document.getElementById('couleur-theme-input').value;
    const couleur_accent = document.getElementById('couleur-accent-input').value;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ couleur_theme, couleur_accent }),
    });
    if (res.ok) {
      appliquerTheme({ couleur_theme, couleur_accent });
      alert('Couleurs mises à jour pour tout le monde.');
    } else {
      alert('Erreur lors de la mise à jour.');
    }
  });
}

async function chargerPhotosEnAttente() {
  const zone = document.getElementById('liste-photos-attente');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/moderation/en-attente`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { photos } = await res.json();

  if (!photos.length) {
    zone.innerHTML = `<p class="dechets-vide">Aucune photo en attente de revue.</p>`;
    return;
  }

  zone.innerHTML = '';
  photos.forEach((p) => {
    const carte = document.createElement('div');
    carte.className = 'carte-dashboard';
    carte.innerHTML = `
      <img src="${p.url}" style="max-width:100%;border-radius:10px;margin-bottom:8px;">
      <p style="font-size:12.5px;color:var(--roseau);">${p.total_signalements} signalement(s)</p>
      <div class="actions-admin">
        <button data-action="restaurer">Restaurer</button>
        <button data-action="supprimer">Supprimer définitivement</button>
      </div>
    `;
    carte.querySelector('[data-action="restaurer"]').addEventListener('click', async () => {
      await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/${p.id}/restaurer`, { method: 'PATCH' });
      chargerPhotosEnAttente();
    });
    carte.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement cette photo ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/${p.id}`, { method: 'DELETE' });
      chargerPhotosEnAttente();
    });
    zone.appendChild(carte);
  });
}

async function chargerEnigmesEnAttente() {
  const zone = document.getElementById('liste-enigmes-attente');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/enigmes/moderation/en-attente`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { enigmes } = await res.json();

  if (!enigmes.length) {
    zone.innerHTML = `<p class="dechets-vide">Aucune énigme en attente de revue.</p>`;
    return;
  }

  zone.innerHTML = '';
  enigmes.forEach((e) => {
    const carte = document.createElement('div');
    carte.className = 'carte-dashboard';
    carte.innerHTML = `
      <img src="${e.url}" style="max-width:100%;border-radius:10px;margin-bottom:8px;">
      <p style="font-size:12.5px;color:var(--roseau);">${e.total_signalements} signalement(s)</p>
      <div class="actions-admin">
        <button data-action="restaurer">Restaurer</button>
        <button data-action="supprimer">Supprimer définitivement</button>
      </div>
    `;
    carte.querySelector('[data-action="restaurer"]').addEventListener('click', async () => {
      await appelApi(`/${window.COMMUNE_SLUG}/enigmes/${e.id}/restaurer`, { method: 'PATCH' });
      chargerEnigmesEnAttente();
    });
    carte.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement cette énigme ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/enigmes/${e.id}`, { method: 'DELETE' });
      chargerEnigmesEnAttente();
    });
    zone.appendChild(carte);
  });
}

async function chargerMemoireEnAttente() {
  const zone = document.getElementById('liste-memoire-attente');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/memoire/moderation/en-attente`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { souvenirs } = await res.json();

  if (!souvenirs.length) {
    zone.innerHTML = `<p class="dechets-vide">Aucun souvenir en attente de revue.</p>`;
    return;
  }

  zone.innerHTML = '';
  souvenirs.forEach((s) => {
    const carte = document.createElement('div');
    carte.className = 'carte-dashboard';
    carte.innerHTML = `
      <strong>${escapeAttr(s.titre)}</strong>
      <p style="font-size:13px;margin:4px 0;">${escapeAttr((s.recit || '🎙️ Témoignage audio').slice(0, 200))}</p>
      <p style="font-size:12.5px;color:var(--roseau);">${s.total_signalements} signalement(s)</p>
      <div class="actions-admin">
        <button data-action="restaurer">Restaurer</button>
        <button data-action="supprimer">Supprimer définitivement</button>
      </div>
    `;
    carte.querySelector('[data-action="restaurer"]').addEventListener('click', async () => {
      await appelApi(`/${window.COMMUNE_SLUG}/memoire/${s.id}/restaurer`, { method: 'PATCH' });
      chargerMemoireEnAttente();
    });
    carte.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement ce souvenir ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/memoire/${s.id}`, { method: 'DELETE' });
      chargerMemoireEnAttente();
    });
    zone.appendChild(carte);
  });
}

async function chargerMurEnAttente() {
  const zone = document.getElementById('liste-mur-attente');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/mur/moderation/en-attente`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { posts } = await res.json();

  if (!posts.length) {
    zone.innerHTML = `<p class="dechets-vide">Aucun message en attente de revue.</p>`;
    return;
  }

  zone.innerHTML = '';
  posts.forEach((p) => {
    const carte = document.createElement('div');
    carte.className = 'carte-dashboard';
    carte.innerHTML = `
      <p style="margin-bottom:8px;">${texteAvecLiensCliquables(p.contenu)}</p>
      ${p.photo_url ? `<img src="${p.photo_url}" style="max-width:100%;border-radius:10px;margin-bottom:8px;">` : ''}
      <p style="font-size:12.5px;color:var(--roseau);">${p.total_signalements} signalement(s)</p>
      <div class="actions-admin">
        <button data-action="restaurer">Restaurer</button>
        <button data-action="supprimer">Supprimer définitivement</button>
      </div>
    `;
    carte.querySelector('[data-action="restaurer"]').addEventListener('click', async () => {
      await appelApi(`/${window.COMMUNE_SLUG}/mur/${p.id}/restaurer`, { method: 'PATCH' });
      chargerMurEnAttente();
    });
    carte.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement ce message ?')) return;
      await appelApi(`/${window.COMMUNE_SLUG}/mur/${p.id}`, { method: 'DELETE' });
      chargerMurEnAttente();
    });
    zone.appendChild(carte);
  });
}

async function chargerReglageSeuilPhoto() {
  const input = document.getElementById('seuil-photo-input');
  if (!input) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) return;
  const { commune } = await res.json();
  input.value = commune.photo_jour_seuil_validations ?? 6;
  document.getElementById('max-photo-input').value = commune.photo_jour_max_par_jour ?? 1;
  document.getElementById('duree-photo-input').value = commune.photo_jour_duree ?? 'semaine';
}

function initVoletSeuilPhoto() {
  const toggle = document.getElementById('toggle-volet-photo');
  const volet = document.getElementById('volet-photo-contenu');
  if (!toggle || !volet) return;

  toggle.addEventListener('click', () => {
    const ouvert = volet.classList.toggle('ouvert');
    toggle.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
  });

  document.getElementById('form-seuil-photo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const seuil = parseInt(document.getElementById('seuil-photo-input').value, 10);
    const maxParJour = parseInt(document.getElementById('max-photo-input').value, 10);
    const duree = document.getElementById('duree-photo-input').value;
    if (!seuil || seuil < 1 || !maxParJour || maxParJour < 1) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photo_jour_seuil_validations: seuil,
        photo_jour_max_par_jour: maxParJour,
        photo_jour_duree: duree,
      }),
    });
    if (res.ok) alert('Réglages mis à jour.');
    else alert('Erreur lors de la mise à jour.');
  });
}

async function chargerListeUtilisateurs() {
  const zone = document.getElementById('liste-utilisateurs');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/utilisateurs`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { utilisateurs } = await res.json();

  const LABELS_ROLE = { citoyen: 'Citoyen', admin: 'Admin', elu: 'Élu', maire: 'Maire', superadmin: 'Superadmin' };

  zone.innerHTML = utilisateurs.map((u) => {
    if (u.id === window.USER_ID) {
      return `<div class="ligne-toggle-onglet"><span>${escapeAttr(u.prenom)} ${escapeAttr(u.nom)} (vous)</span><span>${LABELS_ROLE[u.role]}</span></div>`;
    }
    // Un élu ne peut toucher ni un élu, ni le maire, ni un superadmin ; le maire ne peut
    // toucher ni un autre maire ni un superadmin (mais peut toucher un élu) — voir la même
    // logique côté serveur dans worker/src/lib/permissions.ts.
    const verrouille =
      (window.ROLE === 'elu' && ['elu', 'maire', 'superadmin'].includes(u.role)) ||
      (window.ROLE === 'maire' && ['maire', 'superadmin'].includes(u.role)) ||
      u.role === 'superadmin';
    if (verrouille) {
      return `<div class="ligne-toggle-onglet"><span>${escapeAttr(u.prenom)} ${escapeAttr(u.nom)}</span><span>${LABELS_ROLE[u.role]}</span></div>`;
    }
    const optionsDisponibles = window.ROLE === 'superadmin' ? ['citoyen', 'admin', 'elu', 'maire']
      : window.ROLE === 'maire' ? ['citoyen', 'admin', 'elu']
      : ['citoyen', 'admin'];
    return `
      <div class="ligne-toggle-onglet">
        <span>${escapeAttr(u.prenom)} ${escapeAttr(u.nom)} <small style="color:var(--roseau);">${escapeAttr(u.email)}</small></span>
        <select class="select-role-utilisateur" data-id="${u.id}">
          ${optionsDisponibles.map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${LABELS_ROLE[r]}</option>`).join('')}
        </select>
      </div>
    `;
  }).join('');

  zone.querySelectorAll('.select-role-utilisateur').forEach((select) => {
    select.addEventListener('change', async () => {
      const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/utilisateurs/${select.dataset.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: select.value }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.erreur || 'Action non autorisée');
        chargerListeUtilisateurs();
      }
    });
  });
}

function initFormulaireDechets() {
  const form = document.getElementById('form-dechets');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('type-dechet').value;
    const jour_semaine = parseInt(document.getElementById('jour-dechet').value, 10);
    const frequence = document.getElementById('frequence-dechet').value;
    const couleur = document.getElementById('couleur-dechet').value;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/dechets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, jour_semaine, frequence, couleur }),
    });
    if (res.ok) {
      chargerListeDechetsModeration();
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur');
    }
  });
}

async function chargerListeDechetsModeration() {
  const zone = document.getElementById('liste-dechets-config');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/dechets`);
  if (!res.ok) return;
  const { collectes } = await res.json();

  zone.innerHTML = collectes.map((c) => `
    <div class="ligne-toggle-onglet">
      <span style="display:flex;align-items:center;gap:8px;">
        <span style="width:12px;height:12px;border-radius:50%;background:${c.couleur};display:inline-block;"></span>
        ${LABELS_DECHET_MOD[c.type] ?? c.type} — ${LABELS_JOUR[c.jour_semaine]} (${c.frequence.replace('_', ' ')})
      </span>
      <button data-id="${c.id}" class="btn-supprimer-dechet" style="background:transparent;border:1.5px solid var(--eauL);border-radius:8px;padding:4px 10px;font-size:12px;">Retirer</button>
    </div>
  `).join('');

  zone.querySelectorAll('.btn-supprimer-dechet').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await appelApi(`/${window.COMMUNE_SLUG}/dechets/${btn.dataset.id}`, { method: 'DELETE' });
      chargerListeDechetsModeration();
    });
  });
}

// ── Badges citoyens — réservé au superadmin (contrôle d'accès strict côté serveur, voir
// worker/src/routes/moderation.ts). Système séparé des badges existants ci-dessus, qui
// restent codés en dur et gérés par verifierBadges() côté Worker. ──

const DECLENCHEURS_BADGE = [
  { valeur: 'score_citoyen', label: 'Score citoyen atteint un seuil', avecSeuil: true },
  { valeur: 'streak_participation', label: 'Série d\'actions consécutives atteint un seuil', avecSeuil: true },
  { valeur: 'premier_signalement_resolu', label: 'Premier signalement résolu', avecSeuil: false },
  { valeur: 'premiere_action_organisee', label: 'Première action organisée', avecSeuil: false },
  { valeur: 'valide_par_elu', label: 'Validé par un élu (une fois)', avecSeuil: false },
  { valeur: 'streak_5_consecutives', label: '5 actions consécutives', avecSeuil: false },
  { valeur: 'streak_mensuel_6', label: '6 mois consécutifs avec au moins une action', avecSeuil: false },
];

function slugifierBadge(texte) {
  return texte.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Libellé lisible pour un maire non-technophile — jamais le nom technique du déclencheur.
function libelleConditionBadge(declencheur, valeurSeuil) {
  switch (declencheur) {
    case 'score_citoyen': return `À partir de ${valeurSeuil ?? '?'} points`;
    case 'streak_participation': return `${valeurSeuil ?? '?'} actions d'affilée`;
    case 'premier_signalement_resolu': return 'Premier signalement résolu';
    case 'premiere_action_organisee': return 'Première action organisée';
    case 'valide_par_elu': return 'Validé par un élu';
    case 'streak_5_consecutives': return '5 actions consécutives';
    case 'streak_mensuel_6': return "6 mois d'affilée";
    default: return declencheur;
  }
}

async function chargerBadgesCitoyensModeration() {
  const zone = document.getElementById('liste-badges-citoyens');
  if (!zone || window.ROLE !== 'superadmin') return;

  const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/badges-citoyens`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { badges } = await res.json();

  if (!badges.length) {
    zone.innerHTML = `<p class="dechets-vide">Aucun badge citoyen pour l'instant.</p>`;
    return;
  }

  zone.innerHTML = '';
  badges.forEach((b, i) => {
    const carte = document.createElement('div');
    carte.className = 'carte-dashboard carte-badge-citoyen';
    carte.innerHTML = `
      <div class="visuel-badge-citoyen">${b.visuel_url ? `<img src="${b.visuel_url}" alt="">` : '🏅'}</div>
      <div class="infos-badge-citoyen">
        <strong>${escapeAttr(b.nom)}</strong>
        ${b.description ? `<p class="description-badge-citoyen">${escapeAttr(b.description)}</p>` : ''}
        <span class="condition-badge-citoyen ${b.actif ? '' : 'condition-inactive'}">${escapeAttr(libelleConditionBadge(b.declencheur, b.valeur_seuil))}</span>
        <div class="actions-badge-citoyen">
          <label><input type="checkbox" class="toggle-actif-badge" ${b.actif ? 'checked' : ''}> Actif</label>
          <button type="button" class="btn-reordonner-badge" data-action="monter" ${i === 0 ? 'disabled' : ''} title="Monter">▲</button>
          <button type="button" class="btn-reordonner-badge" data-action="descendre" ${i === badges.length - 1 ? 'disabled' : ''} title="Descendre">▼</button>
          <button type="button" data-action="modifier">Modifier</button>
          <button type="button" data-action="supprimer">Supprimer</button>
        </div>
      </div>
    `;

    carte.querySelector('.toggle-actif-badge').addEventListener('change', async (e) => {
      await appelApi(`/${window.COMMUNE_SLUG}/moderation/badges-citoyens/${b.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actif: e.target.checked }),
      });
    });
    carte.querySelector('[data-action="monter"]').addEventListener('click', async () => {
      await echangerOrdreBadgesCitoyens(badges[i - 1], b);
      chargerBadgesCitoyensModeration();
    });
    carte.querySelector('[data-action="descendre"]').addEventListener('click', async () => {
      await echangerOrdreBadgesCitoyens(b, badges[i + 1]);
      chargerBadgesCitoyensModeration();
    });
    carte.querySelector('[data-action="modifier"]').addEventListener('click', () => ouvrirModaleBadgeCitoyen(b));
    carte.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
      if (!confirm('Supprimer ce badge citoyen ?')) return;
      const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/badges-citoyens/${b.id}`, { method: 'DELETE' });
      if (!res.ok) { const data = await res.json(); alert(data.erreur || 'Erreur'); return; }
      chargerBadgesCitoyensModeration();
    });

    zone.appendChild(carte);
  });
}

async function echangerOrdreBadgesCitoyens(a, b) {
  await Promise.all([
    appelApi(`/${window.COMMUNE_SLUG}/moderation/badges-citoyens/${a.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ordre: b.ordre }),
    }),
    appelApi(`/${window.COMMUNE_SLUG}/moderation/badges-citoyens/${b.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ordre: a.ordre }),
    }),
  ]);
}

function initFormulaireBadgeCitoyen() {
  const btn = document.getElementById('btn-ouvrir-creation-badge-citoyen');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleBadgeCitoyen());
}

function ouvrirModaleBadgeCitoyen(badgeExistant = null) {
  const html = `
    <form id="form-modale-badge-citoyen">
      <input type="text" id="nom-badge-modale" placeholder="Nom du badge" maxlength="100" value="${badgeExistant ? escapeAttr(badgeExistant.nom) : ''}" required>
      <textarea id="description-badge-modale" placeholder="Description">${badgeExistant ? escapeAttr(badgeExistant.description || '') : ''}</textarea>
      <label class="label-champ-edition">Condition de déblocage</label>
      <select id="declencheur-badge-modale">
        ${DECLENCHEURS_BADGE.map((d) => `<option value="${d.valeur}" ${badgeExistant?.declencheur === d.valeur ? 'selected' : ''}>${d.label}</option>`).join('')}
      </select>
      <input type="number" id="seuil-badge-modale" placeholder="Seuil (ex : 400)" min="1" value="${badgeExistant?.valeur_seuil ?? ''}">
      <label class="label-champ-edition">Visuel (image)</label>
      <input type="file" id="visuel-badge-modale" accept="image/*">
      <button type="submit" style="margin-top:12px;">${badgeExistant ? '✓ Enregistrer' : 'Créer le badge'}</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(badgeExistant ? 'Modifier le badge' : 'Créer un badge citoyen', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  const selectDeclencheur = corps.querySelector('#declencheur-badge-modale');
  const inputSeuil = corps.querySelector('#seuil-badge-modale');
  const majAffichageSeuil = () => {
    const avecSeuil = DECLENCHEURS_BADGE.find((d) => d.valeur === selectDeclencheur.value)?.avecSeuil;
    inputSeuil.style.display = avecSeuil ? '' : 'none';
  };
  selectDeclencheur.addEventListener('change', majAffichageSeuil);
  majAffichageSeuil();

  corps.querySelector('#form-modale-badge-citoyen').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nom = corps.querySelector('#nom-badge-modale').value.trim();
    const description = corps.querySelector('#description-badge-modale').value.trim();
    const declencheur = selectDeclencheur.value;
    const seuilBrut = corps.querySelector('#seuil-badge-modale').value;
    const valeur_seuil = seuilBrut ? parseInt(seuilBrut, 10) : undefined;
    if (!nom) return;

    let visuel_url;
    let r2_key;
    const fichier = corps.querySelector('#visuel-badge-modale').files[0];
    if (fichier) {
      try {
        const compresse = await compresserImage(fichier, 300, 0.9);
        const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/moderation/badges-citoyens/upload`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (resUpload.ok) { const data = await resUpload.json(); visuel_url = data.url; r2_key = data.key; }
      } catch { console.warn('Upload du visuel échoué.'); }
    }

    const payload = {
      nom, description, declencheur, valeur_seuil,
      ...(visuel_url ? { visuel_url, r2_key } : {}),
    };
    if (!badgeExistant) {
      payload.cle = slugifierBadge(nom);
      payload.type = ['score_citoyen', 'streak_participation'].includes(declencheur) ? 'seuil' : 'evenement';
    }

    const url = badgeExistant
      ? `/${window.COMMUNE_SLUG}/moderation/badges-citoyens/${badgeExistant.id}`
      : `/${window.COMMUNE_SLUG}/moderation/badges-citoyens`;
    const res = await appelApi(url, {
      method: badgeExistant ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerBadgesCitoyensModeration();
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur', 'erreur');
    }
  });
}
