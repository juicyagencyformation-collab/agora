// frontend/js/dashboard.js

const CODES_METEO = {
  0: { label: 'Ciel dégagé', icone: '☀️' },
  1: { label: 'Plutôt dégagé', icone: '🌤️' },
  2: { label: 'Partiellement nuageux', icone: '⛅' },
  3: { label: 'Couvert', icone: '☁️' },
  45: { label: 'Brouillard', icone: '🌫️' },
  48: { label: 'Brouillard givrant', icone: '🌫️' },
  51: { label: 'Bruine légère', icone: '🌦️' },
  53: { label: 'Bruine', icone: '🌦️' },
  55: { label: 'Bruine dense', icone: '🌦️' },
  61: { label: 'Pluie légère', icone: '🌧️' },
  63: { label: 'Pluie', icone: '🌧️' },
  65: { label: 'Forte pluie', icone: '🌧️' },
  71: { label: 'Neige légère', icone: '🌨️' },
  73: { label: 'Neige', icone: '🌨️' },
  75: { label: 'Forte neige', icone: '❄️' },
  80: { label: 'Averses', icone: '🌦️' },
  81: { label: 'Averses fortes', icone: '🌧️' },
  82: { label: 'Averses violentes', icone: '⛈️' },
  95: { label: 'Orage', icone: '⛈️' },
  96: { label: 'Orage avec grêle', icone: '⛈️' },
  99: { label: 'Orage violent', icone: '⛈️' },
};

const LABELS_DECHET = {
  ordures_menageres: 'Ordures ménagères',
  tri_selectif: 'Tri sélectif',
  verre: 'Verre',
  encombrants: 'Encombrants',
  dechets_verts: 'Déchets verts',
};

async function chargerDashboard() {
  const meteo = document.getElementById('carte-meteo');
  const dechets = document.getElementById('carte-dechets');
  const derniereActu = document.getElementById('carte-derniere-actu');
  const resumes = document.getElementById('bandeau-resumes');
  if (meteo) meteo.innerHTML = `<p class="meteo-erreur">Chargement de la météo…</p>`;
  if (dechets) dechets.innerHTML = `<p class="dechets-vide">Chargement…</p>`;
  if (derniereActu) derniereActu.innerHTML = `<p class="dechets-vide">Chargement…</p>`;
  if (resumes) resumes.innerHTML = `<p class="dechets-vide">Chargement…</p>`;

  afficherSalut();
  initActionsRapidesAccueil();
  chargerMeteo();
  chargerLune();
  chargerDechetsDashboard();
  chargerDerniereActu();
  chargerResumes();
  chargerMiniXp();
  chargerPhotoVedette();
  chargerDernierPv();
  chargerProchainConseil();
  chargerInfosMairie();
}

// Infos pratiques de la mairie, tout en bas de l'accueil (configurées en Modération par les
// élus/maire). Masqué tant que rien n'est renseigné. Téléphones/emails rendus cliquables.
async function chargerInfosMairie() {
  const zone = document.getElementById('carte-infos-mairie');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) { zone.hidden = true; return; }
  const { commune } = await res.json();
  const { horaires_ouverture, permanences, telephone_mairie, email_mairie } = commune;

  if (!horaires_ouverture && !permanences && !telephone_mairie && !email_mairie) { zone.hidden = true; return; }

  const bloc = (icone, titre, valeur) => valeur
    ? `<div class="bloc-info-mairie"><strong>${icone} ${titre}</strong><p style="white-space:pre-line;">${texteAvecLiensCliquables(valeur)}</p></div>`
    : '';

  zone.hidden = false;
  zone.innerHTML = `
    <h3 class="titre-infos-mairie">🏛️ Votre mairie</h3>
    ${bloc('🕐', 'Horaires d\'ouverture', horaires_ouverture)}
    ${bloc('📅', 'Permanences', permanences)}
    ${bloc('📞', 'Téléphone', telephone_mairie)}
    ${bloc('✉️', 'Email', email_mairie)}
  `;
}

// Boutons d'action rapide, juste sous la phrase de salutation.
function initActionsRapidesAccueil() {
  const zone = document.getElementById('actions-rapides-accueil');
  if (!zone) return;
  zone.innerHTML = `
    <div class="rangee-actions-rapides-accueil">
      <button type="button" class="bouton-action-rapide-accueil rouge">🚨 Alerter</button>
      <button type="button" class="bouton-action-rapide-accueil prairie">🤲 Demander de l'aide</button>
    </div>
  `;
  zone.querySelector('.rouge').addEventListener('click', () => ouvrirModaleCreationAlerte());
  zone.querySelector('.prairie').addEventListener('click', () => ouvrirModaleDemandeAideRapide());
}

