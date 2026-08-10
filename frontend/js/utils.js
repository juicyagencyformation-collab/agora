// frontend/js/utils.js
// Extrait le texte brut d'un contenu HTML — corrige les entités (&nbsp; etc.) que les
// simples regex .replace(/<[^>]+>/g, '') laissent affichées telles quelles.
function texteBrutDepuisHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normaliserTel(numero) {
  return numero.replace(/[\s.-]/g, '');
}

// Un champ "site web" dédié (contrairement au texte libre) doit rester cliquable même saisi
// sans protocole ("monasso.fr") — on ne peut pas compter sur la présence de "http(s)://"/"www."
// comme le fait segmenterTexteAvecLiens.
function normaliserSiteWeb(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// Détection auto de site web / email / téléphone dans du texte libre — utilisé partout où
// un citoyen ou la mairie saisit du texte (description, message, article...). Un seul passage
// avec alternation (plutôt que 3 regex séparées) pour que les segments restent dans l'ordre.
const REGEX_AUTO_LIEN = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|((?:\+33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4})/g;

function segmenterTexteAvecLiens(texteBrut) {
  const segments = [];
  let dernierIndex = 0;
  for (const m of texteBrut.matchAll(REGEX_AUTO_LIEN)) {
    if (m.index > dernierIndex) segments.push({ texte: texteBrut.slice(dernierIndex, m.index) });
    const [brutComplet, url, email, tel] = m;
    let brut = brutComplet;
    let reste = '';
    let href;
    if (url) {
      // Une URL en fin de phrase traîne souvent sa ponctuation (. , ) ...) — on la détache.
      const [, sansPonctuation, ponctuation] = brut.match(/^(.*?)([.,;:!?)\]}'"]*)$/s);
      brut = sansPonctuation;
      reste = ponctuation;
      href = /^www\./i.test(brut) ? `https://${brut}` : brut;
    } else if (email) {
      href = `mailto:${brut}`;
    } else if (tel) {
      href = `tel:${normaliserTel(brut)}`;
    }
    segments.push({ texte: brut, href });
    if (reste) segments.push({ texte: reste });
    dernierIndex = m.index + brutComplet.length;
  }
  if (dernierIndex < texteBrut.length) segments.push({ texte: texteBrut.slice(dernierIndex) });
  return segments;
}

// Texte brut (pas de HTML) → chaîne HTML échappée avec liens tel:/mailto:/https: cliquables.
function texteAvecLiensCliquables(texteBrut) {
  if (!texteBrut) return '';
  return segmenterTexteAvecLiens(texteBrut).map((seg) => {
    if (!seg.href) return escapeAttr(seg.texte);
    const nouvelOnglet = seg.href.startsWith('tel:') || seg.href.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener"';
    return `<a href="${escapeAttr(seg.href)}"${nouvelOnglet}>${escapeAttr(seg.texte)}</a>`;
  }).join('');
}

// Même détection pour du HTML riche (article, bulletin, compte-rendu...) : on marche sur les
// noeuds texte du DOM pour ne pas casser le HTML existant (gras, liens déjà posés...) et on
// ignore le texte déjà à l'intérieur d'un <a> pour ne jamais imbriquer deux liens.
function linkifierHtmlRiche(html) {
  if (!html) return html;
  const conteneur = document.createElement('div');
  conteneur.innerHTML = html;
  const walker = document.createTreeWalker(conteneur, NodeFilter.SHOW_TEXT, {
    acceptNode: (noeud) => (noeud.parentElement?.closest('a') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const noeudsTexte = [];
  let noeud;
  while ((noeud = walker.nextNode())) noeudsTexte.push(noeud);

  noeudsTexte.forEach((n) => {
    const segments = segmenterTexteAvecLiens(n.textContent);
    if (!segments.some((seg) => seg.href)) return;
    const fragment = document.createDocumentFragment();
    segments.forEach((seg) => {
      if (seg.href) {
        const a = document.createElement('a');
        a.href = seg.href;
        a.textContent = seg.texte;
        if (!seg.href.startsWith('tel:') && !seg.href.startsWith('mailto:')) {
          a.target = '_blank';
          a.rel = 'noopener';
        }
        fragment.appendChild(a);
      } else {
        fragment.appendChild(document.createTextNode(seg.texte));
      }
    });
    n.replaceWith(fragment);
  });

  return conteneur.innerHTML;
}

function ouvrirLightbox(url, filtreCss = '') {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<img src="${url}" class="lightbox-image" style="filter:${filtreCss};">`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// Composant sondage réutilisé par Actualités et Thermomètre : carte avec volet dépliable
// et options sous forme de barres cliquables (remplacement du radio/checkbox + jauge empilés).
const sondagesOuvertsMemoire = new Set();

function renderSondageJoli({ id, question, choix, totalVotes, mesVotes, multiChoix, onVoter }) {
  const wrap = document.createElement('div');
  wrap.className = 'carte-sondage-jolie';

  wrap.innerHTML = `
    <button type="button" class="sondage-entete">
      <span class="sondage-question-jolie">🗳️ ${escapeAttr(question)}</span>
      <span class="sondage-meta">${totalVotes} vote(s)${multiChoix ? ' · plusieurs réponses' : ''} <span class="chevron">▼</span></span>
    </button>
    <div class="sondage-options-volet"></div>
  `;

  const boutonEntete = wrap.querySelector('.sondage-entete');
  const zoneOptions = wrap.querySelector('.sondage-options-volet');

  function rendreOptions() {
    zoneOptions.innerHTML = '';
    choix.forEach((c) => {
      const pct = totalVotes ? Math.round((c.total / totalVotes) * 100) : 0;
      const choisi = mesVotes.includes(c.id);
      const barre = document.createElement('button');
      barre.type = 'button';
      barre.className = `option-sondage-barre ${choisi ? 'choisi' : ''}`;
      barre.innerHTML = `
        <div class="option-sondage-remplissage" style="width:${pct}%"></div>
        <span class="option-sondage-label">${choisi ? '✓ ' : ''}${escapeAttr(c.label)}</span>
        <span class="option-sondage-pct">${pct}%</span>
      `;
      barre.addEventListener('click', async () => {
        const nouveauxVotes = multiChoix
          ? (choisi ? mesVotes.filter((v) => v !== c.id) : [...mesVotes, c.id])
          : [c.id];
        if (!nouveauxVotes.length) return;
        sondagesOuvertsMemoire.add(id); // on vient d'interagir : rester ouvert au rechargement
        await onVoter(nouveauxVotes);
      });
      zoneOptions.appendChild(barre);
    });
  }
  rendreOptions();

  boutonEntete.addEventListener('click', () => {
    const ouvert = zoneOptions.classList.toggle('ouvert');
    boutonEntete.querySelector('.chevron').textContent = ouvert ? '▲' : '▼';
    if (ouvert) sondagesOuvertsMemoire.add(id); else sondagesOuvertsMemoire.delete(id);
  });

  // Ouvert par défaut : pas encore voté, OU déjà ouvert avant le dernier rechargement.
  if (!mesVotes.length || sondagesOuvertsMemoire.has(id)) {
    zoneOptions.classList.add('ouvert');
    boutonEntete.querySelector('.chevron').textContent = '▲';
  }

  return wrap;
}
// ── Célébration XP / badges ──
// Traite la réponse d'une action (xp_gagne, nouveaux_badges) et déclenche les animations.
function traiterRecompense(data) {
  if (!data) return;
  if (data.xp_gagne) afficherToastXp(data.xp_gagne);
  // La montée de niveau est le grand moment : on la joue en plein écran. Les éventuels badges
  // débloqués s'enchaînent après (leur file d'attente les affiche à la fermeture).
  if (data.monte_de_niveau) celebrerMonteeNiveau(data.niveau);
  if (data.nouveaux_badges && data.nouveaux_badges.length) {
    data.nouveaux_badges.forEach((cle) => mettreEnFileBadge(cle));
  }
}

function afficherToastXp(montant) {
  const toast = document.createElement('div');
  toast.className = 'toast-xp';
  toast.textContent = `+${montant} XP`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 1700);
}

let fileCelebrationsBadges = [];
let celebrationBadgeEnCours = false;

function mettreEnFileBadge(cleBadge) {
  fileCelebrationsBadges.push(cleBadge);
  traiterFileCelebrationsBadges();
}

function traiterFileCelebrationsBadges() {
  if (celebrationBadgeEnCours || !fileCelebrationsBadges.length) return;
  celebrationBadgeEnCours = true;
  const cle = fileCelebrationsBadges.shift();
  const badge = (typeof LABELS_BADGES !== 'undefined' && LABELS_BADGES[cle]) || { nom: cle, icone: '🏅', description: '' };

  const overlay = document.createElement('div');
  overlay.className = 'overlay-badge-debloque';
  overlay.innerHTML = `
    <div class="confettis"></div>
    <div class="carte-badge-debloque">
      <div class="icone-badge-geant">${badge.icone}</div>
      <div class="titre-badge-debloque">Badge débloqué !</div>
      <div class="nom-badge-debloque">${escapeAttr(badge.nom)}</div>
      <div class="description-badge-debloque">${escapeAttr(badge.description)}</div>
      <button class="btn-fermer-badge">Super !</button>
    </div>
  `;
  const couleurs = ['#2C5F6E', '#E2C97E', '#5C7A4E', '#C0392B'];
  const zoneConfettis = overlay.querySelector('.confettis');
  for (let i = 0; i < 26; i++) {
    const confetti = document.createElement('span');
    confetti.className = 'confetti';
    confetti.style.left = `${Math.random() * 100}%`;
    confetti.style.animationDelay = `${Math.random() * 0.4}s`;
    confetti.style.background = couleurs[i % couleurs.length];
    zoneConfettis.appendChild(confetti);
  }

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  overlay.querySelector('.btn-fermer-badge').addEventListener('click', () => {
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.remove();
      celebrationBadgeEnCours = false;
      traiterFileCelebrationsBadges();
    }, 300);
  });
}

// ── Célébration de montée de niveau : fusée qui décolle → explosion → feux d'artifice →
// le nouveau niveau qui jaillit, rayons dorés tournants et pluie de confettis. Full écran,
// pensé pour "en mettre plein la vue". Tout en CSS/JS vanilla, aucune dépendance. ──
function celebrerMonteeNiveau(niveau) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay-niveau';
  overlay.innerHTML = `
    <div class="etoiles-niveau"></div>
    <div class="fusee-niveau">🚀</div>
    <div class="onde-choc"></div>
    <div class="feux-niveau"></div>
    <div class="contenu-niveau">
      <div class="rayons-niveau"></div>
      <div class="cercle-niveau"><span class="chiffre-niveau">${niveau}</span></div>
      <div class="label-niveau">Niveau atteint</div>
      <div class="titre-niveau">NIVEAU ${niveau} !</div>
      <div class="sous-titre-niveau">Bravo, tu montes en grade 🎉</div>
      <button type="button" class="btn-fermer-niveau">Continuer</button>
    </div>
    <div class="confettis confettis-niveau"></div>
  `;
  document.body.appendChild(overlay);

  // Champ d'étoiles scintillantes en fond.
  const zoneEtoiles = overlay.querySelector('.etoiles-niveau');
  for (let i = 0; i < 34; i++) {
    const e = document.createElement('span');
    e.className = 'etoile';
    e.style.left = `${Math.random() * 100}%`;
    e.style.top = `${Math.random() * 100}%`;
    e.style.animationDelay = `${Math.random() * 2}s`;
    e.style.transform = `scale(${0.4 + Math.random()})`;
    zoneEtoiles.appendChild(e);
  }

  // Feux d'artifice : plusieurs explosions de particules, décalées dans le temps et l'espace,
  // déclenchées à l'instant où la fusée atteint le sommet.
  const couleurs = ['#E2C97E', '#2C5F6E', '#5C7A4E', '#C0392B', '#ffffff', '#4FA3B8'];
  const zoneFeux = overlay.querySelector('.feux-niveau');
  const lancerExplosion = (x, y, retardMs) => {
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('span');
      p.className = 'particule-feu';
      const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.3;
      const dist = 70 + Math.random() * 70;
      p.style.left = `${x}%`;
      p.style.top = `${y}%`;
      p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
      p.style.background = couleurs[Math.floor(Math.random() * couleurs.length)];
      p.style.animationDelay = `${retardMs}ms`;
      zoneFeux.appendChild(p);
    }
  };
  [[50, 34, 950], [28, 26, 1250], [72, 30, 1450], [40, 20, 1700], [62, 42, 1900]]
    .forEach(([x, y, t]) => lancerExplosion(x, y, t));

  // Pluie de confettis (réutilise .confetti / @keyframes chute-confetti déjà en place).
  const zoneConfettis = overlay.querySelector('.confettis-niveau');
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.style.left = `${Math.random() * 100}%`;
    c.style.animationDelay = `${1 + Math.random() * 1.2}s`;
    c.style.background = couleurs[i % couleurs.length];
    zoneConfettis.appendChild(c);
  }

  requestAnimationFrame(() => overlay.classList.add('visible'));

  const fermer = () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 350);
  };
  overlay.querySelector('.btn-fermer-niveau').addEventListener('click', fermer);
  // Sécurité : auto-fermeture au bout de 9s si l'utilisateur ne clique pas (ex. écran laissé de côté).
  setTimeout(() => { if (overlay.isConnected) fermer(); }, 9000);
}

// Réduit la charge R2/bande passante — utile notamment pour les photos prises au mobile.
function compresserImage(fichier, maxLargeur = 1600, qualite = 0.82) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxLargeur / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Compression échouée'))), 'image/jpeg', qualite);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    lecteur.onerror = reject;
    lecteur.readAsDataURL(fichier);
  });
}

// Scanner QR générique (caméra), réutilisé par Chasse au trésor et Participation citoyenne.
// Utilise l'API native BarcodeDetector quand disponible (Chrome/Android), sinon bascule sur
// jsQR (frontend/js/vendor/jsQR.min.js, vendoré en local — voir CLAUDE.md) : Safari/iOS
// n'a jamais implémenté BarcodeDetector, et taper un code à la main n'est pas une option
// acceptable pour un scan en public. Message de repli seulement si aucune des deux méthodes
// n'est disponible (prévoir une saisie manuelle côté appelant dans ce cas).
async function demarrerScannerQr(zoneElementId, onCodeDetecte) {
  if ('BarcodeDetector' in window) return demarrerScannerNatif(zoneElementId, onCodeDetecte);
  if (typeof jsQR === 'function') return demarrerScannerJsQr(zoneElementId, onCodeDetecte);
  afficherToastMessage('Scanner non supporté sur ce navigateur, utilise la saisie manuelle ci-dessous.', 'erreur');
}

async function demarrerScannerNatif(zoneElementId, onCodeDetecte) {
  const flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const video = document.createElement('video');
  video.srcObject = flux;
  video.autoplay = true;
  document.getElementById(zoneElementId).replaceChildren(video);

  const detecteur = new BarcodeDetector({ formats: ['qr_code'] });
  const intervalle = setInterval(async () => {
    try {
      const codes = await detecteur.detect(video);
      if (codes.length) {
        clearInterval(intervalle);
        flux.getTracks().forEach((t) => t.stop());
        await onCodeDetecte(codes[0].rawValue);
      }
    } catch { /* frame illisible, on continue */ }
  }, 500);
}

async function demarrerScannerJsQr(zoneElementId, onCodeDetecte) {
  const flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const video = document.createElement('video');
  video.srcObject = flux;
  video.autoplay = true;
  video.muted = true;
  video.setAttribute('playsinline', ''); // indispensable sur iOS, sinon la vidéo passe en plein écran natif
  document.getElementById(zoneElementId).replaceChildren(video);
  await video.play().catch(() => {});

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const intervalle = setInterval(() => {
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const resultat = jsQR(image.data, image.width, image.height);
    if (resultat) {
      clearInterval(intervalle);
      flux.getTracks().forEach((t) => t.stop());
      onCodeDetecte(resultat.data);
    }
  }, 300);
}

// ── Modal réutilisable pour tous les formulaires de création/édition ──
// Remonte en feuille depuis le bas sur mobile, centrée sur desktop.
function ouvrirModaleFormulaire(titre, contenuHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay-modale-formulaire';
  overlay.innerHTML = `
    <div class="carte-modale-formulaire">
      <div class="entete-modale-formulaire">
        <h3>${titre}</h3>
        <button type="button" class="btn-fermer-modale">✕</button>
      </div>
      <div class="corps-modale-formulaire">${contenuHtml}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // Clic sur le fond ou sur ✕ : si des champs ont été saisis, on confirme avant de fermer,
  // pour ne pas perdre le travail sur un clic à côté par erreur (fermeture libre si rien n'est
  // rempli). La fermeture après un envoi réussi passe par fermerModaleFormulaire() directement,
  // donc sans confirmation.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) demanderFermetureModale(overlay); });
  overlay.querySelector('.btn-fermer-modale').addEventListener('click', () => demanderFermetureModale(overlay));

  return overlay;
}

// Vrai si au moins un champ texte/zone de texte/fichier a été rempli (on ignore les <select>
// qui ont toujours une valeur par défaut, et les cases/radios, pour éviter les confirmations
// inutiles).
function modaleContientSaisie(overlay) {
  const champs = overlay.querySelectorAll(
    '.corps-modale-formulaire input:not([type=checkbox]):not([type=radio]):not([type=hidden]), .corps-modale-formulaire textarea',
  );
  return [...champs].some((c) => (c.type === 'file' ? c.files && c.files.length > 0 : c.value && c.value.trim() !== ''));
}

function demanderFermetureModale(overlay) {
  if (modaleContientSaisie(overlay) && !confirm('Abandonner les informations saisies ?')) return;
  fermerModaleFormulaire(overlay);
}

function fermerModaleFormulaire(overlay) {
  overlay.classList.remove('visible');
  setTimeout(() => overlay.remove(), 250);
}

// Toast de message générique (succès/erreur/info) — plus élégant qu'un alert() natif du navigateur.
function afficherToastMessage(texte, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  toast.textContent = texte;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 2600);
}
