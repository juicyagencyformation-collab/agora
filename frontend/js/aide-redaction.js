// frontend/js/aide-redaction.js
// Aide à la rédaction des articles (volet replié du formulaire « Publier un article ») :
// l'élu note l'essentiel, on assemble un prompt « journaliste de PQR » (charte de Munich),
// on l'ouvre pré-rempli dans l'assistant choisi (ChatGPT, Le Chat, Claude) en le copiant aussi,
// puis la réponse collée est découpée (TITRE / CHAPEAU / TEXTE) et placée dans le formulaire.
// 100 % côté client : Agora n'envoie rien à aucune IA, c'est l'élu qui envoie depuis son
// téléphone (d'où la mention 🔒 : jamais d'informations privées sur un habitant).
// Garde-fou : tant qu'il reste un « [À COMPLÉTER : …] » (info manquante signalée par l'IA au
// lieu de l'inventer), la publication est bloquée — voir articleContientACompleter.
// Les notes sont gardées dans le navigateur : sur iPhone, passer dans l'app de l'IA peut
// recharger la PWA et fermer la fenêtre — l'élu retrouve alors ses notes en la rouvrant.

const ASSISTANTS_REDACTION = {
  chatgpt: (q) => 'https://chatgpt.com/?q=' + encodeURIComponent(q),
  lechat: (q) => 'https://chat.mistral.ai/chat?q=' + encodeURIComponent(q),
  claude: (q) => 'https://claude.ai/new?q=' + encodeURIComponent(q),
};
const TONS_REDACTION = {
  informatif: 'informatif et neutre',
  chaleureux: 'chaleureux et convivial, sans familiarité',
  sobre: 'sobre et respectueux, sans aucune formule enjouée (décès, hommage ou événement grave)',
};
const LONGUEURS_REDACTION = {
  breve: '80 à 130 mots, sans intertitre',
  article: '180 à 300 mots, un intertitre au plus',
};
const CHAMPS_AIDE_REDACTION = ['sujet', 'quand', 'details', 'contact', 'ton', 'longueur'];

const cleBrouillonAideRedaction = () => `agora-aide-redaction-${window.COMMUNE_SLUG}`;

