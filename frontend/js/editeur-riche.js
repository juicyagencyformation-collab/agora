// frontend/js/editeur-riche.js
const BOUTONS_FORMAT = [
  { label: 'G', title: 'Gras', tag: 'b' },
  { label: 'I', title: 'Italique', tag: 'i' },
  { label: 'S', title: 'Souligné', tag: 'u' },
  { label: 'B', title: 'Barré', tag: 's' },
];

function creerEditeurRiche(conteneurId) {
  const conteneur = document.getElementById(conteneurId);
  conteneur.innerHTML = `
    <div class="toolbar-editeur"></div>
    <div class="zone-edition" contenteditable="true"></div>
  `;
  const toolbar = conteneur.querySelector('.toolbar-editeur');
  const zone = conteneur.querySelector('.zone-edition');

  BOUTONS_FORMAT.forEach(({ label, title, tag }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', () => appliquerFormat(zone, tag));
    toolbar.appendChild(btn);
  });

  const btnMajuscule = document.createElement('button');
  btnMajuscule.type = 'button';
  btnMajuscule.textContent = 'MAJ';
  btnMajuscule.title = 'Majuscule';
  btnMajuscule.addEventListener('click', () => appliquerFormat(zone, 'span', 'text-transform:uppercase'));
  toolbar.appendChild(btnMajuscule);

  const inputCouleur = document.createElement('input');
  inputCouleur.type = 'color';
  inputCouleur.title = 'Couleur du texte';
  inputCouleur.addEventListener('change', () => {
    appliquerFormat(zone, 'span', `color:${inputCouleur.value}`);
  });
  toolbar.appendChild(inputCouleur);

  const btnLien = document.createElement('button');
  btnLien.type = 'button';
  btnLien.textContent = '🔗';
  btnLien.title = 'Lien';
  btnLien.addEventListener('click', () => {
    const url = prompt('URL du lien (https://...)');
    if (url && /^https?:\/\//i.test(url)) appliquerLien(zone, url);
  });
  toolbar.appendChild(btnLien);

  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      insererBr(zone);
    }
  });

  return {
    getHtml: () => zone.innerHTML,
    setHtml: (html) => { zone.innerHTML = html; },
    clear: () => { zone.innerHTML = ''; },
  };
}

function appliquerFormat(zone, tagName, styleInline) {
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

function appliquerLien(zone, url) {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed || !zone.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0);
  const contenu = range.extractContents();
  const a = document.createElement('a');
  a.href = url;
  a.appendChild(contenu);
  range.insertNode(a);
  sel.removeAllRanges();
  zone.focus();
}

function insererBr(zone) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createElement('br'));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}
