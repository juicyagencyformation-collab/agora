// frontend/js/journal.js
// Journal papier — MODE ESSAI (2026-11-14), onglet visible du seul superadmin (navigation.js).
// Rien n'est enregistré : ni en base, ni dans R2. Aucun article n'est marqué « déjà paru », on
// peut refaire le même numéro autant de fois qu'on veut. Seuls quelques réglages (titre,
// numéro, tirage, signataire) sont gardés dans ce navigateur pour ne pas les retaper.
// Trois écrans : couverture et édito → contenus → aperçu et PDF. La mise en page est faite par
// le Worker (worker/src/lib/journal-gabarit.ts), même gabarit pour l'aperçu et le PDF.

const JR = {
  etape: 'couverture',
  reglages: null,
  couverture: null, // { image, credit, largeur }
  edito: { texte: '', signataire: 'Le maire' },
  opposition: { choix: 'aucun_bloc', liste: '', texte: '' },
  contenus: null,
  cleContenus: '',
  articles: new Map(), // id -> { inclus, titre?, texte?, photo?, sans_photo, photo_grande }
  ordre: {}, // cle de rubrique -> [ids]
  evenements: new Set(),
  sondages: new Set(),
  encarts: { signalements: true, dechets: true, numeros_utiles: false },
  initialise: false,
};

