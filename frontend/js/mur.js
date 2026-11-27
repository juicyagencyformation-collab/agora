// frontend/js/mur.js
const EMOJIS_REACTION = { jaime: '👍', jadore: '❤️', utile: '💡' };
let intervalPollingMur;

async function initMur() {
  await chargerMur();
  if (!intervalPollingMur) intervalPollingMur = setInterval(() => chargerMur({ auto: true }), 30_000);
}

// Rechargement automatique (toutes les 30 s) : jamais pendant qu'un habitant écrit un commentaire
// (vécu le 2026-11-27 : la liste redessinée refermait la réponse en cours et effaçait le texte),
// ni quand l'appli est en arrière-plan.
function commentaireEnCours(conteneur) {
  return [...conteneur.querySelectorAll('.form-commentaire input')]
    .some((input) => input === document.activeElement || input.value.trim());
}

// Ce que l'habitant a sous les yeux, à remettre après avoir redessiné la liste : discussions
// ouvertes, brouillons de commentaire, champ où il écrit (et position du curseur).
function lireEtatMur(conteneur) {
  const etat = { ouverts: new Set(), brouillons: {}, focus: null };
  conteneur.querySelectorAll('.carte-post').forEach((carte) => {
    const id = carte.dataset.postId;
    if (!carte.querySelector('.zone-commentaires-repliable').hidden) etat.ouverts.add(id);
    const input = carte.querySelector('.form-commentaire input');
    if (input.value) etat.brouillons[id] = input.value;
    if (input === document.activeElement) etat.focus = { id, debut: input.selectionStart, fin: input.selectionEnd };
  });
  return etat;
}

function restaurerEtatMur(conteneur, etat) {
  conteneur.querySelectorAll('.carte-post').forEach((carte) => {
    const id = carte.dataset.postId;
    if (etat.ouverts.has(id)) carte.ouvrirCommentaires();
    const input = carte.querySelector('.form-commentaire input');
    if (etat.brouillons[id]) input.value = etat.brouillons[id];
    if (etat.focus?.id === id) {
      input.focus({ preventScroll: true });
      try { input.setSelectionRange(etat.focus.debut, etat.focus.fin); } catch { /* champ sans sélection */ }
    }
  });
}

async function chargerMur(options = {}) {
  const conteneur = document.getElementById('liste-posts');
  if (options.auto && (document.hidden || commentaireEnCours(conteneur))) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/mur`);
  if (!res.ok) return;
  const { posts } = await res.json();
  // L'habitant a pu commencer à écrire pendant la requête : on ne redessine pas sous ses doigts.
  if (options.auto && commentaireEnCours(conteneur)) return;
  const etat = lireEtatMur(conteneur);
  conteneur.innerHTML = '';
  if (!posts.length) {
    conteneur.innerHTML = `<p class="dechets-vide">Aucun message pour l'instant — soyez le premier à écrire !</p>`;
  }
  posts.forEach((p) => conteneur.appendChild(renderPost(p)));
  restaurerEtatMur(conteneur, etat);
}

