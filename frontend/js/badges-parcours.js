// frontend/js/badges-parcours.js
// Badges de parcours (2026-11-15, migration 104 — logique serveur : worker/src/lib/badges-parcours.ts).
// Ici : dessin des médailles (SVG, sans image), volet « Badge » du formulaire de parcours, animation
// de déblocage, carte image à partager, diplôme à imprimer et collection du profil.

// Listes fermées, identiques à celles du Worker (ICONES_BADGE, METAUX_BADGE) : le serveur refuse
// toute autre valeur.
const ICONES_BADGE = ['🏰', '⛪', '🕊️', '🌾', '🦆', '🐟', '🌉', '⚓', '🌳', '🍎', '🗝️', '🧭', '🏛️', '⛲', '🚲', '🌻'];
const METAUX_BADGE = {
  or: { nom: 'Or', clair: '#F6E39A', base: '#D4AF37', fonce: '#9C7B1F', encre: '#4A3A0C', ruban1: '#2C5F6E', ruban2: '#E2C97E' },
  argent: { nom: 'Argent', clair: '#F4F6F8', base: '#BFC6CD', fonce: '#7E8790', encre: '#2F363C', ruban1: '#2C5F6E', ruban2: '#C8DDE4' },
  bronze: { nom: 'Bronze', clair: '#EBB37F', base: '#B87333', fonce: '#7C4A1E', encre: '#3B2310', ruban1: '#5C7A4E', ruban2: '#E2C97E' },
  somme: { nom: 'Bleu Somme', clair: '#7FB5C4', base: '#2C5F6E', fonce: '#173A44', encre: '#EAF4F7', ruban1: '#E2C97E', ruban2: '#2C5F6E' },
  prairie: { nom: 'Vert prairie', clair: '#A9C298', base: '#5C7A4E', fonce: '#36492D', encre: '#F2F6EE', ruban1: '#E2C97E', ruban2: '#5C7A4E' },
  brique: { nom: 'Brique', clair: '#DF957C', base: '#A84B32', fonce: '#6E2D1D', encre: '#FCEDE6', ruban1: '#2C5F6E', ruban2: '#E2C97E' },
};
let compteurSvgMedaille = 0;