function afficherSalut() {
  const zone = document.getElementById('salut-utilisateur');
  if (!zone) return;
  const heure = new Date().getHours();
  let salut = 'Bonsoir';
  if (heure < 5) salut = 'Bonne nuit';
  else if (heure < 12) salut = 'Bonjour';
  else if (heure < 18) salut = 'Bon après-midi';
  zone.textContent = `${salut} 👋`;
}

// Phase de la lune — calculée localement, aucune API nécessaire.
function calculerPhaseLune(date = new Date()) {
  const nouvelleLuneRef = Date.UTC(2000, 0, 6, 18, 14, 0);
  const cycle = 29.53058868;
  const joursDepuisRef = (date.getTime() - nouvelleLuneRef) / 86400000;
  const position = ((joursDepuisRef % cycle) + cycle) % cycle;
  const fraction = position / cycle;
  const illumination = Math.round((1 - Math.cos(fraction * 2 * Math.PI)) / 2 * 100);

  const phases = [
    { max: 0.03, nom: 'Nouvelle lune', icone: '🌑', conseil: 'Repos de la terre — bon moment pour préparer le sol et désherber, selon la tradition.' },
    { max: 0.22, nom: 'Premier croissant', icone: '🌒', conseil: 'Favorable aux semis des plantes qui poussent en hauteur (fleurs, fruits), selon la tradition.' },
    { max: 0.28, nom: 'Premier quartier', icone: '🌓', conseil: 'Bon moment pour planter et greffer, selon la tradition.' },
    { max: 0.47, nom: 'Lune gibbeuse croissante', icone: '🌔', conseil: 'Favorable à l\'arrosage et à la fertilisation, selon la tradition.' },
    { max: 0.53, nom: 'Pleine lune', icone: '🌕', conseil: 'Moment traditionnel de récolte des fruits et légumes.' },
    { max: 0.72, nom: 'Lune gibbeuse décroissante', icone: '🌖', conseil: 'Bon moment pour tailler et récolter les racines, selon la tradition.' },
    { max: 0.78, nom: 'Dernier quartier', icone: '🌗', conseil: 'Favorable au désherbage et à l\'entretien du jardin.' },
    { max: 0.97, nom: 'Dernier croissant', icone: '🌘', conseil: 'Bon moment pour planter racines et bulbes, selon la tradition.' },
    { max: 1.01, nom: 'Nouvelle lune', icone: '🌑', conseil: 'Repos de la terre — bon moment pour préparer le sol et désherber, selon la tradition.' },
  ];
  const phase = phases.find((p) => fraction <= p.max) ?? phases[0];
  return { ...phase, illumination };
}

function chargerLune() {
  const zone = document.getElementById('carte-lune');
  if (!zone) return;
  const { nom, icone, conseil, illumination } = calculerPhaseLune();
  zone.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="font-size:34px;">${icone}</div>
      <div>
        <div style="font-weight:600;color:#fff;font-size:14px;">🌙 ${nom}</div>
        <div style="font-size:11.5px;color:rgba(255,255,255,.8);">${illumination}% illuminée</div>
      </div>
    </div>
    <p style="font-size:12px;color:rgba(255,255,255,.85);margin-top:8px;">${conseil}</p>
  `;
}

async function chargerPhotoVedette() {
  const zone = document.getElementById('carte-photo-vedette');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/photo-du-jour/vedette`);
  if (!res.ok) { zone.hidden = true; return; }
  const { vedette } = await res.json();
  if (!vedette) { zone.hidden = true; return; }

  zone.hidden = false;
  zone.innerHTML = `
    <img src="${vedette.url}" class="image-vedette">
    <div class="etiquette-vedette">📸 Photo de la semaine · ❤️ ${vedette.total_likes}</div>
  `;
  zone.onclick = () => activerOnglet('photo-du-jour');
}

