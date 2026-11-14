// worker/src/lib/journal-gabarit.ts
// Journal papier — gabarit unique (aperçu dans l'appli ET PDF, même rendu garanti).
// Format validé par Léandre le 2026-11-14 : A4, pages dans l'ordre, un seul PDF, 3 colonnes.
//
// La page HTML contient les blocs du numéro « à plat » (#source) et un script qui les répartit
// dans des pages A4, après chargement des polices et des images, en MESURANT chaque bloc :
// - les rubriques se suivent dans les colonnes, comme dans un journal (pas de nouvelle page ni
//   de bandeau pleine largeur par rubrique, qui laisseraient deux colonnes vides à côté d'une
//   petite rubrique) ; un en-tête de rubrique n'est jamais laissé seul en bas de colonne ;
// - un paragraphe peut être coupé entre deux colonnes (jamais moins de 6 mots de chaque côté),
//   une photo ou un encart jamais ;
// - chaque série de colonnes est équilibrée (hauteur minimale qui contient tout) ;
// - les blancs qui restent sont MESURÉS et signalés (« places libres ») avec des propositions de
//   vrai contenu seulement — jamais d'image inventée, jamais de texte étiré : si rien ne
//   convient, l'outil le dit (exigence de Léandre).
// Le script pose document.body.dataset.pret = '1' quand la mise en page est finie (attendu par
// routes/journal.ts avant page.pdf()) et, en aperçu, envoie le résultat à l'appli (postMessage).

export interface ArticleJournal {
  id: string; surtitre: string; titre: string; paragraphes: string[];
  photo: string | null; photoGrande: boolean; sansPhotoChoisi: boolean;
}
export interface EvenementJournal { jour: string; num: string; mois: string; titre: string; detail: string }
export interface SondageJournal { question: string; participants: number; cloture: string; choix: { label: string; pct: number }[] }
export interface RubriqueJournal {
  cle: string; titre: string; couleur: string; picto: string;
  articles: ArticleJournal[]; evenements?: EvenementJournal[]; sondages?: SondageJournal[];
  encartsHtml?: string[]; // encarts déjà construits ET échappés côté serveur
}
export interface DonneesJournal {
  mode: 'apercu' | 'pdf';
  polices: string; // règles @font-face (données intégrées) ou chaîne vide
  titre: string; sousTitre: string; numero: number; saison: string; tirage: string;
  commune: { nom: string; departement: string; c1: string; c2: string; logoUrl: string | null; qrSvg: string };
  mairie: { horaires: string; permanences: string; telephone: string; email: string };
  couverture: { image: string | null; credit: string };
  edito: { paragraphes: string[]; signataire: string } | null;
  rubriques: RubriqueJournal[];
  opposition: { choix: 'aucun_bloc' | 'texte' | 'non_transmis' | 'aucun_elu'; liste: string; paragraphes: string[] };
  numerosUtilesInclus: boolean;
}