const anneeBadge = (b) => new Date(b.created_at || Date.now()).getFullYear();
const dateBadge = (b) => new Date(b.created_at || Date.now()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const rangBadge = (b) => (b.rang ? `${b.rang}${b.rang === 1 ? 're' : 'ᵉ'} personne à l'obtenir` : '');
// Niveau du grand badge du village (monte quand la mairie ajoute des parcours et qu'on les termine).
const etoilesNiveau = (n) => (n > 5 ? `★×${n}` : '★'.repeat(Math.max(1, n || 1)));
const libelleNiveau = (b) => (b.type === 'village' ? `niveau ${etoilesNiveau(b.niveau)}` : '');

// Médaille : disque au métal choisi, village gravé en haut, année en bas, icône au centre, ruban.
// verrou = silhouette « à découvrir ». pixels = taille intrinsèque (nécessaire pour la dessiner
// dans un canvas : Safari ne dessine pas un SVG sans largeur/hauteur).
function svgMedaille(b, { verrou = false, pixels = null } = {}) {
  const taille = pixels ? ` width="${pixels}" height="${Math.round(pixels * 1.25)}"` : '';
  if (verrou) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250"${taille} role="img" aria-label="Badge à découvrir">
      <path d="M70 150 L100 160 L90 244 L74 226 L58 240 Z M130 150 L100 160 L110 244 L126 226 L142 240 Z" fill="#E4DDD0"/>
      <circle cx="100" cy="100" r="90" fill="#F1ECE3" stroke="#D8CFBF" stroke-width="3" stroke-dasharray="6 6"/>
      <text x="100" y="104" text-anchor="middle" dominant-baseline="central" font-family="Playfair Display, Georgia, serif" font-size="70" font-weight="900" fill="#CFC4B1">?</text>
    </svg>`;
  }
  const m = METAUX_BADGE[b.metal] || METAUX_BADGE.or;
  const id = `med${compteurSvgMedaille++}`;
  const village = (b.village_nom || '').toUpperCase();
  const tailleVillage = village.length > 22 ? 8.5 : village.length > 18 ? 9.5 : village.length > 14 ? 10.5 : 12;
  const grand = b.type === 'village';
  const etoiles = grand ? [0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
    const x = (100 + 96 * Math.cos((a * Math.PI) / 180)).toFixed(1);
    const y = (100 + 96 * Math.sin((a * Math.PI) / 180)).toFixed(1);
    return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="13" fill="${m.fonce}">★</text>`;
  }).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 250"${taille} role="img" aria-label="Badge ${escapeAttr(b.nom || '')}">
    <defs>
      <linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${m.clair}"/><stop offset=".55" stop-color="${m.base}"/><stop offset="1" stop-color="${m.fonce}"/></linearGradient>
      <radialGradient id="c${id}" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="${m.clair}"/><stop offset=".7" stop-color="${m.base}"/><stop offset="1" stop-color="${m.fonce}"/></radialGradient>
      <path id="h${id}" d="M 34 100 A 66 66 0 0 1 166 100"/>
      <path id="b${id}" d="M 25 100 A 75 75 0 0 0 175 100"/>
    </defs>
    <path d="M70 148 L100 158 L90 244 L74 226 L58 240 Z M130 148 L100 158 L110 244 L126 226 L142 240 Z" fill="${m.ruban1}" stroke="#fff" stroke-opacity=".6" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M78 151 L88 154 L80 232 L74 226 Z M122 151 L112 154 L120 232 L126 226 Z" fill="${m.ruban2}" opacity=".85"/>
    <circle cx="100" cy="100" r="92" fill="url(#g${id})"/>
    <circle cx="100" cy="100" r="88" fill="none" stroke="${m.fonce}" stroke-width="4" stroke-dasharray="2 3.2" opacity=".45"/>
    <circle cx="100" cy="100" r="80" fill="url(#c${id})" stroke="${m.fonce}" stroke-opacity=".35" stroke-width="1.5"/>
    <circle cx="100" cy="100" r="60" fill="${m.fonce}" fill-opacity=".16" stroke="${m.clair}" stroke-width="1.5"/>
    <text font-family="DM Mono, Consolas, monospace" font-size="${tailleVillage}" font-weight="500" letter-spacing="1.6" fill="${m.encre}"><textPath href="#h${id}" startOffset="50%" text-anchor="middle">${escapeAttr(village)}</textPath></text>
    <text font-family="DM Mono, Consolas, monospace" font-size="11" letter-spacing="3" fill="${m.encre}"><textPath href="#b${id}" startOffset="50%" text-anchor="middle">${grand ? `${etoilesNiveau(b.niveau)} ${anneeBadge(b)}` : `★ ${anneeBadge(b)} ★`}</textPath></text>
    <text x="100" y="103" text-anchor="middle" dominant-baseline="central" font-size="58">${escapeAttr(b.icone || '🏅')}</text>
    <ellipse cx="78" cy="62" rx="26" ry="11" fill="#fff" opacity=".18" transform="rotate(-30 78 62)"/>
    ${grand ? `<circle cx="100" cy="100" r="96" fill="none" stroke="${m.clair}" stroke-width="2.5"/>${etoiles}` : ''}
  </svg>`;
}

// ── Volet « Badge de fin de parcours » du formulaire (création, brouillon, modification) ──

function htmlVoletBadge(chasse) {
  const actif = !!chasse?.badge_nom;
  const icone = chasse?.badge_icone || ICONES_BADGE[0];
  const metal = chasse?.badge_metal || 'or';
  return `
    <details class="volet-badge-parcours" ${actif ? 'open' : ''}>
      <summary>🏅 Badge de fin de parcours <small>· facultatif</small></summary>
      <label class="ligne-case-badge"><input type="checkbox" id="badge-actif" ${actif ? 'checked' : ''}> Offrir un badge à ceux qui terminent ce parcours</label>
      <div class="champs-badge" ${actif ? '' : 'hidden'}>
        <div class="apercu-badge-form"><div class="apercu-badge-svg"></div><div><strong class="apercu-badge-nom"></strong><small>Aperçu · le nom du village et l'année sont gravés automatiquement</small></div></div>
        <input type="text" id="badge-nom" maxlength="40" placeholder="Nom du badge (ex. Gardien du patrimoine)" value="${escapeAttr(chasse?.badge_nom || '')}">
        <input type="text" id="badge-phrase" maxlength="90" placeholder="Petite phrase (facultatif)" value="${escapeAttr(chasse?.badge_phrase || '')}">
        <span class="libelle-badge">Icône</span>
        <div class="grille-icones-badge">${ICONES_BADGE.map((ic) => `<button type="button" data-icone="${ic}" aria-pressed="${ic === icone}" aria-label="Icône ${ic}">${ic}</button>`).join('')}</div>
        <span class="libelle-badge">Métal</span>
        <div class="metaux-badge">${Object.entries(METAUX_BADGE).map(([cle, m]) => `<button type="button" data-metal="${cle}" aria-pressed="${cle === metal}" title="${m.nom}" aria-label="Métal ${m.nom}" style="background:linear-gradient(135deg, ${m.clair}, ${m.base} 55%, ${m.fonce});"></button>`).join('')}</div>
        <button type="button" class="btn-voir-animation-badge">▶ Voir l'animation</button>
      </div>
    </details>
  `;
}

function lireReglageBadge(corps) {
  return {
    nom: corps.querySelector('#badge-nom').value.trim(),
    phrase: corps.querySelector('#badge-phrase').value.trim(),
    icone: corps.querySelector('.grille-icones-badge [aria-pressed="true"]')?.dataset.icone || ICONES_BADGE[0],
    metal: corps.querySelector('.metaux-badge [aria-pressed="true"]')?.dataset.metal || 'or',
  };
}

function initVoletBadge(corps) {
  const volet = corps.querySelector('.volet-badge-parcours');
  if (!volet) return;
  const apercu = () => {
    const b = { ...lireReglageBadge(corps), village_nom: window.COMMUNE_NOM || '' };
    volet.querySelector('.apercu-badge-svg').innerHTML = svgMedaille(b);
    volet.querySelector('.apercu-badge-nom').textContent = b.nom || 'Nom du badge';
  };
  const choisir = (selecteur) => volet.querySelectorAll(selecteur).forEach((btn) => btn.addEventListener('click', () => {
    volet.querySelectorAll(selecteur).forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
    apercu();
  }));
  choisir('.grille-icones-badge button');
  choisir('.metaux-badge button');
  volet.querySelector('#badge-actif').addEventListener('change', (e) => { volet.querySelector('.champs-badge').hidden = !e.target.checked; });
  volet.querySelector('#badge-nom').addEventListener('input', apercu);
  volet.querySelector('.btn-voir-animation-badge').addEventListener('click', () => {
    const b = lireReglageBadge(corps);
    celebrerBadgesParcours([{ ...b, type: 'parcours', village_nom: window.COMMUNE_NOM || '', parcours_titre: corps.querySelector('#titre-chasse-modale')?.value.trim() || '', nom: b.nom || 'Nom du badge' }], { test: true, immediat: true });
  });
  apercu();
}

// Valeur à envoyer au serveur : null = pas de badge ; false = saisie incomplète (message affiché).
function valeurVoletBadge(corps) {
  if (!corps.querySelector('#badge-actif')?.checked) return null;
  const b = lireReglageBadge(corps);
  if (!b.nom) {
    afficherToastMessage('Donnez un nom au badge, ou décochez « Offrir un badge ».', 'erreur');
    return false;
  }
  return { nom: b.nom, icone: b.icone, metal: b.metal, ...(b.phrase ? { phrase: b.phrase } : {}) };
}

// ── Animation de déblocage : la médaille tombe en tournant, rebondit, un reflet passe, rayons et
// confettis. Elle attend qu'aucune autre fenêtre ne soit ouverte (fiche Découverte de la dernière
// étape, badge « Finisseur », montée de niveau) pour ne pas les recouvrir. ──

let fileBadgesParcours = [];
let celebrationParcoursEnCours = false;

function celebrerBadgesParcours(liste, { test = false, immediat = false } = {}) {
  liste.forEach((b) => fileBadgesParcours.push({ ...b, test }));
  if (immediat) { jouerProchainBadgeParcours(); return; }
  attendreFenetresFermees(jouerProchainBadgeParcours);
}

function attendreFenetresFermees(suite) {
  const ouverte = () => document.querySelector('.overlay-modale-formulaire, .overlay-badge-debloque, .overlay-niveau');
  if (!ouverte()) { suite(); return; }
  const minuteur = setInterval(() => {
    if (ouverte()) return;
    clearInterval(minuteur);
    setTimeout(suite, 250);
  }, 400);
}

function jouerProchainBadgeParcours() {
  if (celebrationParcoursEnCours || !fileBadgesParcours.length) return;
  celebrationParcoursEnCours = true;
  const b = fileBadgesParcours.shift();
  const surtitre = b.test ? 'Aperçu · rien n’est enregistré'
    : b.ameliore ? `Grand badge amélioré · niveau ${etoilesNiveau(b.niveau)}`
      : (b.type === 'village' ? 'Grand badge du village' : 'Parcours terminé · nouveau badge');
  const overlay = document.createElement('div');
  overlay.className = 'overlay-badge-parcours';
  overlay.innerHTML = `
    <div class="rayons-badge-parcours"></div>
    <div class="halo-badge-parcours"></div>
    <div class="confettis-badge-parcours"></div>
    <div class="porte-medaille-parcours">
      <div class="medaille-parcours-anim">${svgMedaille(b)}</div>
      <div class="reflet-medaille-parcours"></div>
      <span class="etincelle-parcours" style="left:-6%;top:12%;animation-delay:1.45s">✦</span>
      <span class="etincelle-parcours" style="right:-4%;top:6%;animation-delay:1.6s;font-size:12px">✦</span>
      <span class="etincelle-parcours" style="right:-8%;top:52%;animation-delay:1.75s">✦</span>
      <span class="etincelle-parcours" style="left:-10%;top:58%;animation-delay:1.9s;font-size:11px">✦</span>
    </div>
    <div class="textes-badge-parcours">
      <span class="surtitre-badge-parcours">${surtitre}</span>
      <p class="nom-badge-parcours">${escapeAttr(b.nom)}</p>
      <p class="phrase-badge-parcours" ${b.phrase ? '' : 'hidden'}>${escapeAttr(b.phrase || '')}</p>
      <span class="puce-badge-parcours" ${b.test ? 'hidden' : ''}>🏅 ${b.ameliore ? 'Tous les parcours terminés' : `${rangBadge(b) || 'Nouveau badge'} · ajouté à votre collection`}</span>
    </div>
    <div class="actions-badge-parcours">
      ${b.test ? '' : '<button type="button" class="btn-partager-badge-parcours">📤 Partager mon badge</button><button type="button" class="btn-collection-badge-parcours">Voir ma collection</button>'}
      <button type="button" class="btn-fermer-badge-parcours">${b.test ? 'Fermer l’aperçu' : 'Fermer'}</button>
    </div>
  `;
  const couleurs = ['#E2C97E', '#F6E39A', '#4A8FA0', '#C8DDE4', '#5C7A4E', '#FFFFFF'];
  const zone = overlay.querySelector('.confettis-badge-parcours');
  for (let i = 0; i < 34; i++) {
    const c = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const distance = 90 + Math.random() * 170;
    c.style.background = couleurs[i % couleurs.length];
    c.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
    c.style.setProperty('--y', `${Math.sin(angle) * distance + 120}px`);
    c.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    c.style.setProperty('--d', `${1.15 + Math.random() * 0.15}s`);
    zone.appendChild(c);
  }
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible', 'joue'));
  // Petite vibration à l'atterrissage (Android ; l'iPhone n'a pas cette fonction).
  setTimeout(() => { if (typeof navigator.vibrate === 'function') navigator.vibrate([30, 60, 30]); }, 1000);

  const fermer = () => {
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.remove();
      celebrationParcoursEnCours = false;
      jouerProchainBadgeParcours();
    }, 300);
  };
  overlay.querySelector('.btn-fermer-badge-parcours').addEventListener('click', fermer);
  overlay.querySelector('.btn-partager-badge-parcours')?.addEventListener('click', () => partagerBadgeParcours(b));
  overlay.querySelector('.btn-collection-badge-parcours')?.addEventListener('click', () => {
    fileBadgesParcours = []; // la collection montre déjà tous les badges gagnés
    fermer();
    window.OUVRIR_COLLECTION_PARCOURS = true;
    if (typeof activerOnglet === 'function') activerOnglet('profil');
  });
}

// ── Carte image à partager (1080 × 1350, format des réseaux sociaux). Aucune donnée personnelle
// dessus : badge, village, date, rang et le lien pour jouer à son tour. ──

function chargerImageSvg(svg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

// Texte sur plusieurs lignes centrées ; renvoie la position sous la dernière ligne.
function ecrireLignes(ctx, texte, y, largeurMax, hauteurLigne) {
  const mots = texte.split(' ');
  let ligne = '';
  for (const mot of mots) {
    const essai = ligne ? `${ligne} ${mot}` : mot;
    if (ctx.measureText(essai).width > largeurMax && ligne) {
      ctx.fillText(ligne, 540, y);
      y += hauteurLigne;
      ligne = mot;
    } else {
      ligne = essai;
    }
  }
  if (ligne) { ctx.fillText(ligne, 540, y); y += hauteurLigne; }
  return y;
}

async function dessinerCarteBadge(b) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  const fond = ctx.createRadialGradient(540, 470, 40, 540, 470, 950);
  fond.addColorStop(0, '#2F6B7D');
  fond.addColorStop(1, '#12303A');
  ctx.fillStyle = fond;
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.save();
  ctx.translate(540, 470);
  ctx.fillStyle = 'rgba(226,201,126,0.10)';
  for (let i = 0; i < 16; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 1000, 0, 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.rotate((Math.PI * 2) / 16);
  }
  ctx.restore();

  const image = await chargerImageSvg(svgMedaille(b, { pixels: 440 }));
  ctx.drawImage(image, 540 - 220, 140, 440, 550);
  if (document.fonts?.ready) await document.fonts.ready;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#E2C97E';
  ctx.font = '500 32px "DM Mono", monospace';
  ctx.fillText(b.type === 'village' ? `GRAND BADGE DU VILLAGE${b.niveau > 1 ? ` · NIVEAU ${b.niveau}` : ''}` : 'PARCOURS TERMINÉ', 540, 100);

  let y = 790;
  ctx.fillStyle = '#CFE1E6';
  ctx.font = '400 38px "DM Sans", sans-serif';
  y = ecrireLignes(ctx, b.parcours_titre ? `J'ai terminé « ${b.parcours_titre} »` : `J'ai terminé tous les parcours du village`, y, 900, 50);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 70px "Playfair Display", Georgia, serif';
  y = ecrireLignes(ctx, b.nom, y + 40, 920, 80);
  ctx.fillStyle = '#F3DE8A';
  ctx.font = '500 30px "DM Mono", monospace';
  ctx.fillText([b.village_nom, dateBadge(b), b.rang ? `${b.rang}${b.rang === 1 ? 're' : 'ᵉ'} à l'obtenir` : ''].filter(Boolean).join(' · '), 540, y + 10);

  // Ni lien ni QR code (décision de Léandre, 2026-11-15) : selon l'endroit où l'image est
  // partagée, des inconnus pourraient s'inscrire dans le village.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(90, 1195);
  ctx.lineTo(990, 1195);
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 38px "DM Sans", sans-serif';
  ctx.fillText('À vous de jouer !', 540, 1280);
  return canvas;
}

