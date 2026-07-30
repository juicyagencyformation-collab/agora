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

  chargerMeteo();
  chargerDechetsDashboard();
  chargerDerniereActu();
  chargerResumes();
  chargerMiniXp();
  chargerPhotoVedette();
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

async function chargerMiniXp() {
  const zone = document.getElementById('carte-mini-xp');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/profil`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const data = await res.json();
  const xpDansNiveau = data.xp - data.xp_niveau_actuel;
  const xpPourNiveau = data.xp_niveau_suivant - data.xp_niveau_actuel;
  const pct = xpPourNiveau > 0 ? Math.round((xpDansNiveau / xpPourNiveau) * 100) : 100;

  zone.innerHTML = `
    <button class="mini-carte-resume" id="btn-vers-profil" style="width:100%;">
      <span>⭐</span>
      <span style="flex:1;">
        Niveau ${data.niveau} — ${xpDansNiveau}/${xpPourNiveau} XP
        <div class="jauge" style="margin-top:4px;"><div class="jauge-remplie" style="width:${pct}%"></div></div>
      </span>
    </button>
  `;
  document.getElementById('btn-vers-profil').addEventListener('click', () => activerOnglet('profil'));
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
      <div class="meteo-icone">${infos.icone}</div>
      <div>
        <div class="meteo-temp">${Math.round(data.current.temperature_2m)}°C</div>
        <div class="meteo-label">${infos.label}</div>
        <div class="meteo-minmax">↓ ${Math.round(data.daily.temperature_2m_min[0])}° · ↑ ${Math.round(data.daily.temperature_2m_max[0])}°</div>
      </div>
    `;
  } catch {
    zone.innerHTML = `<p class="meteo-erreur">Météo indisponible pour le moment.</p>`;
  }
}

async function chargerDechetsDashboard() {
  const zone = document.getElementById('carte-dechets');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/dechets`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { collectes } = await res.json();

  if (!collectes.length) {
    zone.innerHTML = `<p class="dechets-vide">Aucun calendrier de collecte configuré. (Modération → Déchets)</p>`;
    return;
  }

  const aujourdhui = collectes.filter((c) => c.aujourdhui);
  const prochaine = collectes.find((c) => !c.aujourdhui);

  let html = '';
  if (aujourdhui.length) {
    html += aujourdhui.map((c) => `
      <div class="ligne-dechet ligne-dechet-today" style="border-left-color:${c.couleur}">
        <strong>🗑️ Aujourd'hui : ${LABELS_DECHET[c.type] ?? c.type}</strong>
      </div>
    `).join('');
  } else {
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
  const extrait = a.contenu_html.replace(/<[^>]+>/g, '').slice(0, 140);
  zone.innerHTML = `
    <h4>${escapeAttr(a.titre)}</h4>
    <p class="extrait-actu">${escapeAttr(extrait)}${extrait.length >= 140 ? '…' : ''}</p>
    <button id="btn-voir-actu">Voir toutes les actualités</button>
  `;
  zone.querySelector('#btn-voir-actu').addEventListener('click', () => activerOnglet('actualites'));
}

async function chargerResumes() {
  const zone = document.getElementById('bandeau-resumes');
  if (!zone) return;
  zone.innerHTML = '';

  const [alertesRes, agendaRes, sondagesRes, cdmRes] = await Promise.all([
    appelApi(`/${window.COMMUNE_SLUG}/alertes?statut=ouverte`),
    appelApi(`/${window.COMMUNE_SLUG}/agenda`),
    appelApi(`/${window.COMMUNE_SLUG}/sondages`),
    appelApi(`/${window.COMMUNE_SLUG}/coups-de-main`),
  ]);

  const items = [];

  if (alertesRes.ok) {
    const { alertes } = await alertesRes.json();
    items.push({ cle: 'alertes', icone: '🔔', texte: `${alertes.length} alerte(s) ouverte(s)` });
  }
  if (agendaRes.ok) {
    const { events } = await agendaRes.json();
    if (events.length) {
      const d = new Date(events[0].date_debut).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      items.push({ cle: 'agenda', icone: '📅', texte: `Prochain : ${events[0].titre} (${d})` });
    }
  }
  if (sondagesRes.ok) {
    const { sondages } = await sondagesRes.json();
    if (sondages.length) items.push({ cle: 'thermometre', icone: '🌡️', texte: `${sondages.length} sondage(s) en cours` });
  }
  if (cdmRes.ok) {
    const { annonces } = await cdmRes.json();
    items.push({ cle: 'coups-de-main', icone: '🤲', texte: `${annonces.length} annonce(s) d'entraide` });
  }

  items.forEach((item) => {
    const carte = document.createElement('button');
    carte.className = 'mini-carte-resume';
    carte.innerHTML = `<span>${item.icone}</span><span>${escapeAttr(item.texte)}</span>`;
    carte.addEventListener('click', () => activerOnglet(item.cle));
    zone.appendChild(carte);
  });
}
