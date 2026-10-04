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

  // Collage : sans ce traitement, le navigateur insère le HTML brut du presse-papier
  // (souvent très verbeux depuis Word/Google Docs) tel quel, que le sanitizer serveur
  // dépouille ensuite à l'aveugle — une liste à puces par exemple perd ses <li> sans qu'aucun
  // retour à la ligne ne les remplace, et se retrouve collée en un seul bloc illisible. On
  // nettoie donc nous-mêmes vers les seules balises que l'éditeur sait représenter.
  zone.addEventListener('paste', (e) => {
    e.preventDefault();
    const html = e.clipboardData?.getData('text/html');
    const texte = e.clipboardData?.getData('text/plain') ?? '';
    const htmlPropre = html ? nettoyerHtmlColle(html) : echapperTexte(texte).replace(/\r?\n/g, '<br>');
    document.execCommand('insertHTML', false, htmlPropre);
    sauverSelection();
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

function echapperTexte(texte) {
  return texte.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// Balises inline qu'un texte collé peut porter et que l'éditeur sait représenter.
const BALISES_INLINE_COLLAGE = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', s: 's', strike: 's' };
// Éléments de bloc (paragraphe, ligne de liste, titre, cellule...) : leur contenu devient une
// ligne à part — l'éditeur ne connaît que des retours à la ligne simples (<br>, voir le
// gestionnaire de la touche Entrée ci-dessus), jamais de <p> ni de <li> imbriqués.
const BALISES_BLOC_COLLAGE = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'blockquote']);

function nettoyerNoeudColle(noeud) {
  if (noeud.nodeType === Node.TEXT_NODE) return echapperTexte(noeud.textContent);
  if (noeud.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = noeud.tagName.toLowerCase();
  if (tag === 'style' || tag === 'script') return '';
  const enfants = Array.from(noeud.childNodes).map(nettoyerNoeudColle).join('');

  if (tag === 'br') return '<br>';

  if (tag === 'a') {
    const href = noeud.getAttribute('href') || '';
    return /^https?:\/\//i.test(href) ? `<a href="${href}">${enfants}</a>` : enfants;
  }

  let html = enfants;
  // Beaucoup d'éditeurs (Word, Google Docs) expriment gras/italique/souligné/couleur en
  // style inline plutôt qu'en balise sémantique — on les détecte dans les deux cas.
  if (tag in BALISES_INLINE_COLLAGE) html = `<${BALISES_INLINE_COLLAGE[tag]}>${html}</${BALISES_INLINE_COLLAGE[tag]}>`;
  if (/^(bold|[6-9]00)$/.test(noeud.style?.fontWeight || '')) html = `<b>${html}</b>`;
  if (noeud.style?.fontStyle === 'italic') html = `<i>${html}</i>`;
  const decoration = `${noeud.style?.textDecorationLine || ''} ${noeud.style?.textDecoration || ''}`;
  if (tag !== 'a' && /underline/.test(decoration)) html = `<u>${html}</u>`;
  if (/line-through/.test(decoration)) html = `<s>${html}</s>`;
  if (noeud.style?.color) html = `<span style="color:${noeud.style.color}">${html}</span>`;

  if (BALISES_BLOC_COLLAGE.has(tag) && html) html += '<br>';
  return html;
}

// Convertit le HTML du presse-papier vers les seules balises que l'éditeur représente,
// en remplaçant toute structure de bloc (paragraphes, listes, titres...) par des retours
// à la ligne simples plutôt que de la perdre silencieusement.
function nettoyerHtmlColle(html) {
  const conteneur = document.createElement('div');
  conteneur.innerHTML = html;
  const resultat = Array.from(conteneur.childNodes).map(nettoyerNoeudColle).join('');
  return resultat
    .replace(/(?:<br>\s*){3,}/gi, '<br><br>')
    .replace(/^(?:<br>\s*)+/i, '')
    .replace(/(?:<br>\s*)+$/i, '');
}
