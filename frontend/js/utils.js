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

// Scanner QR générique (caméra + BarcodeDetector), réutilisé par Chasse au trésor et
// Participation citoyenne. Affiche un message de repli si l'API n'est pas supportée
// (notamment Safari historiquement) — prévoir une saisie manuelle côté appelant.
async function demarrerScannerQr(zoneElementId, onCodeDetecte) {
  if (!('BarcodeDetector' in window)) {
    afficherToastMessage('Scanner non supporté sur ce navigateur, utilise la saisie manuelle ci-dessous.', 'erreur');
    return;
  }
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

  overlay.addEventListener('click', (e) => { if (e.target === overlay) fermerModaleFormulaire(overlay); });
  overlay.querySelector('.btn-fermer-modale').addEventListener('click', () => fermerModaleFormulaire(overlay));

  return overlay;
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