async function partagerBadgeParcours(b) {
  let blob;
  try {
    const canvas = await dessinerCarteBadge(b);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    blob = null;
  }
  if (!blob) { afficherToastMessage('Impossible de préparer l’image du badge.', 'erreur'); return; }
  const nomFichier = `badge-${(b.nom || 'agora').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  const fichier = new File([blob], nomFichier, { type: 'image/png' });
  const texte = `J'ai gagné le badge « ${b.nom} » à ${b.village_nom} !`;
  if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], text: texte });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return; // partage annulé par la personne
    }
  }
  // Pas de partage natif (ordinateur…) : l'image est téléchargée.
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(blob);
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 4000);
  afficherToastMessage('Image du badge enregistrée : partagez-la où vous voulez.', 'succes');
}

// ── Diplôme A4 paysage : aperçu plein écran puis impression (feuille de style @media print).
// Prénom seul, jamais le nom de famille ; « remis par la commune », sans signature. ──

function ouvrirDiplomeParcours(b, prenom) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay-diplome-parcours';
  overlay.innerHTML = `
    <div class="barre-diplome-parcours">
      <button type="button" class="btn-imprimer-diplome">🖨️ Imprimer</button>
      <button type="button" class="btn-fermer-diplome">Fermer</button>
    </div>
    <div class="feuille-diplome-parcours"><div class="cadre-diplome-parcours">
      <div class="texte-diplome-parcours">
        <span class="village-diplome">${escapeAttr(b.village_nom || '')}</span>
        <h2>Diplôme d'exploration</h2>
        <p>décerné à</p>
        <span class="prenom-diplome">${escapeAttr(prenom || '')}</span>
        <p>${b.parcours_titre
          ? `pour avoir terminé le parcours <strong>« ${escapeAttr(b.parcours_titre)} »</strong>.`
          : `pour avoir terminé <strong>tous les parcours du village</strong>.`}</p>
        <div class="pied-diplome"><span>Le ${dateBadge(b)}</span><span>Badge « ${escapeAttr(b.nom)} »${b.type === 'village' ? ` · ${libelleNiveau(b)}` : ''}${b.rang ? ` · ${rangBadge(b)}` : ''}</span></div>
      </div>
      <div class="medaille-diplome">${svgMedaille(b)}</div>
    </div></div>
  `;
  document.body.appendChild(overlay);
  document.body.classList.add('impression-diplome');
  const fermer = () => { overlay.remove(); document.body.classList.remove('impression-diplome'); };
  overlay.querySelector('.btn-fermer-diplome').addEventListener('click', fermer);
  overlay.querySelector('.btn-imprimer-diplome').addEventListener('click', () => {
    if (typeof window.print === 'function') window.print();
    else afficherToastMessage('L’impression n’est pas disponible sur cet appareil.', 'erreur');
  });
}

