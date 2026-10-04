// frontend/js/conseil.js
async function chargerConseil() {
  chargerConseilMembres();
  chargerPv();
}

// ── Trombinoscope du conseil municipal (maire, adjoints, conseillers) ──

function estGestionnaireConseil() {
  return ['elu', 'maire', 'superadmin'].includes(window.ROLE);
}

async function chargerConseilMembres() {
  const zone = document.getElementById('liste-conseil-membres');
  if (!zone) return;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/conseil-membres`);
  if (!res.ok) { zone.innerHTML = ''; return; }
  const { membres } = await res.json();
  zone.innerHTML = '';
  if (!membres.length) {
    zone.innerHTML = `<p class="dechets-vide">Le conseil municipal n'est pas encore renseigné.</p>`;
    return;
  }
  const grille = document.createElement('div');
  grille.className = 'grille-conseil';
  membres.forEach((m) => grille.appendChild(renderMembreConseil(m)));
  zone.appendChild(grille);
}

function renderMembreConseil(membre) {
  const el = document.createElement('div');
  el.className = 'carte-membre-conseil';
  el.innerHTML = `
    <div class="photo-membre-conseil">
      ${membre.photo_url ? `<img src="${membre.photo_url}" alt="">` : '<span>👤</span>'}
    </div>
    <div class="infos-membre-conseil">
      <strong>${escapeAttr(membre.prenom)} ${escapeAttr(membre.nom)}</strong>
      ${membre.fonction ? `<span class="fonction-membre">${escapeAttr(membre.fonction)}</span>` : ''}
      ${membre.profession ? `<span class="profession-membre">${escapeAttr(membre.profession)}</span>` : ''}
      ${membre.contact ? `<span class="contact-membre">${texteAvecLiensCliquables(membre.contact)}</span>` : ''}
      ${estGestionnaireConseil() ? `
        <div class="actions-membre-conseil">
          <button type="button" data-action="modifier">Modifier</button>
          <button type="button" data-action="supprimer">Supprimer</button>
        </div>` : ''}
    </div>
  `;
  el.querySelector('[data-action="modifier"]')?.addEventListener('click', () => ouvrirModaleMembreConseil(membre));
  el.querySelector('[data-action="supprimer"]')?.addEventListener('click', async () => {
    if (!confirm(`Retirer ${membre.prenom} ${membre.nom} du conseil ?`)) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/conseil-membres/${membre.id}`, { method: 'DELETE' });
    if (res.ok) chargerConseilMembres();
  });
  return el;
}

function initFormulaireMembreConseil() {
  const btn = document.getElementById('btn-ouvrir-creation-membre-conseil');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleMembreConseil());
}

function ouvrirModaleMembreConseil(membre = null) {
  const html = `
    <form id="form-membre-conseil">
      <label class="label-champ-edition">Prénom</label>
      <input type="text" id="prenom-membre" maxlength="100" required value="${membre ? escapeAttr(membre.prenom) : ''}">
      <label class="label-champ-edition">Nom</label>
      <input type="text" id="nom-membre" maxlength="100" required value="${membre ? escapeAttr(membre.nom) : ''}">
      <label class="label-champ-edition">Fonction</label>
      <input type="text" id="fonction-membre" maxlength="120" placeholder="Ex : Maire, Adjointe, Conseiller municipal" value="${membre ? escapeAttr(membre.fonction || '') : ''}">
      <label class="label-champ-edition">Profession</label>
      <input type="text" id="profession-membre" maxlength="120" placeholder="Ex : Agriculteur, Enseignante..." value="${membre ? escapeAttr(membre.profession || '') : ''}">
      <label class="label-champ-edition">Contact (optionnel)</label>
      <input type="text" id="contact-membre" maxlength="300" placeholder="Téléphone ou email" value="${membre ? escapeAttr(membre.contact || '') : ''}">
      <label class="label-champ-edition">Photo (optionnel)</label>
      ${membre?.photo_url ? `<div class="apercu-logo-commune"><img src="${membre.photo_url}" alt=""></div>` : ''}
      <input type="file" id="photo-membre" accept="image/jpeg,image/png,image/webp">
      <button type="submit" style="margin-top:12px;">${membre ? 'Mettre à jour' : 'Ajouter'}</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire(membre ? 'Modifier le membre' : 'Ajouter un membre', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-membre-conseil').addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = {
      prenom: corps.querySelector('#prenom-membre').value.trim(),
      nom: corps.querySelector('#nom-membre').value.trim(),
      fonction: corps.querySelector('#fonction-membre').value.trim(),
      profession: corps.querySelector('#profession-membre').value.trim(),
      contact: corps.querySelector('#contact-membre').value.trim(),
    };
    if (!donnees.prenom || !donnees.nom) return;

    const boutonSubmit = corps.querySelector('button[type="submit"]');
    boutonSubmit.disabled = true;

    // Pas de compresserImage() : garde la transparence PNG (même raison que les autres logos).
    const fichier = corps.querySelector('#photo-membre').files[0];
    if (fichier) {
      const resPhoto = await appelApi(`/${window.COMMUNE_SLUG}/conseil-membres/photo-upload`, {
        method: 'POST', headers: { 'Content-Type': fichier.type }, body: fichier,
      });
      if (resPhoto.ok) { const { key } = await resPhoto.json(); donnees.photo_r2_key = key; }
      else { afficherToastMessage('Échec de l\'envoi de la photo.', 'erreur'); }
    }

    const res = membre
      ? await appelApi(`/${window.COMMUNE_SLUG}/conseil-membres/${membre.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(donnees),
        })
      : await appelApi(`/${window.COMMUNE_SLUG}/conseil-membres`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(donnees),
        });

    boutonSubmit.disabled = false;
    if (res.ok) { fermerModaleFormulaire(overlay); chargerConseilMembres(); }
    else { const d = await res.json(); afficherToastMessage(d.erreur ? JSON.stringify(d.erreur) : 'Erreur', 'erreur'); }
  });
}

// ── Comptes-rendus de séance (PV) — réutilise le système d'articles, section="conseil" ──

async function chargerPv() {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/actus?section=conseil`);
  if (!res.ok) return;
  const { articles } = await res.json();
  const conteneur = document.getElementById('liste-pv');
  conteneur.innerHTML = '';
  if (!articles.length) conteneur.innerHTML = `<p class="dechets-vide">Aucun compte-rendu pour l'instant.</p>`;
  articles.forEach((a) => conteneur.appendChild(renderPv(a)));
}

function renderPv(a) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const extraitBrut = texteBrutDepuisHtml(a.contenu_html).replace(/\s+/g, ' ').trim();
  const extrait = extraitBrut.slice(0, 110);
  const dateAffichee = new Date(a.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

  el.innerHTML = `
    <button type="button" class="entete-article-compact">
      <div class="miniature-liste-article miniature-vide">${a.fichier_pv_type === 'pdf' ? '📄' : '📝'}</div>
      <div class="texte-entete-article">
        <h3 class="titre-article-compact">${escapeAttr(a.titre)}</h3>
        <p class="extrait-article-compact">${escapeAttr(extrait)}${extraitBrut.length > 110 ? '…' : ''}</p>
        <span class="date-article-compact">${dateAffichee}</span>
      </div>
    </button>
    <div class="contenu-article-deplie" hidden></div>
  `;

  const zoneDepliee = el.querySelector('.contenu-article-deplie');
  let deploye = false;
  el.querySelector('.entete-article-compact').addEventListener('click', () => {
    deploye = !deploye;
    zoneDepliee.hidden = !deploye;
    if (deploye && zoneDepliee.dataset.rempli !== 'true') {
      zoneDepliee.innerHTML = `<div class="contenu-article">${linkifierHtmlRiche(a.contenu_html)}</div>`;

      if (a.fichier_pv_url) {
        if (a.fichier_pv_type === 'pdf') {
          const lien = document.createElement('a');
          lien.href = a.fichier_pv_url;
          lien.target = '_blank';
          lien.rel = 'noopener';
          lien.className = 'lien-fichier-pv-pdf';
          lien.textContent = '📄 Ouvrir le compte-rendu (PDF)';
          zoneDepliee.appendChild(lien);
        } else {
          const conteneurImg = document.createElement('div');
          conteneurImg.className = 'fichier-pv-apercu';
          const img = document.createElement('img');
          img.src = a.fichier_pv_url;
          img.addEventListener('click', () => ouvrirLightbox(a.fichier_pv_url));
          conteneurImg.appendChild(img);
          zoneDepliee.appendChild(conteneurImg);
        }
      }

      if (['admin', 'elu', 'maire', 'superadmin'].includes(window.ROLE)) {
        const bar = document.createElement('div');
        bar.className = 'actions-admin';
        bar.innerHTML = `<button data-action="supprimer">Supprimer</button>`;
        bar.querySelector('[data-action="supprimer"]').addEventListener('click', async () => {
          if (!confirm('Supprimer ce compte-rendu ?')) return;
          await appelApi(`/${window.COMMUNE_SLUG}/actus/${a.id}`, { method: 'DELETE' });
          chargerPv();
        });
        zoneDepliee.appendChild(bar);
      }
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  return el;
}

function initFormulairePv() {
  const btn = document.getElementById('btn-ouvrir-creation-pv');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationPv());
}

function ouvrirModaleCreationPv() {
  const html = `
    <form id="form-modale-pv">
      <input type="text" id="titre-pv-modale" placeholder="Titre (ex: Conseil du 12 septembre 2026)" maxlength="150" required>
      <label class="label-champ-edition">Compte-rendu (PDF, JPEG ou PNG — 15 Mo max)</label>
      <input type="file" id="fichier-pv-modale" accept="application/pdf,image/jpeg,image/png" required>
      <button type="submit" style="margin-top:12px;">Publier</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Ajouter un compte-rendu', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');

  corps.querySelector('#form-modale-pv').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-pv-modale').value.trim();
    const fichier = corps.querySelector('#fichier-pv-modale').files[0];
    if (!titre || !fichier) return;

    if (fichier.size > 15 * 1024 * 1024) {
      afficherToastMessage('Fichier trop volumineux (15 Mo maximum).', 'erreur');
      return;
    }
    const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/actus/pv-upload`, {
      method: 'POST',
      headers: { 'Content-Type': fichier.type },
      body: fichier,
    });
    if (!resUpload.ok) {
      const d = await resUpload.json().catch(() => ({}));
      afficherToastMessage(d.erreur || 'Échec de l\'envoi du fichier.', 'erreur');
      return;
    }
    const { url: fichier_pv_url, type: fichier_pv_type } = await resUpload.json();

    const res = await appelApi(`/${window.COMMUNE_SLUG}/actus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // contenu_html requis par le schéma (texte libre d'un article classique) mais sans objet
      // ici : le fichier joint est tout le contenu du compte-rendu, voir renderPv ci-dessus.
      body: JSON.stringify({ section: 'conseil', titre, contenu_html: '<p></p>', fichier_pv_url, fichier_pv_type }),
    });
    if (res.ok) {
      fermerModaleFormulaire(overlay);
      chargerPv();
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de publication', 'erreur');
    }
  });
}

// ── Date du prochain conseil (admin/élu/superadmin) ──

function initFormulaireProchainConseil() {
  const form = document.getElementById('form-prochain-conseil');
  if (!form) return;

  appelApi(`/${window.COMMUNE_SLUG}/commune`).then(async (res) => {
    if (!res.ok) return;
    const { commune } = await res.json();
    if (commune.prochain_conseil_date) {
      const input = document.getElementById('prochain-conseil-input');
      const d = new Date(commune.prochain_conseil_date);
      const pad = (n) => String(n).padStart(2, '0');
      input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valeur = document.getElementById('prochain-conseil-input').value;
    if (!valeur) return;
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prochain_conseil_date: new Date(valeur).toISOString() }),
    });
    if (res.ok) afficherToastMessage('Date du prochain conseil enregistrée.', 'succes');
    else afficherToastMessage('Erreur lors de l\'enregistrement.', 'erreur');
  });
}