function renderPost(post) {
  const el = document.createElement('article');
  el.className = 'carte-post';
  el.dataset.postId = post.id;
  const estMoi = post.user_id === window.USER_ID;
  const estGestionnairePost = ['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE);
  const dateAffichee = new Date(post.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  el.innerHTML = `
    <div class="entete-post">
      <strong>${escapeAttr(post.auteur_prenom)} ${escapeAttr(post.auteur_nom)}</strong>
      <span class="date-post">${dateAffichee}</span>
    </div>
    <p class="contenu-post">${texteAvecLiensCliquables(post.contenu)}</p>
    <div class="barre-reactions"></div>
    <button type="button" class="btn-toggle-commentaires">💬 ${post.commentaires.length} commentaire(s) ▾</button>
    <div class="zone-commentaires-repliable" hidden>
      <div class="liste-commentaires"></div>
      <form class="form-commentaire"><input type="text" maxlength="500" placeholder="Commenter..."><button>Envoyer</button></form>
    </div>
    <div class="actions-admin" style="margin-top:8px;">
      ${!estMoi ? `<button class="btn-signaler-post" ${post.deja_signale ? 'disabled' : ''}>${post.deja_signale ? 'Signalé' : '🚩 Signaler'}</button>` : ''}
      ${estMoi || estGestionnairePost ? '<button class="btn-supprimer-post">Supprimer</button>' : ''}
    </div>
  `;

  const zoneReactions = el.querySelector('.barre-reactions');
  post.reactions.forEach(({ type, total }) => {
    const btn = document.createElement('button');
    btn.className = `btn-reaction ${post.ma_reaction === type ? 'active' : ''}`;
    btn.textContent = `${EMOJIS_REACTION[type]} ${total}`;
    btn.addEventListener('click', async () => {
      await appelApi(`/${window.COMMUNE_SLUG}/mur/${post.id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      chargerMur();
    });
    zoneReactions.appendChild(btn);
  });

  const zoneCommentaires = el.querySelector('.liste-commentaires');
  post.commentaires.forEach((cm) => {
    const p = document.createElement('p');
    p.className = 'commentaire';
    p.innerHTML = `<strong>${escapeAttr(cm.auteur_prenom)} ${escapeAttr(cm.auteur_nom)}</strong> ${texteAvecLiensCliquables(cm.contenu)}`;
    zoneCommentaires.appendChild(p);
  });

  const zoneRepliable = el.querySelector('.zone-commentaires-repliable');
  const btnCommentaires = el.querySelector('.btn-toggle-commentaires');
  const afficherCommentaires = (ouvert) => {
    zoneRepliable.hidden = !ouvert;
    btnCommentaires.textContent = `💬 ${post.commentaires.length} commentaire(s) ${ouvert ? '▲' : '▾'}`;
  };
  btnCommentaires.addEventListener('click', () => afficherCommentaires(zoneRepliable.hidden));
  // Utilisé par restaurerEtatMur : la discussion reste ouverte après un rechargement.
  el.ouvrirCommentaires = () => afficherCommentaires(true);

  el.querySelector('.form-commentaire').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    if (!input.value.trim()) return;
    await appelApi(`/${window.COMMUNE_SLUG}/mur/${post.id}/commentaires`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contenu: input.value.trim() }),
    });
    input.value = '';
    chargerMur();
  });

  el.querySelector('.btn-signaler-post')?.addEventListener('click', async () => {
    if (!confirm('Signaler ce message comme inapproprié ? Il sera masqué en attente de revue par la mairie.')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/mur/${post.id}/signaler`, { method: 'POST' });
    chargerMur();
  });

  el.querySelector('.btn-supprimer-post')?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce message ?')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/mur/${post.id}`, { method: 'DELETE' });
    chargerMur();
  });

  return el;
}

// Fait défiler jusqu'à un message précis (venant d'un lien de notification).
function ouvrirPostParId(id) {
  const carte = document.querySelector(`[data-post-id="${id}"]`);
  if (!carte) return;
  carte.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function initFormulaireMur() {
  const btn = document.getElementById('btn-ouvrir-creation-mur');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationMur());
}

function ouvrirModaleCreationMur() {
  const html = `
    <form id="form-modale-mur">
      <textarea id="contenu-post-mur-modale" placeholder="Quoi de neuf dans le village ?" maxlength="2000" required></textarea>
      <button type="submit">Publier</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Écrire sur le mur', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-mur').addEventListener('submit', async (e) => {
    e.preventDefault();
    const contenu = corps.querySelector('#contenu-post-mur-modale').value.trim();
    if (!contenu) return;

    const res = await publierPost(contenu);
    if (res.ok) {
      traiterRecompense(await res.clone().json());
      fermerModaleFormulaire(overlay);
    } else {
      const data = await res.json();
      alert(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de publication');
    }
  });
}

async function publierPost(contenu) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/mur`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contenu }),
  });
  if (res.ok) chargerMur();
  return res;
}