function htmlVoletAideRedaction() {
  return `
    <details class="volet-aide-redaction" id="volet-aide-redaction">
      <summary>✨ Aide à la rédaction <span class="sous-volet-aide">optionnel</span></summary>
      <div class="contenu-aide-redaction">
        <p class="intro-aide-redaction">Notez l'essentiel en quelques mots. Un assistant rédige l'article selon les règles du journalisme, puis vous relisez.</p>

        <div class="etape-aide-redaction"><span>1</span> L'essentiel</div>
        <label class="label-champ-edition" for="aide-red-sujet">De quoi s'agit-il ? *</label>
        <input type="text" id="aide-red-sujet" maxlength="200" placeholder="Ex. : repas des aînés, travaux rue de l'Église…">
        <label class="label-champ-edition" for="aide-red-quand">Quand et où ?</label>
        <input type="text" id="aide-red-quand" maxlength="200" placeholder="Ex. : samedi 5 décembre, 12 h, salle des fêtes">
        <label class="label-champ-edition" for="aide-red-details">Ce que les habitants doivent savoir</label>
        <textarea id="aide-red-details" maxlength="1500" rows="4" placeholder="Notes en vrac, une idée par ligne"></textarea>
        <p class="note-aide-redaction">Pas besoin de faire des phrases. Le micro 🎤 du clavier fonctionne très bien.</p>
        <label class="label-champ-edition" for="aide-red-contact">Contact ou lien (optionnel)</label>
        <input type="text" id="aide-red-contact" maxlength="200" placeholder="Ex. : secrétariat de mairie">
        <div class="rangee-aide-redaction">
          <div>
            <label class="label-champ-edition" for="aide-red-ton">Ton</label>
            <select id="aide-red-ton">
              <option value="informatif">Informatif</option>
              <option value="chaleureux">Chaleureux (fête, vie du village)</option>
              <option value="sobre">Sobre (décès, hommage, alerte)</option>
            </select>
          </div>
          <div>
            <label class="label-champ-edition" for="aide-red-longueur">Longueur</label>
            <select id="aide-red-longueur">
              <option value="breve">Courte</option>
              <option value="article">Développée</option>
            </select>
          </div>
        </div>
        <p class="rgpd-aide-redaction">🔒 Ces notes partent chez l'assistant choisi. N'y mettez pas d'informations privées sur un habitant (santé, adresse, situation familiale).</p>

        <div class="etape-aide-redaction"><span>2</span> Faire rédiger</div>
        <p class="intro-aide-redaction">Choisissez un assistant gratuit :</p>
        <div class="choix-assistants-redaction">
          <a class="btn-assistant-redaction" data-assistant="chatgpt" href="https://chatgpt.com/" target="_blank" rel="noopener"><strong>ChatGPT ↗</strong><span>sans compte</span></a>
          <a class="btn-assistant-redaction" data-assistant="lechat" href="https://chat.mistral.ai/chat" target="_blank" rel="noopener"><strong>Le Chat ↗</strong><span>français · compte</span></a>
          <a class="btn-assistant-redaction" data-assistant="claude" href="https://claude.ai/new" target="_blank" rel="noopener"><strong>Claude ↗</strong><span>compte gratuit</span></a>
        </div>
        <p class="note-aide-redaction">Le texte est aussi copié. Si l'assistant s'ouvre vide, appuyez longuement dans sa zone de saisie puis « Coller », et envoyez.</p>
        <details class="voir-prompt-redaction">
          <summary>Voir le texte envoyé à l'assistant</summary>
          <pre id="aide-red-prompt"></pre>
        </details>

        <div class="etape-aide-redaction"><span>3</span> Récupérer l'article</div>
        <label class="label-champ-edition" for="aide-red-reponse">Copiez la réponse de l'assistant, puis collez-la ici</label>
        <textarea id="aide-red-reponse" rows="3" placeholder="Appuyez longuement ici puis « Coller »"></textarea>
        <button type="button" id="aide-red-placer" class="btn-contour-aide-redaction">Placer dans l'article</button>
        <p id="aide-red-message" class="note-aide-redaction" hidden></p>
      </div>
    </details>
    <p id="alerte-a-completer" class="alerte-a-completer" hidden>⚠️ L'assistant a laissé des passages <span class="a-completer">[À COMPLÉTER…]</span> faute d'information. Remplacez-les par la bonne information (ou supprimez la phrase) avant de publier.</p>
  `;
}

