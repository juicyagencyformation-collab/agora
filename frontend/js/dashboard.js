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
  chargerChecklistOnboarding();
  chargerCielJour();
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

  const [resActus, resDechets, resUtilisateurs] = await Promise.all([
    appelApi(`/${window.COMMUNE_SLUG}/actus?section=actualites`),
    appelApi(`/${window.COMMUNE_SLUG}/dechets`),
    appelApi(`/${window.COMMUNE_SLUG}/moderation/utilisateurs`),
  ]);
  const aArticle = resActus.ok && ((await resActus.json()).articles?.length > 0);
  const aDechets = resDechets.ok && ((await resDechets.json()).collectes?.length > 0);
  let aCollegue = false;
  if (resUtilisateurs.ok) {
    const { utilisateurs } = await resUtilisateurs.json();
    aCollegue = utilisateurs.filter((u) => ['admin', 'elu', 'maire', 'superadmin'].includes(u.role)).length > 1;
  }

  if (aArticle && aDechets && aCollegue) { zone.hidden = true; return; } // tout est déjà fait

  const etape = (fait, texte, cibleOnglet) => `
    <li class="${fait ? 'etape-checklist-faite' : ''}" ${!fait ? `data-onglet-cible="${cibleOnglet}"` : ''}>
      <span>${fait ? '✅' : '⬜'}</span> ${texte}
    </li>`;
  zone.hidden = false;
  zone.innerHTML = `
    <div class="carte-checklist-onboarding">
      <button type="button" class="btn-fermer-checklist" title="Masquer">✕</button>
      <strong>👋 Bien démarrer avec Agora</strong>
      <ul class="liste-checklist-onboarding">
        ${etape(aArticle, 'Publier un premier article', 'actualites')}
        ${etape(aDechets, 'Renseigner le calendrier des déchets', 'moderation')}
        ${etape(aCollegue, 'Donner un accès à un collègue (Modération → Gestion des rôles)', 'moderation')}
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

// Point (emoji ☀️/🌙) qui glisse sur l'arc en tête de la carte "Ciel du jour", à la position
// correspondant à la fraction écoulée de la période jour (lever→coucher) ou nuit
// (coucher→lever suivant) — courbe de Bézier quadratique, mêmes points de contrôle que le
// chemin SVG "arc-astre-trace" défini dans index.html.
function positionnerAstreSurArc(t, icone) {
  const point = document.getElementById('point-astre-emoji');
  if (!point) return;
  const p0 = { x: 8, y: 52 }, p1 = { x: 150, y: 4 }, p2 = { x: 292, y: 52 };
  const x = (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t ** 2 * p2.x;
  const y = (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t ** 2 * p2.y;
  point.setAttribute('x', x);
  point.setAttribute('y', y);
  point.textContent = icone;
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

// "Ciel du jour" — fusion météo + lune en une seule carte vivante : le fond glisse entre
// teintes d'aube/jour/crépuscule/nuit selon l'heure réelle (calculé localement à partir du
// lever/coucher du soleil renvoyés par Open-Meteo, même appel que la météo, aucune requête
// en plus), et un petit ☀️/🌙 se déplace sur un arc pour indiquer où on en est dans la
// journée ou la nuit en cours.
async function chargerCielJour() {
  const carte = document.getElementById('carte-jour-hero');
  const zoneMeteo = document.getElementById('carte-meteo');
  const zoneLune = document.getElementById('carte-lune');
  const phaseLune = calculerPhaseLune();

  try {
    const lat = window.COMMUNE_LAT ?? 43.6047;
    const lng = window.COMMUNE_LNG ?? 1.4442;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weathercode,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=Europe%2FParis&forecast_days=2`;
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const code = data.current.weathercode;
    const infos = CODES_METEO[code] ?? { label: 'Météo indisponible', icone: '🌡️' };

    const maintenant = new Date();
    const leverAuj = new Date(data.daily.sunrise[0]);
    const coucherAuj = new Date(data.daily.sunset[0]);
    const leverDemain = new Date(data.daily.sunrise[1] ?? data.daily.sunrise[0]);
    const estJour = maintenant >= leverAuj && maintenant <= coucherAuj;

    // Fenêtre de transition (teintes d'aube/crépuscule) : ±40 min autour du lever/coucher.
    const TRANSITION_MS = 40 * 60 * 1000;
    let phaseCiel = estJour ? 'jour' : 'nuit';
    if (Math.abs(maintenant - leverAuj) < TRANSITION_MS) phaseCiel = 'aube';
    else if (Math.abs(maintenant - coucherAuj) < TRANSITION_MS) phaseCiel = 'crepuscule';
    if (carte) {
      carte.classList.remove('ciel--jour', 'ciel--nuit', 'ciel--aube', 'ciel--crepuscule');
      carte.classList.add(`ciel--${phaseCiel}`);
    }

    // Position de l'astre sur l'arc : fraction de la période jour (lever→coucher) ou nuit
    // (coucher→lever du lendemain) déjà écoulée, bornée à [0,1] pour rester sur l'arc même
    // dans les cas limites (ex. app ouverte juste avant le lever calculé).
    let fraction, astre;
    if (estJour) {
      fraction = (maintenant - leverAuj) / (coucherAuj - leverAuj);
      astre = '☀️';
    } else {
      const debutNuit = maintenant < leverAuj ? new Date(leverAuj.getTime() - 24 * 3600 * 1000) : coucherAuj;
      const finNuit = maintenant < leverAuj ? leverAuj : leverDemain;
      fraction = (maintenant - debutNuit) / (finNuit - debutNuit);
      astre = phaseLune.icone;
    }
    positionnerAstreSurArc(Math.max(0, Math.min(1, fraction)), astre);

    if (zoneMeteo) {
      zoneMeteo.innerHTML = `
        <div class="meteo-icone-hero">${infos.icone}</div>
        <div class="meteo-corps-hero">
          <div class="meteo-temp-hero">${Math.round(data.current.temperature_2m)}°</div>
          <div class="meteo-label-hero">${infos.label} · ↓${Math.round(data.daily.temperature_2m_min[0])}° ↑${Math.round(data.daily.temperature_2m_max[0])}°</div>
          <div class="ciel-puces-meteo">
            <span class="puce-meteo">💧 ${Math.round(data.current.relative_humidity_2m)}%</span>
            <span class="puce-meteo">🤔 ${Math.round(data.current.apparent_temperature)}°</span>
            <span class="puce-meteo">🌬️ ${Math.round(data.current.wind_speed_10m)} km/h</span>
          </div>
        </div>
      `;
    }
  } catch {
    if (zoneMeteo) zoneMeteo.innerHTML = `<p class="meteo-erreur">Météo indisponible.</p>`;
    positionnerAstreSurArc(0.5, phaseLune.icone);
  }

  if (zoneLune) {
    const diametreLune = 36;
    const illumFrac = phaseLune.illumination / 100;
    const croissante = phaseLune.fractionCycle <= 0.5;
    const decalage = Math.round(diametreLune * (croissante ? -illumFrac : illumFrac));
    zoneLune.innerHTML = `
      <div class="lune-disque"><div class="lune-ombre" style="transform:translateX(${decalage}px)"></div></div>
      <div>
        <div class="lune-label-hero">${phaseLune.nom}</div>
        <div class="lune-detail-hero">${phaseLune.illumination}% illuminée · ${phaseLune.texteEcheance}</div>
        <div class="lune-conseil-hero">🌱 ${phaseLune.conseil}</div>
      </div>
    `;
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

  // Volontairement, on n'affiche PLUS la "prochaine collecte" quand elle est à ≥2 jours :
  // seul le jour même (ci-dessous) ou la veille (grande alerte du haut) sont pertinents au
  // quotidien. Sinon on garde l'accueil sobre avec un simple "Rien à sortir aujourd'hui".
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
      <div class="puce-icone-carte">🏛️</div>
      <div>
        <div style="font-size:11px;color:var(--roseau);font-weight:600;">Prochain conseil municipal</div>
        <div style="font-size:15px;font-weight:700;color:var(--boue);text-transform:capitalize;">${dateAffichee}</div>
        <div style="font-size:12.5px;color:var(--roseau);">à ${heureAffichee}</div>
      </div>
    </div>
  `;
  zone.onclick = () => activerOnglet('conseil');
}

// Une tuile = une icône ronde + un titre (Playfair, gras) + un sous-titre (contexte).
// Sans onClick, la tuile devient un simple repère statique (ex. "Tout est calme").
function creerTuileCoupOeil(couleur, icone, titreTuile, sousTitre, onClick) {
  const tuile = document.createElement('button');
  tuile.type = 'button';
  tuile.className = `tuile-coup-oeil tuile-coup-oeil--${couleur}`;
  tuile.innerHTML = `
    <span class="tuile-coup-oeil-icone">${icone}</span>
    <span class="tuile-coup-oeil-texte">
      <strong class="tuile-coup-oeil-titre">${titreTuile}</strong>
      <span class="tuile-coup-oeil-sous">${sousTitre}</span>
    </span>
  `;
  if (onClick) tuile.addEventListener('click', onClick);
  return tuile;
}

// "En un coup d'œil" : mini-synthèse vivante de la commune (agenda du jour, alertes actives,
// sondage en cours, entraide ouverte). Toujours au moins une tuile affichée — un repli "Tout
// est calme" plutôt qu'une section vide, pour que ce soit un vrai reflet de vie locale et pas
// un bloc qui disparaît la plupart des jours (ancien comportement, agenda-seul).
async function chargerResumes() {
  const zone = document.getElementById('bandeau-resumes');
  if (!zone) return;
  zone.innerHTML = '';

  const [agendaRes, alertesRes, sondagesRes, coupsDeMainRes] = await Promise.all([
    appelApi(`/${window.COMMUNE_SLUG}/agenda`),
    appelApi(`/${window.COMMUNE_SLUG}/alertes`),
    appelApi(`/${window.COMMUNE_SLUG}/sondages`),
    appelApi(`/${window.COMMUNE_SLUG}/coups-de-main`),
  ]);

  if (agendaRes.ok) {
    const { events } = await agendaRes.json();
    if (events.length) {
      // Le plus proche événement fixe le jour affiché : s'il y en a plusieurs ce jour-là,
      // une tuile par événement (pas seulement le premier de la liste).
      const premierJour = new Date(events[0].date_debut);
      const memeJour = (date) => date.getFullYear() === premierJour.getFullYear()
        && date.getMonth() === premierJour.getMonth() && date.getDate() === premierJour.getDate();
      for (const evt of events.filter((e) => memeJour(new Date(e.date_debut)))) {
        const d = new Date(evt.date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        zone.appendChild(creerTuileCoupOeil('eau', '📅', escapeAttr(evt.titre), d, () => activerOnglet('agenda')));
      }
    }
  }

  if (alertesRes.ok) {
    const { alertes } = await alertesRes.json();
    const actives = alertes.filter((a) => a.statut !== 'resolue');
    if (actives.length) {
      zone.appendChild(creerTuileCoupOeil(
        'rouge', '🚨', `${actives.length} alerte${actives.length > 1 ? 's' : ''}`, 'en cours',
        () => activerOnglet('alertes'),
      ));
    }
  }

  if (sondagesRes.ok) {
    const { sondages } = await sondagesRes.json();
    const ouvert = sondages.find((s) =>
      (!s.closes_at || new Date(s.closes_at) > new Date()) && s.mes_votes.length === 0);
    if (ouvert) {
      const question = escapeAttr(ouvert.question).slice(0, 34);
      zone.appendChild(creerTuileCoupOeil(
        'aube', '🌡️', 'Sondage en cours', question + (ouvert.question.length > 34 ? '…' : ''),
        () => activerOnglet('thermometre'),
      ));
    }
  }

  if (coupsDeMainRes.ok) {
    const { annonces } = await coupsDeMainRes.json();
    if (annonces?.length) {
      zone.appendChild(creerTuileCoupOeil(
        'prairie', '🤲', `${annonces.length} coup${annonces.length > 1 ? 's' : ''} de main`, 'entraide ouverte',
        () => activerOnglet('coups-de-main'),
      ));
    }
  }

  if (!zone.children.length) {
    zone.appendChild(creerTuileCoupOeil('neutre', '🌿', 'Tout est calme', 'aujourd\'hui'));
  }
}