// Badge XP superposé à la bannière du haut (nom de la commune) — juste l'anneau et le
// chiffre de niveau, sans texte, pour rester discret sur une barre de 58px de haut. Le clic
// (vers Profil) est attaché une seule fois par initBadgeEntete(), pas ici : ce bouton est
// global (dans <header>, jamais recréé), contrairement à l'ancienne carte de l'accueil.
async function chargerMiniXp() {
  const zoneXp = document.getElementById('btn-badge-entete');
  const zoneSalut = document.getElementById('salut-utilisateur');
  if (!zoneXp) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/profil`);
  if (!res.ok) { zoneXp.hidden = true; return; }
  const data = await res.json();

  if (zoneSalut && data.prenom) {
    zoneSalut.textContent = zoneSalut.textContent.replace('👋', `${data.prenom} 👋`);
  }

  const xpDansNiveau = data.xp - data.xp_niveau_actuel;
  const xpPourNiveau = data.xp_niveau_suivant - data.xp_niveau_actuel;
  const pct = xpPourNiveau > 0 ? Math.round((xpDansNiveau / xpPourNiveau) * 100) : 100;
  const photoOuLogo = data.photo_profil_url || window.COMMUNE_LOGO_URL;

  zoneXp.style.setProperty('--pct', pct);
  zoneXp.innerHTML = `
    <div class="interieur-badge-xp">
      ${photoOuLogo ? `<img src="${photoOuLogo}" alt="">` : '<span class="logo-defaut-badge-xp">🏛️</span>'}
    </div>
    <div class="niveau-overlay-badge-xp">${data.niveau}</div>
  `;
  zoneXp.hidden = false;
}

function initBadgeEntete() {
  document.getElementById('btn-badge-entete')?.addEventListener('click', () => activerOnglet('profil'));
}

async function chargerMeteo() {
  const zone = document.getElementById('carte-meteo');
  if (!zone) return;
  try {
    const lat = window.COMMUNE_LAT ?? 43.6047;
    const lng = window.COMMUNE_LNG ?? 1.4442;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FParis&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const code = data.current.weathercode;
    const infos = CODES_METEO[code] ?? { label: 'Météo indisponible', icone: '🌡️' };

    zone.innerHTML = `
      <div class="meteo-icone-hero">${infos.icone}</div>
      <div class="meteo-temp-hero">${Math.round(data.current.temperature_2m)}°</div>
      <div class="meteo-label-hero">${infos.label}</div>
      <div class="meteo-minmax-hero">↓ ${Math.round(data.daily.temperature_2m_min[0])}° · ↑ ${Math.round(data.daily.temperature_2m_max[0])}°</div>
    `;
  } catch {
    zone.innerHTML = `<p class="meteo-erreur">Météo indisponible.</p>`;
  }
}

// ── Déchets : traitement spécial et visible la veille du ramassage ──

async function chargerDechetsDashboard() {
  const zoneAlerte = document.getElementById('carte-alerte-dechets');
  const zone = document.getElementById('carte-dechets');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/dechets`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { collectes } = await res.json();

  if (!collectes.length) {
    if (zoneAlerte) zoneAlerte.hidden = true;
    zone.innerHTML = `<p class="dechets-vide">Aucun calendrier de collecte configuré. (Modération → Déchets)</p>`;
    return;
  }

  const aujourdhui = collectes.filter((c) => c.aujourdhui);
  const veille = collectes.filter((c) => !c.aujourdhui && c.dans_jours === 1);
  const prochaine = collectes.find((c) => !c.aujourdhui && c.dans_jours !== 1);

  // Carte d'alerte bien visible, en haut de l'accueil, uniquement la veille du ramassage.
  if (zoneAlerte) {
    if (veille.length) {
      zoneAlerte.hidden = false;
      zoneAlerte.innerHTML = veille.map((c) => `
        <div class="alerte-dechets-veille" style="border-left-color:${c.couleur}">
          <span style="font-size:26px;">🗑️</span>
          <div>
            <strong>Sortez vos poubelles ce soir !</strong>
            <p>Collecte "${LABELS_DECHET[c.type] ?? c.type}" demain matin</p>
          </div>
        </div>
      `).join('');
    } else {
      zoneAlerte.hidden = true;
    }
  }

  let html = '';
  if (aujourdhui.length) {
    html += aujourdhui.map((c) => `
      <div class="ligne-dechet ligne-dechet-today" style="border-left-color:${c.couleur}">
        <strong>🗑️ Aujourd'hui : ${LABELS_DECHET[c.type] ?? c.type}</strong>
      </div>
    `).join('');
  } else if (!veille.length) {
    html += `<p class="dechets-rien">Rien à sortir aujourd'hui.</p>`;
  }
  if (prochaine) {
    const jourTexte = prochaine.dans_jours === 1 ? 'demain' : `dans ${prochaine.dans_jours} jours`;
    html += `
      <div class="ligne-dechet" style="border-left-color:${prochaine.couleur}">
        Prochaine collecte : <strong>${LABELS_DECHET[prochaine.type] ?? prochaine.type}</strong> — ${jourTexte}
      </div>
    `;
  }
  zone.innerHTML = html;
}

