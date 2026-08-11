// frontend/js/editeur-riche.js
// Éditeur riche minimal basé sur document.execCommand (API native, zéro dépendance).
// execCommand gère nativement la bascule (re-cliquer retire le format) et le curseur vide
// (activer puis taper). Sortie normalisée vers les seules balises autorisées par le
// sanitizer serveur (worker/src/lib/sanitize.ts) : b, i, u, s, span[style=color], a.
const BOUTONS_FORMAT = [
  { label: 'G', title: 'Gras', commande: 'bold', style: 'font-weight:700' },
  { label: 'I', title: 'Italique', commande: 'italic', style: 'font-style:italic' },
  { label: 'S', title: 'Souligné', commande: 'underline', style: 'text-decoration:underline' },
  { label: 'B', title: 'Barré', commande: 'strikeThrough', style: 'text-decoration:line-through' },
];

function creerEditeurRiche(conteneurId) {
  const conteneur = document.getElementById(conteneurId);
  conteneur.innerHTML = `
    <div class="toolbar-editeur"></div>
    <div class="zone-edition" contenteditable="true"></div>
  `;
  const toolbar = conteneur.querySelector('.toolbar-editeur');
  const zone = conteneur.querySelector('.zone-edition');

  // Sélection sauvegardée avant qu'un contrôle natif (color picker, prompt de lien) ne
  // vole le focus et n'efface la sélection — indispensable pour que ça marche sur mobile.
  let rangeSauvegardee = null;
  const sauverSelection = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && zone.contains(sel.anchorNode)) rangeSauvegardee = sel.getRangeAt(0).cloneRange();
  };
  const restaurerSelection = () => {
    if (!rangeSauvegardee) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(rangeSauvegardee);
  };
  zone.addEventListener('keyup', () => { sauverSelection(); majEtatsBoutons(); });
  zone.addEventListener('mouseup', () => { sauverSelection(); majEtatsBoutons(); });

  const boutonsFormat = BOUTONS_FORMAT.map(({ label, title, commande, style }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = title;
    btn.dataset.commande = commande;
    if (style) btn.setAttribute('style', style);
    // mousedown + preventDefault : le tap sur le bouton ne blur pas la zone → la
    // sélection est conservée (sinon elle disparaît sur mobile avant le clic).
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      zone.focus();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(commande, false);
      sauverSelection();
      majEtatsBoutons();
    });
    toolbar.appendChild(btn);
    return btn;
  });

  function majEtatsBoutons() {
    boutonsFormat.forEach((btn) => {
      let actif = false;
      try { actif = document.queryCommandState(btn.dataset.commande); } catch { /* non supporté */ }
      btn.classList.toggle('actif', actif);
    });
  }

  // MAJUSCULE : pas d'équivalent execCommand → enveloppe manuelle (text-transform,
  // autorisé sur span par le sanitizer).
  const btnMajuscule = document.createElement('button');
  btnMajuscule.type = 'button';
  btnMajuscule.textContent = 'MAJ';
  btnMajuscule.title = 'Majuscule';
  btnMajuscule.addEventListener('mousedown', (e) => {
    e.preventDefault();
    zone.focus();
    envelopperSelection(zone, 'span', 'text-transform:uppercase');
  });
  toolbar.appendChild(btnMajuscule);

  // Couleur : styleWithCSS(true) pour produire <span style="color:…"> (autorisé) plutôt
  // que <font color> (que execCommand génère par défaut et que le sanitizer supprime).
  const inputCouleur = document.createElement('input');
  inputCouleur.type = 'color';
  inputCouleur.title = 'Couleur du texte';
  inputCouleur.addEventListener('mousedown', sauverSelection);
  inputCouleur.addEventListener('change', () => {
    restaurerSelection();
    zone.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, inputCouleur.value);
    document.execCommand('styleWithCSS', false, false);
    sauverSelection();
  });
  toolbar.appendChild(inputCouleur);

  const btnLien = document.createElement('button');
  btnLien.type = 'button';
  btnLien.textContent = '🔗';
  btnLien.title = 'Lien';
  btnLien.addEventListener('mousedown', (e) => { e.preventDefault(); sauverSelection(); });
  btnLien.addEventListener('click', () => {
    const url = prompt('URL du lien (https://...)');
    if (!url || !/^https?:\/\//i.test(url)) return;
    restaurerSelection();
    zone.focus();
    document.execCommand('createLink', false, url);
    sauverSelection();
  });
  toolbar.appendChild(btnLien);

  // Entrée = saut de ligne simple (<br>) : évite les <div>/<p> que les navigateurs
  // insèrent par défaut et que le sanitizer supprimerait (perte des retours à la ligne).
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  });

  return {
    // Normalise les balises que certains navigateurs génèrent (<strong>/<em>/<strike>)
    // vers celles autorisées par le sanitizer serveur (<b>/<i>/<s>).
    getHtml: () => zone.innerHTML
      .replace(/<(\/?)strong>/gi, '<$1b>')
      .replace(/<(\/?)em>/gi, '<$1i>')
      .replace(/<(\/?)strike>/gi, '<$1s>'),
    setHtml: (html) => { zone.innerHTML = html; },
    clear: () => { zone.innerHTML = ''; },
  };
}

// Enveloppe la sélection courante dans une balise (utilisé pour MAJUSCULE, sans
// équivalent execCommand). Ne fait rien si aucune sélection réelle.
function envelopperSelection(zone, tagName, styleInline) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !zone.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0);
  const contenu = range.extractContents();
  const wrapper = document.createElement(tagName);
  if (styleInline) wrapper.setAttribute('style', styleInline);
  wrapper.appendChild(contenu);
  range.insertNode(wrapper);
  sel.removeAllRanges();
  zone.focus();
}
