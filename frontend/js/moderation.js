// frontend/js/moderation.js
const LABELS_ONGLET = {
  actualites: 'Actualités', alertes: 'Alertes', thermometre: 'Thermomètre',
  mur: 'Mur des voisins', agenda: 'Agenda', coups_de_main: 'Coup de main',
  chasse_tresor: 'Chasse au trésor', conseil: 'Conseil', profil: 'Mon profil',
  annuaire: 'Annuaire', bulletin: 'Bulletin municipal', photo_du_jour: 'Photo du jour', enigmes: 'Trouve la photo',
};

const LABELS_DECHET_MOD = {
  ordures_menageres: 'Ordures ménagères', tri_selectif: 'Tri sélectif',
  verre: 'Verre', encombrants: 'Encombrants', dechets_verts: 'Déchets verts',
};

const LABELS_JOUR = { 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi', 7: 'Dimanche' };

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

  chargerListeDechetsModeration();
  chargerListeUtilisateurs();
  chargerPhotosEnAttente();
  chargerEnigmesEnAttente();
  chargerMurEnAttente();
  chargerReglageSeuilPhoto();
  chargerReglageCouleurs();
  chargerReglageRayonEnigme();
  chargerReglageDureeMur();
  chargerReglageContactRgpd();
  chargerReglagePartageRegional();
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
      <p style="margin-bottom:8px;">${escapeAttr(p.contenu)}</p>
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

  const LABELS_ROLE = { citoyen: 'Citoyen', admin: 'Admin', elu: 'Élu', superadmin: 'Superadmin' };

  zone.innerHTML = utilisateurs.map((u) => {
    if (u.id === window.USER_ID) {
      return `<div class="ligne-toggle-onglet"><span>${escapeAttr(u.prenom)} ${escapeAttr(u.nom)} (vous)</span><span>${LABELS_ROLE[u.role]}</span></div>`;
    }
    // Un élu ne peut ni voir modifiable ni toucher un élu/superadmin
    const verrouille = (window.ROLE === 'elu' && ['elu', 'superadmin'].includes(u.role)) || u.role === 'superadmin';
    if (verrouille) {
      return `<div class="ligne-toggle-onglet"><span>${escapeAttr(u.prenom)} ${escapeAttr(u.nom)}</span><span>${LABELS_ROLE[u.role]}</span></div>`;
    }
    const optionsDisponibles = window.ROLE === 'superadmin' ? ['citoyen', 'admin', 'elu'] : ['citoyen', 'admin'];
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