async function chargerDerniereActu() {
  const zone = document.getElementById('carte-derniere-actu');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/actus?section=actualites`);
  if (!res.ok) return;
  const { articles } = await res.json();
  if (!articles.length) {
    zone.innerHTML = `<p class="dechets-vide">Aucun article publié pour le moment.</p>`;
    return;
  }
  const a = articles[0];
  const extraitBrut = texteBrutDepuisHtml(a.contenu_html).replace(/\s+/g, ' ').trim();
  const extrait = extraitBrut.slice(0, 140);
  const miniature = a.images?.[0]?.url;

  zone.innerHTML = `
    <div class="entete-article-compact" style="padding:0;cursor:default;">
      ${miniature ? `<img src="${miniature}" class="miniature-liste-article">` : '<div class="miniature-liste-article miniature-vide">📰</div>'}
      <div class="texte-entete-article">
        <h4 class="titre-article-compact" style="margin:2px 0 3px;">${escapeAttr(a.titre)}</h4>
        <p class="extrait-article-compact">${escapeAttr(extrait)}${extraitBrut.length > 140 ? '…' : ''}</p>
      </div>
    </div>
    <button id="btn-voir-actu" style="margin-top:10px;">Voir toutes les actualités</button>
  `;
  zone.querySelector('#btn-voir-actu').addEventListener('click', () => activerOnglet('actualites'));
}

// ── Dernier compte-rendu de conseil (PV) ──

async function chargerDernierPv() {
  const zone = document.getElementById('carte-dernier-pv');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/actus?section=conseil`);
  if (!res.ok) { zone.hidden = true; return; }
  const { articles } = await res.json();
  const dernier = articles?.[0];
  if (!dernier) { zone.hidden = true; return; }

  zone.hidden = false;
  const dateAffichee = new Date(dernier.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  zone.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;">
      <div style="font-size:26px;">${dernier.fichier_pv_type === 'pdf' ? '📄' : '📋'}</div>
      <div style="flex:1;">
        <div style="font-size:11px;color:var(--roseau);font-weight:600;">🏛️ Dernier compte-rendu</div>
        <h4 style="margin:2px 0 0;font-size:15px;">${escapeAttr(dernier.titre)}</h4>
        <span style="font-size:11px;color:var(--roseau);">${dateAffichee}</span>
      </div>
    </div>
  `;
  zone.onclick = () => activerOnglet('conseil');
}

// ── Prochain conseil municipal ──

async function chargerProchainConseil() {
  const zone = document.getElementById('carte-prochain-conseil');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
  if (!res.ok) { zone.hidden = true; return; }
  const { commune } = await res.json();
  if (!commune.prochain_conseil_date) { zone.hidden = true; return; }

  const date = new Date(commune.prochain_conseil_date);
  if (date.getTime() < Date.now()) { zone.hidden = true; return; }

  zone.hidden = false;
  const dateAffichee = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heureAffichee = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  zone.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;">
      <div style="font-size:26px;">🏛️</div>
      <div>
        <div style="font-size:11px;color:rgba(255,255,255,.85);font-weight:600;">Prochain conseil municipal</div>
        <div style="font-size:15px;font-weight:700;text-transform:capitalize;">${dateAffichee}</div>
        <div style="font-size:12.5px;color:rgba(255,255,255,.85);">à ${heureAffichee}</div>
      </div>
    </div>
  `;
  zone.onclick = () => activerOnglet('conseil');
}

async function chargerResumes() {
  const zone = document.getElementById('bandeau-resumes');
  const titre = document.getElementById('titre-coup-oeil');
  if (!zone) return;
  zone.innerHTML = '';

  const agendaRes = await appelApi(`/${window.COMMUNE_SLUG}/agenda`);
  if (agendaRes.ok) {
    const { events } = await agendaRes.json();
    if (events.length) {
      const d = new Date(events[0].date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const pastille = document.createElement('button');
      pastille.className = 'pastille-resume pastille-aube';
      pastille.innerHTML = `<span class="pastille-icone">📅</span><span>${escapeAttr(events[0].titre)} (${d})</span>`;
      pastille.addEventListener('click', () => activerOnglet('agenda'));
      zone.appendChild(pastille);
    }
  }
  if (titre) titre.hidden = zone.children.length === 0;
}