// ── Collection du profil (catégorie « 🗺️ Mes parcours ») ──

function htmlCollectionParcours(parcours) {
  const badges = parcours.badges || [];
  const parVillage = new Map();
  // Mon village d'abord (avec les silhouettes), puis les autres dans l'ordre d'obtention.
  const ici = window.COMMUNE_NOM || parcours.grand_badge?.village_nom || '';
  if (parcours.a_decouvrir.length || badges.some((b) => b.village_slug === window.COMMUNE_SLUG)) parVillage.set(ici, []);
  badges.forEach((b, i) => {
    const cle = b.village_slug === window.COMMUNE_SLUG ? ici : b.village_nom;
    if (!parVillage.has(cle)) parVillage.set(cle, []);
    parVillage.get(cle).push(`<button type="button" class="case-medaille-parcours" data-i="${i}">${svgMedaille(b)}<b>${escapeAttr(b.nom)}</b><small>${b.type === 'village' ? `Niveau ${etoilesNiveau(b.niveau)}` : dateBadge(b)}</small></button>`);
  });
  if (parVillage.has(ici)) {
    parcours.a_decouvrir.forEach((p) => parVillage.get(ici).push(`<button type="button" class="case-medaille-parcours verrou" data-titre="${escapeAttr(p.parcours_titre)}">${svgMedaille({}, { verrou: true })}<b>À découvrir</b><small>${escapeAttr(p.parcours_titre)}</small></button>`));
  }
  const villages = new Set(badges.map((b) => b.village_nom)).size;
  const g = parcours.grand_badge;
  // Grand badge : à gagner (grisé), ou déjà gagné mais la mairie a publié de nouveaux parcours
  // (en couleur, « à faire monter »). Gagné et à jour : rien ici, il est dans la grille.
  const reste = g ? g.total - g.termines : 0;
  const grand = g && (!g.obtenu || reste > 0) ? `
    <div class="grand-badge-parcours ${g.obtenu ? 'a-faire-monter' : ''}">
      <div class="grand-badge-svg">${svgMedaille({ type: 'village', nom: g.nom, icone: g.icone, metal: g.metal, village_nom: g.village_nom, niveau: g.obtenu ? g.niveau : 1 })}</div>
      <div><strong>${escapeAttr(g.nom)}${g.obtenu ? ` · niveau ${etoilesNiveau(g.niveau)}` : ''}</strong>
        <div class="jauge-grand-badge"><div style="width:${Math.round((g.termines / g.total) * 100)}%"></div></div>
        <small>${g.obtenu
          ? `${reste > 1 ? `${reste} nouveaux parcours` : 'Nouveau parcours'} dans votre village : ${reste > 1 ? 'terminez-les' : 'terminez-le'} pour faire monter votre badge au niveau ${etoilesNiveau(g.niveau + 1)}.`
          : `${g.termines} parcours sur ${g.total}. Terminez-les tous pour gagner le grand badge du village.`}</small></div>
    </div>` : '';
  if (!badges.length && !grand && !parcours.a_decouvrir.length) return '';
  return `
    <div class="resume-collection-parcours">
      <div><strong>${badges.length}</strong><span>badge${badges.length > 1 ? 's' : ''}</span></div>
      <div><strong>${villages}</strong><span>village${villages > 1 ? 's' : ''}</span></div>
      ${g ? `<div><strong>${g.termines}/${g.total}</strong><span>parcours ici</span></div>` : ''}
    </div>
    ${grand}
    ${[...parVillage.entries()].filter(([, cases]) => cases.length).map(([village, cases]) => `
      <p class="groupe-collection-parcours">${escapeAttr(village)}</p>
      <div class="grille-medailles-parcours">${cases.join('')}</div>
    `).join('')}
    ${badges.length ? '' : '<p style="font-size:12.5px;color:var(--roseau);margin:8px 0 0;">Terminez une chasse au trésor ou une balade pour commencer votre collection.</p>'}
  `;
}