// options : { editeur (creerEditeurRiche), zoneEditeur (sa zone contenteditable), inputTitre,
//             selectCategorie, selectPublierPour (null si pas d'association) }
function initVoletAideRedaction(corps, options) {
  const champ = (nom) => corps.querySelector(`#aide-red-${nom}`);
  const volet = corps.querySelector('#volet-aide-redaction');

  try {
    const brouillon = JSON.parse(localStorage.getItem(cleBrouillonAideRedaction()) || 'null');
    if (brouillon?.sujet) {
      CHAMPS_AIDE_REDACTION.forEach((nom) => { if (brouillon[nom] != null) champ(nom).value = brouillon[nom]; });
      volet.open = true; // retour depuis l'app de l'IA : l'élu retrouve ses notes
    }
  } catch { /* navigation privée : pas de brouillon */ }

  const sauver = () => {
    const brouillon = {};
    CHAMPS_AIDE_REDACTION.forEach((nom) => { brouillon[nom] = champ(nom).value; });
    try { localStorage.setItem(cleBrouillonAideRedaction(), JSON.stringify(brouillon)); } catch { /* sans mémoire */ }
  };

  const construirePrompt = () => {
    const v = (nom) => champ(nom).value.trim();
    const commune = document.getElementById('nom-commune')?.textContent.trim() || window.COMMUNE_SLUG;
    const optionAuteur = options.selectPublierPour?.selectedOptions[0];
    const auteur = optionAuteur ? optionAuteur.textContent.replace(/^\W+/u, '').trim() : 'La mairie';
    const rubrique = options.selectCategorie.selectedOptions[0]?.textContent || '';
    const details = v('details').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => '  • ' + l).join('\n');
    return `Tu es un journaliste chevronné de presse quotidienne régionale. Rédige un article pour l'application municipale de ${commune}, lue sur téléphone par les habitants. L'article est publié au nom de : ${auteur}.

INFORMATIONS (ta seule source) :
- Sujet : ${v('sujet') || '(non précisé)'}
- Quand et où : ${v('quand') || '(non précisé)'}
- Détails :
${details || '  • (aucun)'}
- Contact ou lien : ${v('contact') || '(aucun)'}
- Rubrique : ${rubrique}

DÉONTOLOGIE (charte de Munich) :
1. N'invente rien : aucun nom, chiffre, date, horaire, prix ou citation absent des informations. Ne déduis jamais un jour de la semaine à partir d'une date. S'il manque une information indispensable, écris [À COMPLÉTER : ce qui manque].
2. Impartialité : informe, ne vante pas. Pas d'autopromotion de la municipalité, pas de superlatifs. Si le sujet fait débat, expose les faits et les positions sans trancher.
3. Respect des personnes : ne nomme aucun particulier absent des informations et ne donne aucune information privée.
4. Clarté : français soigné, phrases courtes, voix active, aucun jargon administratif, sigles expliqués.

FORME :
- Ton ${TONS_REDACTION[champ('ton').value]}.
- Pyramide inversée : l'essentiel (quoi, quand, où, pour qui) dans les deux premières phrases.
- Titre informatif de 70 caractères maximum, sans point d'exclamation ni effet d'accroche.
- Chapeau de 1 à 2 phrases.
- Corps de ${LONGUEURS_REDACTION[champ('longueur').value]}, en paragraphes de 2 à 3 phrases.
- Si c'est utile, un dernier paragraphe qui commence par « En pratique : » (date, lieu, contact).
- Dates en toutes lettres (5 décembre), heures au format « 12 h » ou « 14 h 30 ».
- Pas d'emoji, pas de hashtag, pas de gras.

RÉPONDS UNIQUEMENT dans ce format, sans rien avant ni après :
TITRE : …
CHAPEAU : …
TEXTE :
… (paragraphes séparés par une ligne vide ; un éventuel intertitre seul sur sa ligne, précédé de ##)`;
  };

  const rafraichir = () => {
    const prompt = construirePrompt();
    corps.querySelectorAll('.btn-assistant-redaction').forEach((a) => { a.href = ASSISTANTS_REDACTION[a.dataset.assistant](prompt); });
    champ('prompt').textContent = prompt;
  };

  CHAMPS_AIDE_REDACTION.forEach((nom) => champ(nom).addEventListener('input', () => { sauver(); rafraichir(); }));
  [options.selectCategorie, options.selectPublierPour].filter(Boolean).forEach((el) => el.addEventListener('change', rafraichir));
  rafraichir();

  corps.querySelectorAll('.btn-assistant-redaction').forEach((a) => a.addEventListener('click', (e) => {
    if (!champ('sujet').value.trim()) {
      e.preventDefault();
      afficherToastMessage("Indiquez au moins de quoi il s'agit.", 'erreur');
      champ('sujet').focus();
      return;
    }
    rafraichir();
    navigator.clipboard?.writeText(construirePrompt()).catch(() => {});
  }));

  const verifier = () => {
    corps.querySelector('#alerte-a-completer').hidden =
      !articleContientACompleter(options.inputTitre.value, options.editeur.getHtml());
  };
  options.inputTitre.addEventListener('input', verifier);
  options.zoneEditeur.addEventListener('input', verifier);

  const placer = () => {
    const message = champ('message');
    message.hidden = false;
    const brut = champ('reponse').value.trim();
    if (!brut) {
      message.textContent = "Collez d'abord la réponse de l'assistant dans la zone ci-dessus.";
      return;
    }
    const { titre, html } = analyserReponseAideRedaction(brut);
    if (titre) options.inputTitre.value = titre;
    options.editeur.setHtml(html);
    verifier();
    message.textContent = titre ? '✓ Titre et texte placés. Relisez-les ci-dessous.' : '✓ Texte placé. Ajoutez un titre ci-dessous.';
    volet.open = false;
    options.inputTitre.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  champ('reponse').addEventListener('paste', () => setTimeout(placer, 0));
  champ('placer').addEventListener('click', placer);
}