const jrEsc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const jrJour = (d) => d.toISOString().slice(0, 10);
function jrDecaler(jour, mois) { const d = new Date(`${jour}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + mois); return jrJour(d); }
function jrSaison(jour) {
  const d = new Date(`${jour}T12:00:00Z`); const m = d.getUTCMonth();
  const nom = m === 11 || m <= 1 ? 'Hiver' : m <= 4 ? 'Printemps' : m <= 7 ? 'Été' : 'Automne';
  return `${nom} ${d.getUTCFullYear()}`;
}
const JR_CLE_STOCKAGE = () => `agora_journal_essai_${window.COMMUNE_SLUG}`;
function jrSauverReglages() {
  try {
    const { titre, sous_titre, numero, tirage } = JR.reglages;
    localStorage.setItem(JR_CLE_STOCKAGE(), JSON.stringify({ titre, sous_titre, numero, tirage, signataire: JR.edito.signataire }));
  } catch {}
}

async function chargerJournal() {
  const ecran = document.getElementById('journal-ecran');
  if (!ecran) return;
  if (!JR.initialise) {
    const aujourdhui = jrJour(new Date());
    let memo = {};
    try { memo = JSON.parse(localStorage.getItem(JR_CLE_STOCKAGE()) || '{}'); } catch {}
    JR.reglages = {
      titre: memo.titre || '', sous_titre: memo.sous_titre || '', numero: memo.numero || 1, tirage: memo.tirage || '',
      distribution: aujourdhui, debut: jrDecaler(aujourdhui, -3), fin: aujourdhui, agenda_fin: jrDecaler(aujourdhui, 3),
      saison: jrSaison(aujourdhui),
    };
    if (memo.signataire) JR.edito.signataire = memo.signataire;
    document.querySelectorAll('#journal-etapes [data-etape]').forEach((b) => b.addEventListener('click', () => jrAller(b.dataset.etape)));
    window.addEventListener('message', jrRecevoirApercu);
    JR.initialise = true;
    ecran.innerHTML = '<p class="dechets-vide">Chargement des contenus…</p>';
    const ok = await jrChargerContenus();
    if (!ok) return;
    if (!JR.reglages.titre) JR.reglages.titre = `Le journal de ${JR.contenus.commune.nom}`;
    if ((JR.contenus.commune.population ?? 0) >= 1000) JR.opposition.choix = 'texte';
  }
  jrAller(JR.etape);
}

function jrCleContenus() { const r = JR.reglages; return [r.debut, r.fin, r.distribution, r.agenda_fin].join('|'); }

async function jrChargerContenus() {
  const r = JR.reglages;
  const url = new URL(`${window.API_BASE}/${window.COMMUNE_SLUG}/journal/contenus`, window.location.origin);
  url.searchParams.set('debut', r.debut); url.searchParams.set('fin', r.fin);
  url.searchParams.set('agenda_debut', r.distribution); url.searchParams.set('agenda_fin', r.agenda_fin);
  const res = await appelApi(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    document.getElementById('journal-ecran').innerHTML = `<p class="dechets-vide">${jrEsc(typeof data.erreur === 'string' ? data.erreur : 'Impossible de charger les contenus.')}</p>`;
    return false;
  }
  const premiereFois = !JR.contenus;
  JR.contenus = await res.json();
  JR.cleContenus = jrCleContenus();
  // Tout est coché par défaut ; les choix déjà faits sur un contenu restent.
  JR.contenus.rubriques.forEach((rub) => {
    const ids = rub.articles.map((a) => a.id);
    const anciens = (JR.ordre[rub.cle] || []).filter((id) => ids.includes(id));
    JR.ordre[rub.cle] = [...anciens, ...ids.filter((id) => !anciens.includes(id))];
    ids.forEach((id) => { if (!JR.articles.has(id)) JR.articles.set(id, { inclus: true, sans_photo: false, photo_grande: false }); });
  });
  if (premiereFois) {
    JR.contenus.evenements.forEach((e) => JR.evenements.add(e.id));
    JR.contenus.sondages.forEach((s) => JR.sondages.add(s.id));
  }
  return true;
}

async function jrAller(etape) {
  JR.etape = etape;
  document.querySelectorAll('#journal-etapes [data-etape]').forEach((b) => b.classList.toggle('actif', b.dataset.etape === etape));
  const ecran = document.getElementById('journal-ecran');
  if (etape !== 'couverture' && JR.cleContenus !== jrCleContenus()) {
    ecran.innerHTML = '<p class="dechets-vide">Chargement des contenus…</p>';
    if (!(await jrChargerContenus())) return;
  }
  if (etape === 'couverture') jrEcranCouverture(ecran);
  if (etape === 'contenus') jrEcranContenus(ecran);
  if (etape === 'apercu') jrEcranApercu(ecran);
  ecran.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// Réduit une image dans le navigateur (JPEG) : rien n'est envoyé à R2, l'image part avec la demande.
function jrReduireImage(fichier, largeurMax) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = () => {
      const echelle = Math.min(1, largeurMax / img.naturalWidth);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * echelle);
      canvas.height = Math.round(img.naturalHeight * echelle);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      ok({ image: canvas.toDataURL('image/jpeg', 0.85), largeur: img.naturalWidth });
    };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Image illisible')); };
    img.src = url;
  });
}
function jrChoisirFichier(callback) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
  input.addEventListener('change', () => { if (input.files[0]) callback(input.files[0]); });
  input.click();
}

// ── Écran 1 : couverture et édito ──
function jrEcranCouverture(ecran) {
  const r = JR.reglages;
  const pop = JR.contenus?.commune.population ?? 0;
  const msgCouv = !JR.couverture ? '<p class="jr-msg info">Aucune photo pour l\'instant. Choisissez une belle photo du village, en largeur.</p>'
    : JR.couverture.largeur >= 2500 ? `<p class="jr-msg ok">✓ ${JR.couverture.largeur} px de large : parfait pour l'A4.</p>`
      : JR.couverture.largeur >= 1700 ? `<p class="jr-msg ok">${JR.couverture.largeur} px de large : correct pour l'A4.</p>`
        : `<p class="jr-msg alerte">⚠️ ${JR.couverture.largeur} px de large : la photo sera floue en couverture. Il en faudrait 1 700 au minimum, 2 500 idéalement.</p>`;
  const choixOpp = [
    ['texte', 'Nous avons reçu leur texte'], ['non_transmis', 'L\'opposition n\'a pas transmis de texte'], ['aucun_elu', 'Aucun élu d\'opposition au conseil'],
  ];
  ecran.innerHTML = `
    <details class="jr-volet" open><summary>⚙️ Réglages du numéro</summary><div class="jr-corps">
      <label class="jr-champ">Titre du journal<input id="jr-titre" maxlength="80" value="${jrEsc(r.titre)}"></label>
      <label class="jr-champ">Sous-titre (facultatif)<input id="jr-sous-titre" maxlength="120" value="${jrEsc(r.sous_titre)}"></label>
      <div class="jr-ligne">
        <label class="jr-champ">Numéro<input id="jr-numero" type="number" min="1" max="999" value="${jrEsc(r.numero)}"></label>
        <label class="jr-champ">Saison<input id="jr-saison" maxlength="40" value="${jrEsc(r.saison)}"></label>
      </div>
      <div class="jr-ligne">
        <label class="jr-champ">Contenus publiés du<input id="jr-debut" type="date" value="${r.debut}"></label>
        <label class="jr-champ">au<input id="jr-fin" type="date" value="${r.fin}"></label>
      </div>
      <div class="jr-ligne">
        <label class="jr-champ">Distribution prévue le<input id="jr-distribution" type="date" value="${r.distribution}"></label>
        <label class="jr-champ">Agenda jusqu'au<input id="jr-agenda-fin" type="date" value="${r.agenda_fin}"></label>
      </div>
      <label class="jr-champ">Tirage (facultatif)<input id="jr-tirage" maxlength="40" placeholder="ex. 250 exemplaires" value="${jrEsc(r.tirage)}"></label>
    </div></details>
    <details class="jr-volet" open><summary>📷 Photo de couverture</summary><div class="jr-corps">
      ${JR.couverture ? `<img class="jr-apercu-couv" src="${JR.couverture.image}" alt="">` : ''}
      ${msgCouv}
      <button type="button" class="jr-btn second" id="jr-btn-couv">${JR.couverture ? 'Changer de photo' : 'Choisir une photo'}</button>
      ${JR.couverture ? '<button type="button" class="jr-btn second" id="jr-btn-couv-retirer">Retirer la photo</button>' : ''}
      <label class="jr-champ">Crédit photo<input id="jr-credit" maxlength="80" placeholder="ex. Martine D., habitante" value="${jrEsc(JR.couverture?.credit || '')}"></label>
    </div></details>
    <details class="jr-volet" open><summary>🖊️ Édito</summary><div class="jr-corps">
      <label class="jr-champ">Texte (une ligne = un paragraphe)<textarea id="jr-edito" rows="8" maxlength="5000">${jrEsc(JR.edito.texte)}</textarea></label>
      <label class="jr-champ">Signé<input id="jr-signataire" maxlength="80" value="${jrEsc(JR.edito.signataire)}"></label>
    </div></details>
    <details class="jr-volet"${JR.opposition.choix !== 'aucun_bloc' ? ' open' : ''}><summary>🗳️ Expression de l'opposition</summary><div class="jr-corps">
      <p class="jr-msg info">${pop >= 1000 ? 'Obligatoire dans une commune de 1 000 habitants ou plus.' : 'Facultatif sous 1 000 habitants.'} Le cadre a toujours la même taille dans le journal.</p>
      ${pop < 1000 ? `<label class="jr-case"><input type="radio" name="jr-opp" value="aucun_bloc"${JR.opposition.choix === 'aucun_bloc' ? ' checked' : ''}>Pas d'espace pour l'opposition</label>` : ''}
      ${choixOpp.map(([v, l]) => `<label class="jr-case"><input type="radio" name="jr-opp" value="${v}"${JR.opposition.choix === v ? ' checked' : ''}>${l}</label>`).join('')}
      <div id="jr-zone-opp"${JR.opposition.choix === 'texte' ? '' : ' hidden'}>
        <label class="jr-champ">Nom de la liste<input id="jr-opp-liste" maxlength="80" value="${jrEsc(JR.opposition.liste)}"></label>
        <label class="jr-champ">Texte, collé tel quel<textarea id="jr-opp-texte" rows="6" maxlength="900">${jrEsc(JR.opposition.texte)}</textarea></label>
        <p class="jr-compteur"><span id="jr-opp-compte">${JR.opposition.texte.length}</span> / 900 caractères : au-delà, le texte ne tient plus dans son cadre.</p>
      </div>
    </div></details>
    <button type="button" class="jr-btn" id="jr-suivant-1">Étape suivante : les contenus</button>`;

  const lier = (id, fn) => ecran.querySelector(id).addEventListener('input', (e) => { fn(e.target.value); jrSauverReglages(); });
  lier('#jr-titre', (v) => { r.titre = v; });
  lier('#jr-sous-titre', (v) => { r.sous_titre = v; });
  lier('#jr-numero', (v) => { r.numero = Math.max(1, Math.min(999, parseInt(v, 10) || 1)); });
  lier('#jr-saison', (v) => { r.saison = v; });
  lier('#jr-tirage', (v) => { r.tirage = v; });
  lier('#jr-debut', (v) => { if (v) r.debut = v; });
  lier('#jr-fin', (v) => { if (v) r.fin = v; });
  lier('#jr-distribution', (v) => { if (v) { r.distribution = v; r.saison = jrSaison(v); ecran.querySelector('#jr-saison').value = r.saison; } });
  lier('#jr-agenda-fin', (v) => { if (v) r.agenda_fin = v; });
  lier('#jr-edito', (v) => { JR.edito.texte = v; });
  lier('#jr-signataire', (v) => { JR.edito.signataire = v; });
  lier('#jr-credit', (v) => { if (JR.couverture) JR.couverture.credit = v; });
  lier('#jr-opp-liste', (v) => { JR.opposition.liste = v; });
  lier('#jr-opp-texte', (v) => { JR.opposition.texte = v; ecran.querySelector('#jr-opp-compte').textContent = v.length; });
  ecran.querySelectorAll('input[name="jr-opp"]').forEach((radio) => radio.addEventListener('change', () => {
    JR.opposition.choix = radio.value;
    ecran.querySelector('#jr-zone-opp').hidden = radio.value !== 'texte';
  }));
  ecran.querySelector('#jr-btn-couv').addEventListener('click', () => jrChoisirFichier(async (f) => {
    try {
      const credit = JR.couverture?.credit || ecran.querySelector('#jr-credit').value;
      JR.couverture = { ...(await jrReduireImage(f, 2600)), credit };
      jrEcranCouverture(ecran);
    } catch { afficherToastMessage('Cette image ne peut pas être lue.', 'erreur'); }
  }));
  ecran.querySelector('#jr-btn-couv-retirer')?.addEventListener('click', () => { JR.couverture = null; jrEcranCouverture(ecran); });
  ecran.querySelector('#jr-suivant-1').addEventListener('click', () => jrAller('contenus'));
}

// ── Écran 2 : contenus ──
function jrEcranContenus(ecran) {
  const c = JR.contenus;
  const rubriquesAffichees = c.rubriques.filter((r) => r.articles.length || (r.cle === 'agenda' && c.evenements.length) || (r.cle === 'thermometre' && c.sondages.length));
  const ligneArticle = (rub, a, i, n) => {
    const etat = JR.articles.get(a.id);
    const photo = etat.sans_photo ? null : (etat.photo || a.photo_url);
    return `<div class="jr-item${etat.inclus ? '' : ' exclu'}">
      <input type="checkbox" data-art="${a.id}"${etat.inclus ? ' checked' : ''} aria-label="Inclure">
      <span class="jr-vign">${photo ? `<img src="${jrEsc(photo)}" alt="">` : '📝'}</span>
      <span class="jr-texte"><b>${jrEsc(etat.titre ?? a.titre)}</b>
        <small>${new Date(a.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}${a.association ? ` · ${jrEsc(a.association)}` : ''} · ${a.nb_mots} mots
        ${photo ? '' : ' · <em>sans photo</em>'}
        · <a data-photo="${a.id}">${photo ? 'Changer la photo' : 'Ajouter une photo'}</a>
        ${photo ? ` · <a data-retirer="${a.id}">Retirer la photo</a> · <a data-grande="${a.id}">${etat.photo_grande ? 'Photo en petit' : 'Photo en grand'}</a>` : ''}
        · <a data-retoucher="${a.id}">Retoucher</a></small></span>
      <span class="jr-ordre"><button type="button" data-monter="${rub}|${a.id}"${i === 0 ? ' disabled' : ''} aria-label="Monter">↑</button><button type="button" data-descendre="${rub}|${a.id}"${i === n - 1 ? ' disabled' : ''} aria-label="Descendre">↓</button></span>
    </div>`;
  };
  ecran.innerHTML = `
    <p class="jr-msg info">Contenus publiés du ${new Date(JR.reglages.debut).toLocaleDateString('fr-FR')} au ${new Date(JR.reglages.fin).toLocaleDateString('fr-FR')}. Tout est coché ; décochez ce que vous ne voulez pas sur le papier. Les retouches ne changent rien dans l'appli.</p>
    ${rubriquesAffichees.length ? '' : '<p class="dechets-vide">Aucun contenu publié pendant cette période. Changez les dates à l\'étape précédente.</p>'}
    ${rubriquesAffichees.map((rub) => {
    const ids = JR.ordre[rub.cle] || [];
    const articles = ids.map((id) => rub.articles.find((a) => a.id === id)).filter(Boolean);
    let extra = '';
    if (rub.cle === 'agenda') {
      extra = c.evenements.map((e) => `<label class="jr-item"><input type="checkbox" data-evt="${e.id}"${JR.evenements.has(e.id) ? ' checked' : ''}>
        <span class="jr-vign">${jrEsc(e.jour)}<br>${jrEsc(e.num)}</span><span class="jr-texte"><b>${jrEsc(e.titre)}</b><small>${jrEsc(e.mois)}${e.lieu ? ` · ${jrEsc(e.lieu)}` : ''}${e.heure ? ` · ${jrEsc(e.heure)}` : ''}</small></span></label>`).join('');
    }
    if (rub.cle === 'thermometre') {
      extra = c.sondages.map((s) => `<label class="jr-item"><input type="checkbox" data-sondage="${s.id}"${JR.sondages.has(s.id) ? ' checked' : ''}>
        <span class="jr-vign">🌡️</span><span class="jr-texte"><b>${jrEsc(s.question)}</b><small>Clos le ${jrEsc(s.cloture)} · ${s.participants} participants</small></span></label>`).join('');
    }
    const nb = articles.filter((a) => JR.articles.get(a.id).inclus).length + (rub.cle === 'agenda' ? JR.evenements.size : 0) + (rub.cle === 'thermometre' ? JR.sondages.size : 0);
    return `<details class="jr-volet"><summary><span class="jr-pastille" style="background:${jrEsc(rub.couleur)}"></span>${jrEsc(rub.titre)} <span class="jr-compte">${nb}</span></summary>
      <div class="jr-corps">${articles.map((a, i) => ligneArticle(rub.cle, a, i, articles.length)).join('')}${extra}</div></details>`;
  }).join('')}
    <details class="jr-volet"><summary>📌 Encarts automatiques</summary><div class="jr-corps">
      <label class="jr-case"><input type="checkbox" data-encart="signalements"${JR.encarts.signalements ? ' checked' : ''}>Bilan des signalements : ${c.signalements.recus} reçus, ${c.signalements.resolus} résolus (rubrique Projets &amp; travaux)</label>
      <label class="jr-case"><input type="checkbox" data-encart="dechets"${JR.encarts.dechets ? ' checked' : ''}>Collecte des déchets${c.dechets.collectes ? '' : ' (rien de réglé dans l\'appli)'} (rubrique Info pratique)</label>
      <label class="jr-case"><input type="checkbox" data-encart="numeros_utiles"${JR.encarts.numeros_utiles ? ' checked' : ''}>Numéros utiles : mairie et urgences (rubrique Info pratique)</label>
      <p class="jr-msg info">Pas encore dans l'essai : photos du jour (il faut d'abord l'accord de leurs auteurs) et entraide.</p>
    </div></details>
    <button type="button" class="jr-btn" id="jr-suivant-2">Voir l'aperçu</button>`;

  ecran.querySelectorAll('[data-art]').forEach((cb) => cb.addEventListener('change', () => { JR.articles.get(cb.dataset.art).inclus = cb.checked; cb.closest('.jr-item').classList.toggle('exclu', !cb.checked); }));
  ecran.querySelectorAll('[data-evt]').forEach((cb) => cb.addEventListener('change', () => { cb.checked ? JR.evenements.add(cb.dataset.evt) : JR.evenements.delete(cb.dataset.evt); }));
  ecran.querySelectorAll('[data-sondage]').forEach((cb) => cb.addEventListener('change', () => { cb.checked ? JR.sondages.add(cb.dataset.sondage) : JR.sondages.delete(cb.dataset.sondage); }));
  ecran.querySelectorAll('[data-encart]').forEach((cb) => cb.addEventListener('change', () => { JR.encarts[cb.dataset.encart] = cb.checked; }));
  const ouverts = () => [...ecran.querySelectorAll('details.jr-volet')].map((d) => d.open);
  const redessiner = () => { const o = ouverts(); jrEcranContenus(ecran); ecran.querySelectorAll('details.jr-volet').forEach((d, i) => { d.open = !!o[i]; }); };
  ecran.querySelectorAll('[data-monter],[data-descendre]').forEach((b) => b.addEventListener('click', () => {
    const [rub, id] = (b.dataset.monter || b.dataset.descendre).split('|');
    const liste = JR.ordre[rub]; const i = liste.indexOf(id); const j = b.dataset.monter ? i - 1 : i + 1;
    if (j < 0 || j >= liste.length) return;
    [liste[i], liste[j]] = [liste[j], liste[i]];
    redessiner();
  }));
  ecran.querySelectorAll('[data-photo]').forEach((a) => a.addEventListener('click', () => jrChoisirFichier(async (f) => {
    try { const etat = JR.articles.get(a.dataset.photo); etat.photo = (await jrReduireImage(f, 1600)).image; etat.sans_photo = false; redessiner(); } catch { afficherToastMessage('Cette image ne peut pas être lue.', 'erreur'); }
  })));
  ecran.querySelectorAll('[data-retirer]').forEach((a) => a.addEventListener('click', () => { const etat = JR.articles.get(a.dataset.retirer); etat.photo = undefined; etat.sans_photo = true; redessiner(); }));
  ecran.querySelectorAll('[data-grande]').forEach((a) => a.addEventListener('click', () => { const etat = JR.articles.get(a.dataset.grande); etat.photo_grande = !etat.photo_grande; redessiner(); }));
  ecran.querySelectorAll('[data-retoucher]').forEach((a) => a.addEventListener('click', () => jrRetoucher(a.dataset.retoucher, redessiner)));
  ecran.querySelector('#jr-suivant-2').addEventListener('click', () => jrAller('apercu'));
}

function jrRetoucher(id, apres) {
  const original = JR.contenus.rubriques.flatMap((r) => r.articles).find((a) => a.id === id);
  const etat = JR.articles.get(id);
  const overlay = ouvrirModaleFormulaire('Retoucher pour le papier', `
    <form id="jr-form-retouche">
      <input type="text" id="jr-ret-titre" maxlength="200" required value="${jrEsc(etat.titre ?? original.titre)}">
      <textarea id="jr-ret-texte" rows="12" maxlength="12000">${jrEsc(etat.texte ?? original.texte)}</textarea>
      <p style="font-size:12px;color:var(--roseau);margin:6px 0;">Une ligne = un paragraphe. L'article dans l'appli ne change pas.</p>
      <button type="submit">Enregistrer pour le journal</button>
      <button type="button" id="jr-ret-annuler" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);margin-top:6px;">Revenir au texte de l'appli</button>
    </form>`);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  corps.querySelector('#jr-form-retouche').addEventListener('submit', (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#jr-ret-titre').value.trim();
    const texte = corps.querySelector('#jr-ret-texte').value;
    etat.titre = titre && titre !== original.titre ? titre : undefined;
    etat.texte = texte !== original.texte ? texte : undefined;
    fermerModaleFormulaire(overlay); apres();
  });
  corps.querySelector('#jr-ret-annuler').addEventListener('click', () => { etat.titre = undefined; etat.texte = undefined; fermerModaleFormulaire(overlay); apres(); });
}

// ── Écran 3 : aperçu, places libres, PDF ──
function jrDemande() {
  const r = JR.reglages;
  const articles = [];
  JR.contenus.rubriques.forEach((rub) => (JR.ordre[rub.cle] || []).forEach((id) => {
    const e = JR.articles.get(id);
    if (!e || !e.inclus) return;
    const a = { id, sans_photo: !!e.sans_photo, photo_grande: !!e.photo_grande };
    if (e.titre) a.titre = e.titre;
    if (e.texte !== undefined) a.texte = e.texte;
    if (e.photo) a.photo = e.photo;
    articles.push(a);
  }));
  return {
    titre: r.titre.trim() || `Le journal de ${JR.contenus.commune.nom}`, sous_titre: r.sous_titre.trim(), numero: r.numero,
    saison: r.saison.trim() || jrSaison(r.distribution), tirage: r.tirage.trim(),
    periode: { debut: r.debut, fin: r.fin, agenda_debut: r.distribution, agenda_fin: r.agenda_fin },
    couverture: JR.couverture ? { image: JR.couverture.image, credit: JR.couverture.credit || '' } : null,
    edito: { texte: JR.edito.texte, signataire: JR.edito.signataire.trim() || 'Le maire' },
    opposition: { choix: JR.opposition.choix, liste: JR.opposition.liste.trim(), texte: JR.opposition.texte },
    articles, evenements: [...JR.evenements], sondages: [...JR.sondages], encarts: { ...JR.encarts },
  };
}

async function jrEcranApercu(ecran) {
  if (JR.opposition.choix === 'texte' && !JR.opposition.texte.trim()) {
    ecran.innerHTML = '<p class="jr-msg alerte">Il manque le texte de l\'opposition. Collez-le à l\'étape « Couverture et édito », ou choisissez « L\'opposition n\'a pas transmis de texte ».</p><button type="button" class="jr-btn" id="jr-retour-1">Revenir à la couverture et à l\'édito</button>';
    ecran.querySelector('#jr-retour-1').addEventListener('click', () => jrAller('couverture'));
    return;
  }
  ecran.innerHTML = `
    <p class="jr-msg info">Mode essai : rien n'est enregistré, aucun article n'est marqué comme paru. Vous pouvez refaire ce numéro autant de fois que vous voulez.</p>
    <div id="jr-rapport"><p class="dechets-vide">Mise en page en cours…</p></div>
    <iframe id="jr-iframe" class="jr-iframe" sandbox="allow-scripts" title="Aperçu du journal"></iframe>
    <button type="button" class="jr-btn" id="jr-btn-pdf">Télécharger le PDF</button>
    <p class="jr-compteur">A4, pages dans l'ordre. Imprimez en recto-verso et agrafez, ou envoyez le même fichier à un imprimeur.</p>`;
  ecran.querySelector('#jr-btn-pdf').addEventListener('click', jrTelechargerPdf);
  const res = await appelApi(`/${window.COMMUNE_SLUG}/journal/apercu`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jrDemande()),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    ecran.querySelector('#jr-rapport').innerHTML = `<p class="jr-msg alerte">${jrEsc(typeof data.erreur === 'string' ? data.erreur : 'L\'aperçu n\'a pas pu être fabriqué.')}</p>`;
    return;
  }
  ecran.querySelector('#jr-iframe').srcdoc = data.html;
}