export const esc = (t: unknown) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const couleurSure = (c: string | null | undefined, defaut: string) => (/^#[0-9a-f]{6}$/i.test(String(c ?? '')) ? String(c) : defaut);
export { couleurSure };

const PICTOS: Record<string, string> = {
  plume: 'M4 20l4-1 11-11-3-3L5 16z M14 7l3 3',
  maison: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  assos: 'M8 11a3 3 0 100-6 3 3 0 000 6z M16 11a3 3 0 100-6 3 3 0 000 6z M3 19c0-3 2.5-5 5-5s5 2 5 5 M11 19c0-3 2.5-5 5-5s5 2 5 5',
  travaux: 'M12 3l6 17H6z M8.5 13h7 M4 20h16',
  mairie: 'M3 9l9-5 9 5 M5 10v8 M9.5 10v8 M14.5 10v8 M19 10v8 M3 20h18',
  feuille: 'M5 19c0-8 6-14 15-14 0 9-6 15-14 15 M5 19l7-7',
  calendrier: 'M6 5h12a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2z M4 10h16 M9 3v4 M15 3v4',
  info: 'M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17z M12 11v6 M12 7.5v.5',
  thermometre: 'M12 3.5a2 2 0 012 2v8.2a4 4 0 11-4 0V5.5a2 2 0 012-2z M12 11v5',
};
const picto = (cle: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PICTOS[cle] ?? PICTOS.info}"/></svg>`;

function enteteRubrique(titre: string, couleur: string, cle: string): string {
  return `<div class="b col rub keep" data-rubrique="${esc(titre)}" style="--r:${couleur}"><span class="picto">${picto(cle)}</span><h2>${esc(titre)}</h2></div>`;
}

function blocsArticle(a: ArticleJournal, couleur: string): string {
  const photo = a.photo
    ? `<figure class="photo${a.photoGrande ? ' grande' : ''}"><img src="${esc(a.photo)}" alt=""></figure>`
    : '';
  const tete = `<div class="b col tete keep" style="--r:${couleur}" data-article="${esc(a.id)}" data-titre="${esc(a.titre)}"`
    + ` data-sans-photo="${a.photo || a.sansPhotoChoisi ? '0' : '1'}" data-grande="${a.photoGrande ? '1' : '0'}">`
    + `${a.surtitre ? `<span class="surtitre">${esc(a.surtitre)}</span>` : ''}<h3>${esc(a.titre)}</h3>${photo}</div>`;
  return tete + a.paragraphes.map((p) => `<p class="b col para">${esc(p)}</p>`).join('');
}

function blocsRubrique(r: RubriqueJournal): string {
  const morceaux: string[] = [enteteRubrique(r.titre, r.couleur, r.picto)];
  r.articles.forEach((a) => morceaux.push(blocsArticle(a, r.couleur)));
  let moisCourant = '';
  (r.evenements ?? []).forEach((e) => {
    if (e.mois !== moisCourant) {
      moisCourant = e.mois;
      morceaux.push(`<div class="b col mois keep" style="--r:${r.couleur}">${esc(e.mois)}</div>`);
    }
    morceaux.push(`<div class="b col evt" style="--r:${r.couleur}"><div class="badge-date"><span class="jour">${esc(e.jour)}</span><span class="num">${esc(e.num)}</span></div>`
      + `<div><h4>${esc(e.titre)}</h4>${e.detail ? `<small>${esc(e.detail)}</small>` : ''}</div></div>`);
  });
  (r.sondages ?? []).forEach((s) => {
    morceaux.push(`<div class="b col encart" style="--r:${r.couleur}"><h4>${esc(s.question)}</h4>`
      + s.choix.map((ch) => `<div class="barre"><span>${esc(ch.label)}</span><i><em style="width:${Math.max(0, Math.min(100, ch.pct))}%"></em></i><span>${ch.pct} %</span></div>`).join('')
      + `<span class="note">${s.participants} participant${s.participants > 1 ? 's' : ''} · sondage clos le ${esc(s.cloture)}</span></div>`);
  });
  (r.encartsHtml ?? []).forEach((html) => morceaux.push(`<div class="b col encart" style="--r:${r.couleur}">${html}</div>`));
  return morceaux.join('');
}

function blocOpposition(o: DonneesJournal['opposition']): string {
  if (o.choix !== 'texte' && o.choix !== 'non_transmis') return '';
  const corps = o.choix === 'texte'
    ? `<div class="liste">${o.liste ? `Liste « ${esc(o.liste)} »` : ''}</div><div class="txt">${o.paragraphes.map((p) => `<p>${esc(p)}</p>`).join('')}</div>`
      + '<div class="resp">Texte publié sans modification, sous la seule responsabilité de ses auteurs.</div>'
    : '<div class="vide">Les élus de l\'opposition n\'ont pas transmis de texte pour ce numéro.</div>';
  return `<div class="b plein opposition"><h4>Expression des élus de l'opposition</h4>${corps}</div>`;
}

const BLASON_DEFAUT = (c1: string, c2: string) => `<svg viewBox="0 0 40 48" aria-hidden="true"><path d="M3 3h34v19c0 12-8 19-17 23C11 41 3 34 3 22z" fill="${c2}" stroke="#fff" stroke-width="2"/>`
  + `<path d="M3 24c5-3 9 3 14 0s9-3 14 0 6 2 6 2 M3 31c5-3 9 3 14 0s9-3 14 0" fill="none" stroke="${c1}" stroke-width="3"/></svg>`;

export function genererJournalHtml(d: DonneesJournal): string {
  const c1 = couleurSure(d.commune.c1, '#2C5F6E');
  const c2 = couleurSure(d.commune.c2, '#E2C97E');
  const logo = d.commune.logoUrl ? `<img class="logo" src="${esc(d.commune.logoUrl)}" alt="">` : BLASON_DEFAUT(c1, c2);
  const lignePied = `${d.titre} · N° ${d.numero} · ${d.saison}`;

  // Ordre : édito, rubriques, opposition juste après le Conseil (sinon à la fin), dos.
  const source: string[] = [];
  if (d.edito && d.edito.paragraphes.length) {
    source.push(enteteRubrique('Édito', c1, 'plume'));
    d.edito.paragraphes.forEach((p, i) => source.push(`<p class="b col para${i === 0 ? ' premier' : ''}" style="--r:${c1}">${esc(p)}</p>`));
    source.push(`<div class="b col signature" style="--r:${c1}">${esc(d.edito.signataire)}</div>`);
  }
  let oppositionPlacee = false;
  d.rubriques.forEach((r) => {
    source.push(blocsRubrique(r));
    if (r.cle === 'conseil') { source.push(blocOpposition(d.opposition)); oppositionPlacee = true; }
  });
  if (!oppositionPlacee) source.push(blocOpposition(d.opposition));

  const mairie = [
    d.mairie.horaires ? `<div>${esc(d.mairie.horaires).replace(/\n/g, '<br>')}</div>` : '',
    d.mairie.permanences ? `<div>${esc(d.mairie.permanences).replace(/\n/g, '<br>')}</div>` : '',
    [d.mairie.telephone, d.mairie.email].filter(Boolean).map(esc).join(' · '),
  ].filter(Boolean).join('');
  const dos = `<div id="dos" class="dos"><div><b>La mairie</b>${mairie ? `<div class="mairie">${mairie}</div>` : ''}`
    + `<div class="mentions"><b>${esc(d.titre)}</b>, bulletin municipal d'information de la commune de ${esc(d.commune.nom)}. `
    + `Directeur de la publication : le maire. Rédaction : la mairie. Impression : la mairie.${d.tirage ? ` Tirage : ${esc(d.tirage)}.` : ''} `
    + 'Dépôt légal : à parution. Ne pas jeter sur la voie publique. Édité avec Plateforme-Agora.</div></div>'
    + `<div class="qr-bloc"><div class="qr">${d.commune.qrSvg}</div>Toute l'actu du village dans l'appli</div></div>`;

  const couverture = `<section class="page couverture" id="couverture">
    <div class="bandeau">
      <div class="ligne-haut"><span>${esc(d.commune.nom)}${d.commune.departement ? ` · ${esc(d.commune.departement)}` : ''}</span><span>${esc(d.saison)} · N° ${d.numero}</span></div>
      <div class="titre-bloc"><div class="blason">${logo}</div><div><h1 class="titre-journal">${esc(d.titre)}</h1>${d.sousTitre ? `<p class="sous-titre">${esc(d.sousTitre)}</p>` : ''}</div></div>
      <svg class="vague" viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12 C40 2 80 20 120 11 S200 2 240 10 S290 16 300 8 V20 H0Z" fill="#fff"/></svg>
    </div>
    ${d.couverture.image
    ? `<figure class="photo-couv"><img id="img-couv" src="${esc(d.couverture.image)}" alt="">${d.couverture.credit ? `<span class="credit">Photo : ${esc(d.couverture.credit)}</span>` : ''}</figure>`
    : '<div class="photo-couv absente"></div>'}
    <div class="bas-couv"><div><div class="sommaire-titre">Dans ce numéro</div><ol class="sommaire" id="sommaire"></ol></div>
      <div class="qr-bloc"><div class="qr">${d.commune.qrSvg}</div>L'appli de la commune</div></div>
  </section>`;

  const config = JSON.stringify({ mode: d.mode, pied: lignePied, numerosUtiles: d.numerosUtilesInclus, couverture: !!d.couverture.image })
    .replace(/</g, '\\u003c');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(lignePied)}</title><style>${d.polices}${css(c1, c2)}</style></head>
<body class="mode-${d.mode}">
<div id="journal">${couverture}</div>
<div id="source">${source.join('')}${dos}</div>
<div id="mesure-col" class="mesure colonne"></div><div id="mesure-plein" class="mesure plein-largeur"></div>
<script type="application/json" id="config">${config}</script>
<script>${SCRIPT_PAGINATION}</script>
</body></html>`;
}

function css(c1: string, c2: string): string {
  return `
:root{--c1:${c1};--c2:${c2};--encre:#1F2A2E;--gris:#5F6B6F}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:210mm 297mm;margin:0}
html,body{margin:0;padding:0}
body{background:#fff;color:var(--encre);font-family:'Source Serif 4',Georgia,'Times New Roman',serif;font-size:10.5pt;line-height:1.45}
body.mode-apercu{background:#E9EEF0}
body.mode-apercu #journal{display:flex;flex-direction:column;align-items:center;gap:8mm;padding:6mm 0}
body.mode-apercu .page{box-shadow:0 2px 10px rgba(0,0,0,.18)}
#source{position:absolute;left:-10000px;top:0;width:186mm}
.mesure{position:absolute;left:-10000px;top:0;display:flow-root}
.colonne{width:58.666mm}.plein-largeur{width:186mm}
.page{position:relative;width:210mm;height:297mm;background:#fff;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.contenu{position:absolute;left:12mm;top:12mm;width:186mm;height:267mm}
.pied{position:absolute;left:12mm;right:12mm;bottom:8mm;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #D9DEE0;padding-top:1.5mm;font-family:'Source Sans 3',Arial,sans-serif;font-size:7.5pt;color:var(--gris)}
.pied b{font-size:10pt;color:var(--encre)}
.bande{display:grid;grid-template-columns:repeat(3,1fr);column-gap:5mm;margin-bottom:4mm;overflow:hidden}
.bande>div{min-width:0}
p{margin:0}
.para{margin:0 0 1.4mm}
.para.premier::first-letter{font-family:'Kaushan Script',cursive;float:left;font-size:3.1em;line-height:.9;color:var(--r);padding-right:.08em}
.rub{display:flex;align-items:center;gap:2mm;margin:1mm 0 3mm;padding-bottom:1.5mm;border-bottom:.6mm solid var(--r)}
.rub .picto{width:8mm;height:8mm;border-radius:50%;background:var(--r);display:grid;place-items:center;flex:none}
.rub .picto svg{width:58%;height:58%;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.rub h2{font-family:'Kaushan Script',cursive;font-weight:400;color:var(--r);font-size:17pt;line-height:1.1;margin:0}
.tete{padding-top:1mm;margin-bottom:1.2mm}
.surtitre{display:block;font-family:'Source Sans 3',Arial,sans-serif;font-variant:small-caps;letter-spacing:.05em;font-weight:700;color:var(--r);font-size:8pt;margin-bottom:.6mm}
.tete h3{font-family:'Source Sans 3',Arial,sans-serif;font-weight:700;font-size:13pt;line-height:1.18;margin:0 0 1.6mm}
.photo{margin:0 0 1.2mm;height:38mm;overflow:hidden;border-radius:.6mm;background:#EEF1F2}
.photo.grande{height:60mm}
.photo img{width:100%;height:100%;object-fit:cover;display:block}
.signature{font-family:'Kaushan Script',cursive;color:var(--r);font-size:13pt;text-align:right;margin:1mm 0 2mm}
.encart{background:color-mix(in srgb,var(--r) 7%,#fff);border:1px solid color-mix(in srgb,var(--r) 35%,#fff);border-radius:1.2mm;padding:3mm;margin:1mm 0 3mm;font-family:'Source Sans 3',Arial,sans-serif;font-size:9pt;line-height:1.4}
.encart h4{font-size:10.5pt;color:var(--r);margin:0 0 1.5mm;font-weight:700}
.encart ul{margin:0;padding-left:1.1em}
.encart .note{color:var(--gris);font-size:8pt}
.chiffres{display:flex;gap:3mm;margin:1mm 0 2mm}
.chiffres div{flex:1;text-align:center}
.chiffres b{display:block;font-size:17pt;color:var(--r);line-height:1.1}
.mois{font-family:'Source Sans 3',Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:8.5pt;color:var(--r);border-bottom:1px solid color-mix(in srgb,var(--r) 40%,#fff);padding:1mm 0 .8mm;margin:0 0 2mm}
.evt{display:grid;grid-template-columns:11mm 1fr;gap:3mm;align-items:start;margin:0 0 3mm}
.badge-date{border:1px solid var(--r);border-radius:1.2mm;text-align:center;font-family:'Source Sans 3',Arial,sans-serif;line-height:1.05;padding:.8mm 0}
.badge-date .jour{display:block;font-size:7pt;text-transform:uppercase;color:var(--r);font-weight:700;letter-spacing:.05em}
.badge-date .num{display:block;font-size:15pt;font-weight:700;color:var(--encre)}
.evt h4{font-family:'Source Sans 3',Arial,sans-serif;font-size:10pt;line-height:1.25;margin:0}
.evt small{font-family:'Source Sans 3',Arial,sans-serif;font-size:8pt;color:var(--gris);display:block}
.barre{display:grid;grid-template-columns:17mm 1fr 10mm;gap:2mm;align-items:center;margin-bottom:1.4mm}
.barre i{display:block;height:3mm;background:color-mix(in srgb,var(--r) 14%,#fff);border-radius:9px;overflow:hidden}
.barre i em{display:block;height:100%;background:var(--r);border-radius:9px}
.barre span:last-child{text-align:right;font-weight:700}
.opposition{height:50mm;overflow:hidden;border:1px solid #9AA4A7;border-radius:1.2mm;padding:3mm;margin:0 0 4mm;font-family:'Source Sans 3',Arial,sans-serif;font-size:8.5pt;line-height:1.4;display:flex;flex-direction:column}
.opposition h4{font-size:10pt;margin:0 0 .5mm}
.opposition .liste{font-size:7.5pt;color:var(--gris);margin-bottom:1.5mm}
.opposition .txt{column-count:3;column-gap:4mm;flex:1;font-family:'Source Serif 4',Georgia,serif}
.opposition .txt p{margin:0 0 .4em}
.opposition .vide{flex:1;display:grid;place-items:center;text-align:center;font-style:italic;color:var(--gris);font-size:9pt}
.opposition .resp{font-size:7.5pt;color:var(--gris);margin-top:1mm}
.dos{display:grid;grid-template-columns:1fr 26mm;gap:6mm;align-items:end;border-top:.6mm solid var(--c1);padding-top:3mm;font-family:'Source Sans 3',Arial,sans-serif;font-size:9pt}
.dos .mairie{margin-top:1mm}
.mentions{margin-top:2mm;font-size:7.5pt;color:var(--gris);line-height:1.4}
.mentions b{color:var(--encre)}
.qr-bloc{text-align:center;font-family:'Source Sans 3',Arial,sans-serif;font-size:7.5pt;color:var(--gris)}
.qr svg{width:100%;height:auto;display:block}
.dos .qr{width:22mm;margin:0 auto 1mm}
/* Couverture */
.couverture .bandeau{background:var(--c1);color:#fff;position:relative;padding:7mm 12mm 13mm}
.ligne-haut{display:flex;justify-content:space-between;font-family:'Source Sans 3',Arial,sans-serif;font-size:8.5pt;letter-spacing:.12em;text-transform:uppercase;font-weight:600;border-bottom:1px solid rgba(255,255,255,.35);padding-bottom:1.5mm}
.titre-bloc{display:flex;align-items:center;gap:6mm;margin-top:6mm}
.blason{width:28mm;height:34mm;flex:none;display:grid;place-items:center}
.blason svg,.blason .logo{max-width:100%;max-height:100%;object-fit:contain}
.titre-journal{font-family:'Kaushan Script',cursive;font-weight:400;color:var(--c2);font-size:40pt;line-height:1.05;margin:0}
.sous-titre{font-family:'Source Sans 3',Arial,sans-serif;font-size:11pt;margin:3mm 0 0}
.vague{position:absolute;left:0;right:0;bottom:-1px;width:100%;height:9mm;display:block}
.photo-couv{height:122mm;margin:0;position:relative;overflow:hidden}
.photo-couv img{width:100%;height:100%;object-fit:cover;display:block}
.photo-couv.absente{height:40mm}
.credit{position:absolute;right:3mm;bottom:2mm;font-family:'Source Sans 3',Arial,sans-serif;font-size:7pt;color:#fff;text-shadow:0 0 3px rgba(0,0,0,.6)}
.bas-couv{display:grid;grid-template-columns:1fr 32mm;gap:10mm;padding:6mm 12mm 0}
.sommaire-titre{font-family:'Source Sans 3',Arial,sans-serif;font-weight:700;font-size:9.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--c1);margin-bottom:1.5mm}
.sommaire{list-style:none;margin:0;padding:0;font-family:'Source Sans 3',Arial,sans-serif;font-size:11pt;line-height:1.55;column-count:2;column-gap:8mm}
.sommaire li{display:flex;align-items:baseline;gap:1mm;break-inside:avoid}
.sommaire .pts{flex:1;border-bottom:1px dotted #8A979B;transform:translateY(-.25em)}
.sommaire b{color:var(--c1)}
.bas-couv .qr{width:28mm;margin:0 auto 1mm}
@media print{body.mode-apercu{background:#fff}}
`;
}

// Script exécuté DANS la page (aperçu et PDF). Pas de gabarits `...` ici : chaîne TypeScript.
const SCRIPT_PAGINATION = String.raw`
(function () {
  var CONFIG = JSON.parse(document.getElementById('config').textContent);
  var MM = 96 / 25.4;
  var H = 267 * MM, GAPV = 4 * MM;
  var journal = document.getElementById('journal');
  var mesureCol = document.getElementById('mesure-col');
  var mesurePlein = document.getElementById('mesure-plein');
  var dosEl = document.getElementById('dos');
  var cache = {};
  var pages = [], page = null, y = 0, numero = 1;
  var places = [], alertes = [], sommaire = [];

  function attendreImages() {
    var imgs = Array.prototype.slice.call(document.images);
    return Promise.race([
      Promise.all(imgs.map(function (img) {
        return img.complete ? null : new Promise(function (ok) { img.onload = img.onerror = ok; });
      })),
      new Promise(function (ok) { setTimeout(ok, 12000); }),
    ]);
  }

  var atomes = Array.prototype.slice.call(document.querySelectorAll('#source > .b')).map(function (el, i) {
    var a = { el: el, i: i, plein: el.classList.contains('plein'), para: el.classList.contains('para'), keep: el.classList.contains('keep'), debut: 0, fin: 0, mots: null };
    if (a.para) { a.mots = el.textContent.split(/\s+/).filter(Boolean); a.fin = a.mots.length; }
    return a;
  });
  function copie(a, debut, fin) { return { el: a.el, i: a.i, plein: a.plein, para: a.para, keep: a.keep, mots: a.mots, debut: debut, fin: fin }; }

  function rendu(a) {
    var c = a.el.cloneNode(true);
    if (a.para) {
      c.textContent = a.mots.slice(a.debut, a.fin).join(' ');
      if (a.debut > 0) c.classList.remove('premier');
    }
    return c;
  }
  function h(a) {
    var cle = a.i + ':' + a.debut + ':' + a.fin;
    if (cache[cle] === undefined) {
      var boite = a.plein ? mesurePlein : mesureCol;
      boite.innerHTML = '';
      boite.appendChild(rendu(a));
      cache[cle] = boite.getBoundingClientRect().height;
      boite.innerHTML = '';
    }
    return cache[cle];
  }
  // Coupe un paragraphe pour remplir « place » : jamais moins de 6 mots de chaque côté.
  function couper(a, place) {
    var lo = 6, hi = a.fin - a.debut - 6, meilleur = 0;
    while (lo <= hi) {
      var m = (lo + hi) >> 1;
      if (h(copie(a, a.debut, a.debut + m)) <= place) { meilleur = m; lo = m + 1; } else hi = m - 1;
    }
    if (!meilleur) return null;
    return [copie(a, a.debut, a.debut + meilleur), copie(a, a.debut + meilleur, a.fin)];
  }

  // Place à garder sous un bloc « à ne pas laisser seul » (en-tête de rubrique, de mois, titre
  // d'article) : tous les blocs de ce genre qui le suivent, plus le début du premier vrai contenu.
  function suiteObligatoire(q) {
    var total = 0, k = 1;
    while (q[k] && q[k].keep) { total += h(q[k]); k++; }
    return q[k] ? total + Math.min(h(q[k]), 14 * MM) : total;
  }

  function remplir(file, haut) {
    var cols = [[], [], []], hauts = [0, 0, 0], q = file.slice();
    for (var c = 0; c < 3 && q.length; c++) {
      var place = haut;
      while (q.length) {
        var a = q[0], ha = h(a), vide = cols[c].length === 0;
        var suite = (a.keep && !vide) ? suiteObligatoire(q) : 0;
        if (ha + suite <= place) { cols[c].push(a); place -= ha; hauts[c] += ha; q.shift(); continue; }
        if (a.para && place > 12 * MM) {
          var parts = couper(a, place);
          if (parts) { cols[c].push(parts[0]); hauts[c] += h(parts[0]); q[0] = parts[1]; }
        } else if (vide && !a.para && ha > haut && haut >= H - 1) {
          // Bloc plus haut qu'une colonne entière : posé quand même (signalé), sinon boucle sans fin.
          cols[c].push(a); hauts[c] += ha; q.shift();
        }
        break;
      }
    }
    return { cols: cols, hauts: hauts, reste: q };
  }

  function nouvellePage() {
    if (page) noterBasDePage();
    numero++;
    var s = document.createElement('section');
    s.className = 'page';
    s.innerHTML = '<div class="contenu"></div><div class="pied"><span></span><b></b></div>';
    s.querySelector('.pied span').textContent = CONFIG.pied;
    s.querySelector('.pied b').textContent = String(numero);
    journal.appendChild(s);
    page = { el: s, contenu: s.querySelector('.contenu'), numero: numero };
    pages.push(page);
    y = 0;
  }
  function noterBasDePage() {
    var libre = H - y;
    if (libre > 20 * MM) places.push({ page: page.numero, hauteur_mm: Math.round(libre / MM), ou: 'bas' });
  }
  function poserPlein(a) {
    page.contenu.appendChild(rendu(a));
    y += h(a);
  }
  function poserBande(r, haut) {
    var bande = document.createElement('div');
    bande.className = 'bande';
    bande.style.height = haut + 'px';
    r.cols.forEach(function (col, ci) {
      var d = document.createElement('div');
      col.forEach(function (a) {
        var el = rendu(a);
        if (el.classList.contains('rub')) sommaire.push({ titre: el.dataset.rubrique, page: page.numero });
        d.appendChild(el);
      });
      bande.appendChild(d);
      var libre = haut - r.hauts[ci];
      if (libre > 25 * MM) places.push({ page: page.numero, hauteur_mm: Math.round(libre / MM), ou: 'colonne', colonne: ci + 1 });
    });
    page.contenu.appendChild(bande);
    y += haut + GAPV;
  }
  function placerSerie(file) {
    var garde = 0;
    while (file.length && garde++ < 200) {
      var dispo = H - y;
      if (dispo < 25 * MM) { nouvellePage(); continue; }
      var r = remplir(file, dispo);
      var poses = r.cols[0].length + r.cols[1].length + r.cols[2].length;
      if (!r.reste.length) {
        var lo = 0, hi = dispo, meilleur = r;
        for (var k = 0; k < 16; k++) {
          var mid = (lo + hi) / 2, t = remplir(file, mid);
          if (!t.reste.length) { meilleur = t; hi = mid; } else lo = mid;
        }
        poserBande(meilleur, Math.max(meilleur.hauts[0], meilleur.hauts[1], meilleur.hauts[2]));
        file = [];
      } else if (!poses && y > 0) {
        nouvellePage();
      } else {
        poserBande(r, dispo);
        file = r.reste;
        nouvellePage();
      }
    }
  }

  function paginer() {
    nouvellePage();
    var i = 0;
    while (i < atomes.length) {
      var a = atomes[i];
      if (a.plein) {
        if (y > 0 && y + h(a) > H) nouvellePage();
        poserPlein(a);
        i++;
      } else {
        var file = [];
        while (i < atomes.length && !atomes[i].plein) file.push(atomes[i++]);
        placerSerie(file);
      }
    }
    // Dos (mairie, mentions, QR) : calé en bas de la dernière page.
    mesurePlein.innerHTML = ''; var cloneDos = dosEl.cloneNode(true); cloneDos.removeAttribute('id'); mesurePlein.appendChild(cloneDos);
    var hDos = mesurePlein.getBoundingClientRect().height; mesurePlein.innerHTML = '';
    if (H - y < hDos + 4 * MM) nouvellePage();
    dosEl.style.position = 'absolute'; dosEl.style.left = '0'; dosEl.style.right = '0'; dosEl.style.bottom = '0';
    page.contenu.appendChild(dosEl);
    y += hDos;
    noterBasDePage();
  }

  // Résolution effective d'une photo à sa taille d'impression (recadrage « cover »).
  function ppp(img) {
    var r = img.getBoundingClientRect();
    if (!img.naturalWidth || !r.width) return null;
    var echelle = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight); // px écran par px image
    return Math.round(96 / echelle);
  }
  function ppGrande(img) {
    var w = 58.666 * MM, hh = 60 * MM;
    if (!img.naturalWidth) return null;
    return Math.round(96 / Math.max(w / img.naturalWidth, hh / img.naturalHeight));
  }

  function analyser() {
    var tetes = Array.prototype.slice.call(journal.querySelectorAll('.tete[data-article]'));
    tetes.forEach(function (t) {
      var img = t.querySelector('img');
      if (img) {
        var r = ppp(img);
        if (r !== null && r < 150) alertes.push({ type: 'photo_floue', id: t.dataset.article, titre: t.dataset.titre, ppp: r, page: pageDe(t) });
      }
    });
    var couv = document.getElementById('img-couv');
    if (couv) { var rc = ppp(couv); if (rc !== null && rc < 150) alertes.push({ type: 'couverture_floue', ppp: rc }); }
    if (!CONFIG.couverture) alertes.push({ type: 'sans_couverture' });
    atomes.forEach(function (a) {
      if (!a.para && h(a) > (a.plein ? H : H - 1)) alertes.push({ type: 'bloc_trop_grand', titre: (a.el.dataset.titre || a.el.textContent).slice(0, 60) });
    });
    if ((pages.length + 1) % 2 === 1) alertes.push({ type: 'pages_impaires', pages: pages.length + 1 });

    places.forEach(function (pl) {
      var props = [];
      tetes.filter(function (t) { return pageDe(t) === pl.page; }).forEach(function (t) {
        var img = t.querySelector('img');
        if (t.dataset.sansPhoto === '1' && pl.hauteur_mm >= 35) props.push({ action: 'photo', id: t.dataset.article, titre: t.dataset.titre });
        if (img && t.dataset.grande !== '1' && pl.hauteur_mm >= 20) {
          var g = ppGrande(img);
          if (g !== null && g >= 150) props.push({ action: 'agrandir', id: t.dataset.article, titre: t.dataset.titre });
        }
      });
      if (!CONFIG.numerosUtiles && pl.hauteur_mm >= 45) props.push({ action: 'numeros_utiles' });
      pl.propositions = props;
    });
  }
  function pageDe(el) {
    var p = el.closest('.page');
    for (var k = 0; k < pages.length; k++) if (pages[k].el === p) return pages[k].numero;
    return 1;
  }

  function remplirSommaire() {
    var vus = {};
    var ol = document.getElementById('sommaire');
    sommaire.forEach(function (s) {
      if (vus[s.titre]) return; vus[s.titre] = true;
      var li = document.createElement('li');
      li.innerHTML = '<span></span><span class="pts"></span><b></b>';
      li.firstChild.textContent = s.titre;
      li.lastChild.textContent = String(s.page);
      ol.appendChild(li);
    });
  }

  (document.fonts ? document.fonts.ready : Promise.resolve()).then(attendreImages).then(function () {
    try {
      paginer();
      remplirSommaire();
      analyser();
    } catch (e) {
      alertes.push({ type: 'erreur', message: String(e && e.message || e) });
    }
    document.getElementById('source').remove();
    mesureCol.remove(); mesurePlein.remove();
    var resultat = { pages: pages.length + 1, places: places, alertes: alertes };
    window.__journal = resultat;
    document.body.dataset.pret = '1';
    if (CONFIG.mode === 'apercu') {
      var zoom = Math.min(1, (window.innerWidth - 12) / (210 * MM));
      document.body.style.zoom = String(zoom);
      try { parent.postMessage({ journal: resultat }, '*'); } catch (e) {}
    }
  });
})();
`;
