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

const LABELS_TYPE_VIGILANCE = {
  vent_violent: 'Vent violent', pluie_inondation: 'Pluie-inondation', orages: 'Orages',
  crues: 'Crues', neige_verglas: 'Neige-verglas', canicule: 'Canicule',
  grand_froid: 'Grand froid', avalanches: 'Avalanches',
};
const ICONES_TYPE_VIGILANCE = {
  vent_violent: '💨', pluie_inondation: '🌊', orages: '⛈️', crues: '🌊',
  neige_verglas: '❄️', canicule: '🥵', grand_froid: '🥶', avalanches: '🏔️',
};

const LABELS_DECHET = {
  ordures_menageres: 'Ordures ménagères',
  tri_selectif: 'Tri sélectif',
  verre: 'Verre',
  encombrants: 'Encombrants',
  dechets_verts: 'Déchets verts',
};

const LABELS_JOUR_DECHET = { 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi', 7: 'Dimanche' };
const LABELS_FREQUENCE_DECHET = { chaque_semaine: 'chaque semaine', semaines_paires: 'semaines paires', semaines_impaires: 'semaines impaires' };

async function chargerDashboard() {
  const derniereActu = document.getElementById('carte-derniere-actu');
  const resumes = document.getElementById('bandeau-resumes');
  if (derniereActu) derniereActu.innerHTML = `<p class="dechets-vide">Chargement…</p>`;
  if (resumes) resumes.innerHTML = `<p class="dechets-vide">Chargement…</p>`;

  // Une seule requête déchets, partagée entre l'alerte "veille de collecte" et la tuile du coup d'œil.
  const promesseDechets = appelApi(`/${window.COMMUNE_SLUG}/dechets`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);

  afficherSalut();
  chargerAlertesMeteoAccueil();
  initActionsRapidesAccueil();
  chargerChecklistOnboarding();
  chargerMeteoAccueil();
  chargerDechetsDashboard(promesseDechets);
  chargerDerniereActu();
  chargerResumes(promesseDechets);
  chargerMiniXp();
  chargerPhotoVedette();
  chargerDernierPv();
  chargerInfosMairie();
}

// Vigilance météo (vent violent, orages, canicule...) — tout premier bloc de l'accueil, avant
// même la salutation : une alerte de sécurité prime sur tout le reste. Posée à la main en
// Modération, ou automatiquement par la synchro Météo-France (worker/src/lib/vigilance-
// meteofrance.ts). Plusieurs alertes actives s'empilent proprement.
async function chargerAlertesMeteoAccueil() {
  const zone = document.getElementById('banniere-vigilance-meteo');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/alertes-meteo`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { alertes } = await res.json();
  if (!alertes.length) { zone.innerHTML = ''; return; }

  zone.innerHTML = alertes.map((a) => `
    <div class="carte-vigilance-meteo carte-vigilance-meteo--${a.niveau}">
      <span class="vigilance-meteo-icone">${ICONES_TYPE_VIGILANCE[a.type] ?? '⚠️'}</span>
      <div class="vigilance-meteo-texte">
        <strong>Vigilance ${a.niveau} — ${LABELS_TYPE_VIGILANCE[a.type] ?? a.type}</strong>
        <div class="vigilance-meteo-horaires">${formatPeriodeVigilance(a.debut, a.fin)}</div>
        <div class="vigilance-meteo-source">${a.origine === 'auto' ? 'Source : Météo-France' : 'Ajoutée par la mairie'}</div>
      </div>
    </div>
  `).join('');
}

function formatPeriodeVigilance(debut, fin) {
  const opts = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  const d = new Date(debut).toLocaleString('fr-FR', opts);
  if (!fin) return `Depuis le ${d}`;
  return `Du ${d} au ${new Date(fin).toLocaleString('fr-FR', opts)}`;
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

// Petite checklist de démarrage (discrète, dismissible) pour aider une commune fraîchement
// activée à passer les premiers pas utiles. Visible seulement des gestionnaires ; masquée dès
// que tout est fait, ou dès que l'utilisateur l'a fermée une fois (mémorisé par commune,
// localStorage — pas besoin d'un champ en base pour ça).
async function chargerChecklistOnboarding() {
  const zone = document.getElementById('checklist-onboarding-accueil');
  if (!zone) return;
  if (!['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) { zone.hidden = true; return; }
  const cleMasquee = `agora_checklist_masquee_${window.COMMUNE_SLUG}`;
  if (localStorage.getItem(cleMasquee)) { zone.hidden = true; return; }

  const [resProfil, resAgenda, resActus, resDechets, resUtilisateurs, textes] = await Promise.all([
    appelApi(`/${window.COMMUNE_SLUG}/profil`),
    appelApi(`/${window.COMMUNE_SLUG}/agenda`),
    appelApi(`/${window.COMMUNE_SLUG}/actus?section=actualites`),
    appelApi(`/${window.COMMUNE_SLUG}/dechets`),
    appelApi(`/${window.COMMUNE_SLUG}/moderation/utilisateurs`),
    chargerContenuTexteCitoyen(),
  ]);
  // "Administration" = nom générique posé automatiquement à l'activation par la prospection
  // (voir activerCommuneGratuite côté Worker) — pas encore personnalisé par qui que ce soit.
  const aProfil = resProfil.ok && (await resProfil.json()).prenom !== 'Administration';
  const aEvenement = resAgenda.ok && ((await resAgenda.json()).events?.length > 0);
  const aArticle = resActus.ok && ((await resActus.json()).articles?.length > 0);
  const aDechets = resDechets.ok && ((await resDechets.json()).collectes?.length > 0);
  let aCollegue = false;
  if (resUtilisateurs.ok) {
    const { utilisateurs } = await resUtilisateurs.json();
    aCollegue = utilisateurs.filter((u) => ['admin', 'elu', 'maire', 'superadmin'].includes(u.role)).length > 1;
  }

  if (aProfil && aEvenement && aArticle && aDechets && aCollegue) { zone.hidden = true; return; } // tout est déjà fait

  const etape = (fait, texte, cibleOnglet) => `
    <li class="${fait ? 'etape-checklist-faite' : ''}" ${!fait ? `data-onglet-cible="${cibleOnglet}"` : ''}>
      <span>${fait ? '✅' : '⬜'}</span> ${texte}
    </li>`;
  // Textes éditables depuis le backoffice (voir contenu-texte.ts) — replis identiques au texte
  // d'origine si le fetch a échoué.
  zone.hidden = false;
  zone.innerHTML = `
    <div class="carte-checklist-onboarding">
      <button type="button" class="btn-fermer-checklist" title="Masquer">✕</button>
      <strong>${textes.checklist_titre || '👋 Bien démarrer avec Plateforme-Agora'}</strong>
      <ul class="liste-checklist-onboarding">
        ${etape(aProfil, textes.checklist_item_profil || 'Changer le nom et prénom dans Mon profil', 'profil')}
        ${etape(aEvenement, textes.checklist_item_agenda || 'Ajouter des dates d\'événements dans Agenda', 'agenda')}
        ${etape(aArticle, textes.checklist_item_article || 'Publier un premier article', 'actualites')}
        ${etape(aDechets, textes.checklist_item_dechets || 'Renseigner le calendrier des déchets', 'commune')}
        ${etape(aCollegue, textes.checklist_item_collegue || 'Donner un accès à un collègue (Modération → Gestion des rôles)', 'moderation')}
      </ul>
    </div>
  `;
  zone.querySelector('.btn-fermer-checklist').addEventListener('click', () => {
    localStorage.setItem(cleMasquee, '1');
    zone.hidden = true;
  });
  zone.querySelectorAll('[data-onglet-cible]').forEach((li) => {
    li.addEventListener('click', () => activerOnglet(li.dataset.ongletCible));
  });
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

  // Échéance la plus proche (pleine ou nouvelle lune), pour donner un repère concret
  // en plus du nom de la phase — ex. "pleine lune dans 3 j".
  const joursAvantPleine = fraction <= 0.5 ? (0.5 - fraction) * cycle : (1.5 - fraction) * cycle;
  const joursAvantNouvelle = (1 - fraction) * cycle;
  const texteEcheance = joursAvantPleine < joursAvantNouvelle
    ? (Math.round(joursAvantPleine) <= 0 ? 'pleine lune aujourd\'hui' : `pleine lune dans ${Math.round(joursAvantPleine)} j`)
    : (Math.round(joursAvantNouvelle) <= 0 ? 'nouvelle lune aujourd\'hui' : `nouvelle lune dans ${Math.round(joursAvantNouvelle)} j`);

  return { ...phase, illumination, fractionCycle: fraction, texteEcheance };
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

// Météo de l'accueil : une simple pastille (icône + température) à côté du bonjour, et tout le
// détail (heures, vent, humidité, pluie, UV, soleil, lune) dans un panneau qui s'ouvre au clic.
// Remplace l'ancienne grande carte "Ciel du jour", jugée trop encombrante en haut de l'accueil.
// Même appel Open-Meteo qu'avant (gratuit, sans clé), avec quelques champs en plus.
const DIRECTIONS_VENT = ['du nord', 'du nord-est', 'd\'est', 'du sud-est', 'du sud', 'du sud-ouest', 'd\'ouest', 'du nord-ouest'];
const directionVent = (deg) => DIRECTIONS_VENT[Math.round(deg / 45) % 8];
const niveauUv = (uv) => (uv < 3 ? 'faible' : uv < 6 ? 'modéré' : uv < 8 ? 'élevé' : uv < 11 ? 'très élevé' : 'extrême');
const heureMinute = (d) => `${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;

function initPanneauMeteo(pastille, panneau, voile) {
  if (pastille.dataset.pret) return;
  pastille.dataset.pret = '1';
  const fermer = () => { panneau.hidden = true; voile.hidden = true; };
  pastille.addEventListener('click', () => {
    panneau.hidden = false; voile.hidden = false;
    panneau.scrollTop = 0;
    panneau.querySelector('.fermer-panneau-meteo')?.focus();
  });
  voile.addEventListener('click', fermer);
  panneau.addEventListener('click', (e) => { if (e.target.closest('.fermer-panneau-meteo')) { fermer(); pastille.focus(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panneau.hidden) { fermer(); pastille.focus(); } });
  // Glisser vers le bas pour fermer, comme les panneaux natifs du téléphone.
  let departY = null;
  panneau.addEventListener('touchstart', (e) => { departY = panneau.scrollTop === 0 ? e.touches[0].clientY : null; }, { passive: true });
  panneau.addEventListener('touchend', (e) => {
    if (departY !== null && e.changedTouches[0].clientY - departY > 80) fermer();
    departY = null;
  });
}

// Arc du soleil : courbe de Bézier quadratique, portion déjà parcourue tracée jusqu'au point t
// (découpage de De Casteljau : le point de contrôle du premier segment est P0 + t·(P1 − P0)).
function arcSoleil(t) {
  const p0 = { x: 8, y: 48 }, p1 = { x: 150, y: 0 }, p2 = { x: 292, y: 48 };
  const trace = '<path d="M8,48 Q150,0 292,48" class="arc-soleil-trace"/>';
  if (t === null) return `<svg class="arc-soleil" viewBox="0 0 300 52" preserveAspectRatio="none" aria-hidden="true">${trace}</svg>`;
  const c = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
  const b = {
    x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t ** 2 * p2.x,
    y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t ** 2 * p2.y,
  };
  return `<svg class="arc-soleil" viewBox="0 0 300 52" preserveAspectRatio="none" aria-hidden="true">${trace}
    <path d="M8,48 Q${c.x},${c.y} ${b.x},${b.y}" class="arc-soleil-parcouru"/>
    <circle cx="${b.x}" cy="${b.y}" r="7" class="arc-soleil-astre"/></svg>`;
}

async function chargerMeteoAccueil() {
  const pastille = document.getElementById('pastille-meteo');
  const panneau = document.getElementById('panneau-meteo');
  const voile = document.getElementById('voile-meteo');
  if (!pastille || !panneau || !voile) return;
  initPanneauMeteo(pastille, panneau, voile);
  const lune = calculerPhaseLune();

  let d;
  try {
    const lat = window.COMMUNE_LAT ?? 43.6047;
    const lng = window.COMMUNE_LNG ?? 1.4442;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weathercode,wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
      '&hourly=temperature_2m,weathercode,precipitation_probability' +
      '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max' +
      '&timezone=Europe%2FParis&forecast_days=2';
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    d = await res.json();
  } catch {
    pastille.hidden = true; // pas de pastille plutôt qu'une pastille vide
    return;
  }

  const infos = CODES_METEO[d.current.weathercode] ?? { label: 'Météo', icone: '🌡️' };
  const temp = Math.round(d.current.temperature_2m);
  pastille.innerHTML = `<span class="pastille-meteo-icone">${infos.icone}</span>${temp}°<span class="pastille-meteo-chevron">▾</span>`;
  pastille.setAttribute('aria-label', `Météo : ${temp} degrés, ${infos.label}. Voir le détail`);
  pastille.hidden = false;

  // Les 6 prochaines heures (Open-Meteo renvoie l'heure locale, même format pour current et hourly).
  const i0 = d.hourly.time.findIndex((t) => t.slice(0, 13) === d.current.time.slice(0, 13));
  const heures = i0 < 0 ? [] : [1, 2, 3, 4, 5, 6].map((k) => i0 + k).filter((i) => i < d.hourly.time.length);
  const htmlHeures = heures.map((i) => `
    <div>${new Date(d.hourly.time[i]).getHours()}h<b>${(CODES_METEO[d.hourly.weathercode[i]] ?? { icone: '🌡️' }).icone}</b><strong>${Math.round(d.hourly.temperature_2m[i])}°</strong></div>
  `).join('');

  const iPluie = heures.find((i) => (d.hourly.precipitation_probability[i] ?? 0) >= 50);
  const textePluie = iPluie !== undefined ? `averses possibles vers ${new Date(d.hourly.time[iPluie]).getHours()}h` : 'pas dans les 6 prochaines heures';
  const uv = Math.round(d.daily.uv_index_max[0] ?? 0);
  const dirVent = d.current.wind_direction_10m;

  const maintenant = new Date();
  const lever = new Date(d.daily.sunrise[0]);
  const coucher = new Date(d.daily.sunset[0]);
  const leverDemain = new Date(d.daily.sunrise[1] ?? d.daily.sunrise[0]);
  const dureeJourMin = Math.round((coucher - lever) / 60000);
  const estJour = maintenant >= lever && maintenant <= coucher;
  const milieuArc = estJour
    ? `${Math.floor(dureeJourMin / 60)}h${String(dureeJourMin % 60).padStart(2, '0')} de jour`
    : (maintenant < lever ? `lever à ${heureMinute(lever)}` : `lever demain à ${heureMinute(leverDemain)}`);

  const diametreLune = 36; // = largeur de .lune-disque
  const illum = lune.illumination / 100;
  const decalageLune = Math.round(diametreLune * (lune.fractionCycle <= 0.5 ? -illum : illum));

  panneau.innerHTML = `
    <div class="poignee-panneau-meteo"></div>
    <div class="tete-panneau-meteo">
      <span class="icone-panneau-meteo">${infos.icone}</span>
      <span class="temp-panneau-meteo">${temp}°</span>
      <span class="desc-panneau-meteo">${infos.label}<small>Ressenti ${Math.round(d.current.apparent_temperature)}° · ↓${Math.round(d.daily.temperature_2m_min[0])}° ↑${Math.round(d.daily.temperature_2m_max[0])}°</small></span>
      <button type="button" class="fermer-panneau-meteo" aria-label="Fermer">✕</button>
    </div>
    ${htmlHeures ? `<div class="heures-meteo">${htmlHeures}</div>` : ''}
    <div class="stats-meteo">
      <div class="stat-meteo"><span class="etiquette-meteo">Vent</span>
        <span class="valeur-meteo"><span class="fleche-vent" style="transform:rotate(${dirVent + 180}deg)">↑</span>${Math.round(d.current.wind_speed_10m)} km/h</span>
        <span class="sous-meteo">${directionVent(dirVent)} · rafales ${Math.round(d.current.wind_gusts_10m)} km/h</span></div>
      <div class="stat-meteo"><span class="etiquette-meteo">Humidité</span>
        <span class="valeur-meteo">${Math.round(d.current.relative_humidity_2m)} %</span>
        <span class="jauge-meteo"><i style="width:${Math.round(d.current.relative_humidity_2m)}%"></i></span></div>
      <div class="stat-meteo"><span class="etiquette-meteo">Pluie aujourd'hui</span>
        <span class="valeur-meteo">${Math.round(d.daily.precipitation_probability_max[0] ?? 0)} %</span>
        <span class="sous-meteo">${textePluie}</span></div>
      <div class="stat-meteo"><span class="etiquette-meteo">Indice UV</span>
        <span class="valeur-meteo">${uv}</span>
        <span class="sous-meteo">${niveauUv(uv)}</span></div>
    </div>
    <div class="bloc-panneau-meteo">
      <span class="etiquette-meteo">Soleil</span>
      ${arcSoleil(estJour ? (maintenant - lever) / (coucher - lever) : null)}
      <div class="heures-soleil"><span>Lever <b>${heureMinute(lever)}</b></span><span>${milieuArc}</span><span>Coucher <b>${heureMinute(coucher)}</b></span></div>
    </div>
    <div class="bloc-panneau-meteo">
      <div class="ligne-lune-panneau">
        <div class="lune-disque"><div class="lune-ombre" style="transform:translateX(${decalageLune}px)"></div></div>
        <div><b>${lune.nom}</b><span>${lune.illumination} % éclairée · ${lune.texteEcheance}</span></div>
      </div>
      <p class="conseil-lune">🌱 ${lune.conseil}</p>
    </div>
    <p class="source-meteo">Données Open-Meteo · relevé de ${heureMinute(new Date(d.current.time))}</p>
  `;
}

// ── Déchets : traitement spécial et visible la veille du ramassage ──

async function chargerDechetsDashboard(promesseDechets) {
  const zoneAlerte = document.getElementById('carte-alerte-dechets');
  const zone = document.getElementById('carte-dechets');
  const donnees = await promesseDechets;
  if (!donnees) { if (zoneAlerte) zoneAlerte.hidden = true; return; }
  const { collectes, exceptions } = donnees;

  // Les dates exceptionnelles (jour férié, ramassage ponctuel...) suivent la même logique de
  // rappel que les collectes récurrentes — sinon la mairie les saisirait sans que personne ne
  // soit jamais averti la veille.
  const veille = [...collectes, ...exceptions ?? []].filter((c) => !c.aujourdhui && c.dans_jours === 1);

  // Carte d'alerte bien visible, en haut de l'accueil, uniquement la veille du ramassage.
  if (zoneAlerte) {
    zoneAlerte.hidden = !veille.length;
    zoneAlerte.innerHTML = veille.map((c) => `
      <div class="alerte-dechets-veille" style="border-left-color:${c.couleur}">
        <span style="font-size:26px;">🗑️</span>
        <div>
          <strong>Sortez vos poubelles ce soir !</strong>
          <p>Collecte "${LABELS_DECHET[c.type] ?? escapeAttr(c.libelle)}" demain matin</p>
        </div>
      </div>
    `).join('');
  }

  // Calendrier complet, replié : ouvert depuis la tuile Déchets du coup d'œil (chargerResumes).
  if (!zone) return;
  const detailCollectes = [...collectes].sort((a, b) => a.jour_semaine - b.jour_semaine).map((c) => `
    <div class="ligne-dechet" style="border-left-color:${c.couleur}">
      ${LABELS_DECHET[c.type] ?? c.type} — ${LABELS_JOUR_DECHET[c.jour_semaine]} (${LABELS_FREQUENCE_DECHET[c.frequence] ?? c.frequence})
    </div>
  `).join('');
  const detailExceptions = (exceptions ?? []).map((e) => `
    <div class="ligne-dechet" style="border-left-color:${e.couleur}">
      ${new Date(e.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — ${escapeAttr(e.libelle)}
    </div>
  `).join('');
  zone.innerHTML = `<h4 class="titre-calendrier-dechets">📆 Calendrier des collectes</h4>${detailCollectes}${detailExceptions}`;
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
      ${miniature ? `<img src="${miniature}" class="miniature-liste-article">` : ''}
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
      <div class="puce-icone-carte">${dernier.fichier_pv_type === 'pdf' ? '📄' : '📋'}</div>
      <div style="flex:1;">
        <div style="font-size:11px;color:var(--roseau);font-weight:600;">🏛️ Dernier compte-rendu</div>
        <h4 style="margin:2px 0 0;font-size:15px;">${escapeAttr(dernier.titre)}</h4>
        <span style="font-size:11px;color:var(--roseau);">${dateAffichee}</span>
      </div>
    </div>
  `;
  zone.onclick = () => activerOnglet('conseil');
}

// "En un coup d'œil" : grille de tuiles qui donnent chacune l'information utile (pas un simple
// compteur). Une tuile n'apparaît que si elle a quelque chose à dire ; repli "Tout est calme"
// sinon. Le prochain événement occupe toute la largeur ; s'il reste un nombre impair de petites
// tuiles, la dernière s'étire aussi, pour ne jamais laisser de trou dans la grille.
function creerTuileCoupOeil({ couleur, etiquette, valeur, sous = '', action = '', date = null, large = false, onClick = null }) {
  const tuile = document.createElement(onClick ? 'button' : 'div');
  if (onClick) { tuile.type = 'button'; tuile.addEventListener('click', onClick); }
  tuile.className = `tuile-oeil${large ? ' tuile-oeil--large' : ''}`;
  tuile.style.setProperty('--c', couleur);
  tuile.innerHTML = `
    ${date ? `<span class="bloc-date-oeil"><b>${date.jour}</b><small>${date.mois}</small></span>` : ''}
    <span class="tuile-oeil-texte">
      <span class="tuile-oeil-etiquette">${etiquette}</span>
      <strong class="tuile-oeil-valeur">${valeur}</strong>
      ${sous ? `<span class="tuile-oeil-sous">${sous}</span>` : ''}
      ${action ? `<span class="tuile-oeil-action">${action}</span>` : ''}
    </span>
  `;
  return tuile;
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const majuscule = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Nom du jour d'une échéance proche : "Aujourd'hui", "Demain", "Mardi"... puis "12 nov." au-delà
// d'une semaine (un nom de jour seul deviendrait ambigu).
function quandEcheance(dansJours, dateIso) {
  if (dansJours === 0) return 'Aujourd\'hui';
  if (dansJours === 1) return 'Demain';
  const date = new Date(dateIso + 'T00:00:00');
  return dansJours < 7
    ? majuscule(date.toLocaleDateString('fr-FR', { weekday: 'long' }))
    : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

async function chargerResumes(promesseDechets) {
  const zone = document.getElementById('bandeau-resumes');
  if (!zone) return;
  const lire = (chemin) => appelApi(`/${window.COMMUNE_SLUG}${chemin}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);

  // Un module désactivé pour la commune répond en erreur → null → tuile simplement absente.
  const [agenda, alertes, sondages, entraide, mur, communeData, dechets] = await Promise.all([
    lire('/agenda'), lire('/alertes'), lire('/sondages'), lire('/coups-de-main'), lire('/mur'), lire('/commune'), promesseDechets,
  ]);
  const tuiles = [];

  const prochainEvt = agenda?.events?.[0];
  if (prochainEvt) {
    const debut = new Date(prochainEvt.date_debut);
    const memeJour = agenda.events.filter((e) => new Date(e.date_debut).toDateString() === debut.toDateString()).length - 1;
    const details = [
      `${majuscule(debut.toLocaleDateString('fr-FR', { weekday: 'long' }))} ${debut.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}`,
      prochainEvt.lieu ? escapeAttr(prochainEvt.lieu) : '',
      prochainEvt.total_participants ? pluriel(prochainEvt.total_participants, 'inscrit') : '',
      memeJour > 0 ? `+${pluriel(memeJour, 'autre')} ce jour` : '',
    ].filter(Boolean).join(' · ');
    tuiles.push(creerTuileCoupOeil({
      couleur: 'var(--eau)', etiquette: 'Prochain événement', valeur: escapeAttr(prochainEvt.titre), sous: details, large: true,
      date: { jour: debut.getDate(), mois: debut.toLocaleDateString('fr-FR', { month: 'short' }) },
      onClick: () => activerOnglet('agenda'),
    }));
  }

  const actives = (alertes?.alertes ?? []).filter((a) => a.statut !== 'resolue')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (actives.length) {
    tuiles.push(creerTuileCoupOeil({
      couleur: 'var(--rouge)', etiquette: '🚨 Alertes', valeur: `${actives.length} en cours`, sous: escapeAttr(actives[0].titre),
      onClick: () => activerOnglet('alertes'),
    }));
  }

  const collectes = [...(dechets?.collectes ?? []), ...(dechets?.exceptions ?? [])].sort((a, b) => a.dans_jours - b.dans_jours);
  if (collectes.length) {
    const c = collectes[0];
    const veille = c.dans_jours === 1;
    tuiles.push(creerTuileCoupOeil({
      couleur: 'var(--prairie)', etiquette: '🗑️ Déchets',
      valeur: LABELS_DECHET[c.type] ?? escapeAttr(c.libelle),
      sous: `${quandEcheance(c.dans_jours, c.prochaine_date ?? c.date)}${veille ? ' · à sortir ce soir' : ''}`,
      onClick: () => {
        const calendrier = document.getElementById('carte-dechets');
        if (!calendrier) return;
        calendrier.hidden = !calendrier.hidden;
        if (!calendrier.hidden) calendrier.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    }));
  }

  const sondageOuvert = (sondages?.sondages ?? []).find((s) =>
    (!s.closes_at || new Date(s.closes_at) > new Date()) && s.mes_votes.length === 0);
  if (sondageOuvert) {
    const q = sondageOuvert.question;
    tuiles.push(creerTuileCoupOeil({
      couleur: 'var(--aube)', etiquette: '🌡️ Sondage', valeur: escapeAttr(q.length > 60 ? q.slice(0, 60) + '…' : q), action: 'Je vote',
      onClick: () => activerOnglet('thermometre'),
    }));
  }

  const annonces = (entraide?.annonces ?? []).filter((a) => !a.pourvu);
  if (annonces.length) {
    const demandes = annonces.filter((a) => a.type === 'demande').length;
    const offres = annonces.length - demandes;
    tuiles.push(creerTuileCoupOeil({
      couleur: 'var(--prairie)', etiquette: '🤲 Entraide', valeur: pluriel(annonces.length, 'annonce'),
      sous: [demandes ? pluriel(demandes, 'demande') : '', offres ? pluriel(offres, 'offre') : ''].filter(Boolean).join(' · '),
      onClick: () => activerOnglet('coups-de-main'),
    }));
  }

  // Le Mur ne renvoie que ses 20 derniers messages : au-delà, "20+" plutôt qu'un faux total.
  const postsMur = mur?.posts ?? [];
  const aujourdhui = new Date().toDateString();
  const messagesDuJour = postsMur.filter((p) => new Date(p.created_at).toDateString() === aujourdhui).length;
  if (messagesDuJour) {
    tuiles.push(creerTuileCoupOeil({
      couleur: 'var(--eauM)', etiquette: '💬 Mur',
      valeur: messagesDuJour === postsMur.length && postsMur.length >= 20 ? '20+ messages' : pluriel(messagesDuJour, 'message'),
      sous: 'aujourd\'hui', onClick: () => activerOnglet('mur'),
    }));
  }

  const dateConseil = communeData?.commune?.prochain_conseil_date ? new Date(communeData.commune.prochain_conseil_date) : null;
  if (dateConseil && dateConseil > new Date()) {
    tuiles.push(creerTuileCoupOeil({
      couleur: 'var(--eau)', etiquette: '🏛️ Conseil',
      valeur: majuscule(dateConseil.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })),
      sous: `à ${dateConseil.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}`,
      onClick: () => activerOnglet('conseil'),
    }));
  }

  if (!tuiles.length) {
    tuiles.push(creerTuileCoupOeil({ couleur: 'var(--eauL)', etiquette: '🌿 Aujourd\'hui', valeur: 'Tout est calme', sous: 'rien de prévu pour l\'instant', large: true }));
  }
  const petites = tuiles.filter((t) => !t.classList.contains('tuile-oeil--large'));
  if (petites.length % 2 === 1) petites[petites.length - 1].classList.add('tuile-oeil--pleine');
  zone.replaceChildren(...tuiles);
}