function jrRecevoirApercu(e) {
  const iframe = document.getElementById('jr-iframe');
  if (!iframe || e.source !== iframe.contentWindow || !e.data || !e.data.journal) return;
  const r = e.data.journal;
  const titreArticle = (id) => JR.contenus.rubriques.flatMap((x) => x.articles).find((a) => a.id === id);
  const alertes = r.alertes.map((a) => {
    if (a.type === 'photo_floue') return `<li>⚠️ Page ${a.page} : la photo de « ${jrEsc(a.titre)} » sera floue à cette taille (${a.ppp} ppp, il en faudrait 150). <a data-act="retirer" data-id="${jrEsc(a.id)}">Retirer la photo</a>${JR.articles.get(a.id)?.photo_grande ? ` · <a data-act="petite" data-id="${jrEsc(a.id)}">La mettre en petit</a>` : ''}</li>`;
    if (a.type === 'couverture_floue') return `<li>⚠️ La photo de couverture sera floue (${a.ppp} ppp). Choisissez une photo plus grande.</li>`;
    if (a.type === 'sans_couverture') return '<li>⚠️ Pas de photo de couverture.</li>';
    if (a.type === 'pages_impaires') return `<li>ℹ️ Le journal fait ${a.pages} pages : la dernière feuille aura un verso blanc.</li>`;
    if (a.type === 'bloc_trop_grand') return `<li>⚠️ « ${jrEsc(a.titre)} » est plus haut qu'une colonne entière : raccourcissez-le.</li>`;
    if (a.type === 'erreur') return `<li>⚠️ Erreur de mise en page : ${jrEsc(a.message)}</li>`;
    return '';
  }).join('');
  const places = r.places.map((p) => {
    const ou = p.ou === 'bas' ? 'en bas de page' : `en bas de la colonne ${p.colonne}`;
    const props = (p.propositions || []).map((pr) => {
      if (pr.action === 'photo') return `<li><a data-act="photo" data-id="${jrEsc(pr.id)}">📷 Ajouter une photo à « ${jrEsc(pr.titre)} »</a> (l'article n'en a pas)</li>`;
      if (pr.action === 'agrandir') return `<li><a data-act="agrandir" data-id="${jrEsc(pr.id)}">🔍 Agrandir la photo de « ${jrEsc(pr.titre)} »</a> (elle est assez nette pour ça)</li>`;
      if (pr.action === 'numeros_utiles') return '<li><a data-act="numeros">☎️ Ajouter l\'encart « Numéros utiles »</a></li>';
      return '';
    }).join('');
    return `<li><b>Page ${p.page}</b> · environ ${p.hauteur_mm} mm vides ${ou}.
      ${props ? `<ul>${props}</ul>` : '<br><span class="jr-compteur">Aucun contenu disponible ne tient proprement ici. Vous pouvez ajouter un texte ou une photo à un article, ou laisser ainsi.</span>'}</li>`;
  }).join('');
  const rapport = document.getElementById('jr-rapport');
  rapport.innerHTML = `<p class="jr-msg ok">${r.pages} pages A4.</p>
    ${alertes ? `<div class="jr-volet-simple"><b>À vérifier</b><ul>${alertes}</ul></div>` : ''}
    ${places ? `<div class="jr-volet-simple"><b>Places libres</b><ul>${places}</ul></div>` : '<p class="jr-msg ok">Aucune place libre notable.</p>'}`;
  rapport.querySelectorAll('[data-act]').forEach((lien) => lien.addEventListener('click', () => {
    const id = lien.dataset.id; const etat = id ? JR.articles.get(id) : null;
    const refaire = () => jrEcranApercu(document.getElementById('journal-ecran'));
    if (lien.dataset.act === 'photo') return jrChoisirFichier(async (f) => { try { etat.photo = (await jrReduireImage(f, 1600)).image; etat.sans_photo = false; refaire(); } catch { afficherToastMessage('Cette image ne peut pas être lue.', 'erreur'); } });
    if (lien.dataset.act === 'agrandir') etat.photo_grande = true;
    if (lien.dataset.act === 'petite') etat.photo_grande = false;
    if (lien.dataset.act === 'retirer') { etat.photo = undefined; etat.sans_photo = true; }
    if (lien.dataset.act === 'numeros') JR.encarts.numeros_utiles = true;
    if (titreArticle(id) || lien.dataset.act === 'numeros') refaire();
  }));
}

async function jrTelechargerPdf() {
  const bouton = document.getElementById('jr-btn-pdf');
  bouton.disabled = true; bouton.textContent = 'Fabrication du PDF… (quelques secondes)';
  try {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/journal/pdf`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(jrDemande()),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      afficherToastMessage(typeof data.erreur === 'string' ? data.erreur : 'La fabrication du PDF a échoué.', 'erreur');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const lien = document.createElement('a');
    lien.href = url; lien.download = `journal-n${JR.reglages.numero}-essai.pdf`;
    document.body.appendChild(lien); lien.click(); lien.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    bouton.disabled = false; bouton.textContent = 'Télécharger le PDF';
  }
}