function initCollectionParcours(zone, parcours, prenom) {
  zone.querySelectorAll('.case-medaille-parcours').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.classList.contains('verrou')) {
      ouvrirModaleFormulaire('Badge à découvrir', `<div class="fiche-badge-parcours">${svgMedaille({}, { verrou: true })}<p>Terminez « ${escapeAttr(btn.dataset.titre)} » pour gagner ce badge.</p></div>`);
      return;
    }
    const b = parcours.badges[btn.dataset.i];
    const overlay = ouvrirModaleFormulaire(`🏅 ${escapeAttr(b.nom)}`, `
      <div class="fiche-badge-parcours">
        ${svgMedaille(b)}
        <p>${b.parcours_titre ? `« ${escapeAttr(b.parcours_titre)} » · ` : ''}${escapeAttr(b.village_nom)}<br>Gagné le ${dateBadge(b)}${b.rang ? ` · ${rangBadge(b)}` : ''}${b.type === 'village' ? `<br>Niveau ${etoilesNiveau(b.niveau)}${b.ameliore_le ? ` · amélioré le ${dateBadge({ created_at: b.ameliore_le })}` : ''}` : ''}</p>
        ${b.phrase ? `<p><em>${escapeAttr(b.phrase)}</em></p>` : ''}
        <div class="actions-fiche-badge">
          <button type="button" class="btn-partager-fiche-badge">📤 Partager</button>
          <button type="button" class="btn-diplome-fiche-badge">🖨️ Mon diplôme</button>
        </div>
      </div>
    `);
    overlay.querySelector('.btn-partager-fiche-badge').addEventListener('click', () => partagerBadgeParcours(b));
    overlay.querySelector('.btn-diplome-fiche-badge').addEventListener('click', () => ouvrirDiplomeParcours(b, prenom));
  }));
}