// Découpe la réponse de l'IA (TITRE / CHAPEAU / TEXTE, gras Markdown toléré car le bouton
// « copier » de ChatGPT copie en Markdown) en HTML limité aux balises que garde
// worker/src/lib/sanitize.ts : chapeau et intertitres en <p><b>, paragraphes en <p>.
function analyserReponseAideRedaction(brut) {
  const lignes = brut.replace(/\r/g, '').replace(/\*\*/g, '').split('\n');
  const marqueur = (ligne, mot) => ligne.match(new RegExp(`^\\s*#*\\s*${mot}\\s*:\\s*(.*)$`, 'i'));
  let titre = '';
  let chapeau = '';
  let mode = null;
  const corpsTexte = [];
  for (const ligne of lignes) {
    let m;
    if ((m = marqueur(ligne, 'TITRE'))) { titre = m[1].trim(); mode = null; continue; }
    if ((m = marqueur(ligne, 'CHAPEAU'))) { chapeau = m[1].trim(); mode = 'chapeau'; continue; }
    if ((m = marqueur(ligne, 'TEXTE'))) { mode = 'texte'; if (m[1].trim()) corpsTexte.push(m[1]); continue; }
    if (mode === 'chapeau') { if (ligne.trim()) chapeau += ' ' + ligne.trim(); else mode = null; continue; }
    if (mode === 'texte') corpsTexte.push(ligne);
  }
  // Format non respecté par l'IA : tout part dans le texte, le titre reste à écrire.
  if (!titre && !chapeau && !corpsTexte.length) corpsTexte.push(...lignes);

  const echapper = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = chapeau ? `<p><b>${echapper(chapeau)}</b></p>` : '';
  corpsTexte.join('\n').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).forEach((bloc) => {
    html += /^#{1,4}\s+/.test(bloc)
      ? `<p><b>${echapper(bloc.replace(/^#{1,4}\s+/, ''))}</b></p>`
      : `<p>${echapper(bloc).replace(/\n/g, '<br>')}</p>`;
  });
  return {
    titre: titre.replace(/^["«\s]+|["»\s]+$/g, ''),
    html: html.replace(/\[À COMPLÉTER[^\]]*\]/gi, (m) => `<span class="a-completer">${m}</span>`),
  };
}

function articleContientACompleter(titre, html) {
  return /\[À COMPLÉTER/i.test(`${titre} ${html}`);
}

// Retire le surlignage des passages à compléter avant envoi (le serveur ne garde de toute
// façon pas les classes, voir sanitize.ts) et oublie les notes une fois l'article publié.
function nettoyerHtmlAideRedaction(html) {
  return html.replace(/<span class="a-completer">([\s\S]*?)<\/span>/g, '$1');
}
function effacerBrouillonAideRedaction() {
  try { localStorage.removeItem(cleBrouillonAideRedaction()); } catch { /* rien */ }
}
