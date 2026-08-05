// frontend/js/agenda.js
let modeHistoriqueAgenda = false;

// Construit un lien "Ajouter à Google Agenda" — plus fiable que le .ics sur Android,
// où le comportement d'ouverture des fichiers .ics par le navigateur est très inégal.
function urlGoogleCalendar(event) {
  const versGoogleDate = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.titre,
    dates: `${versGoogleDate(event.date_debut)}/${versGoogleDate(event.date_fin)}`,
    details: event.description || '',
    location: event.lieu || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function formatDateAffichageEvent(event) {
  const debut = new Date(event.date_debut);
  const fin = new Date(event.date_fin);
  const estJourneeEntiere = debut.getHours() === 0 && debut.getMinutes() === 0 && fin.getHours() === 23 && fin.getMinutes() === 59;
  const jour = debut.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  if (estJourneeEntiere) {
    const jourFin = fin.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    return jour === jourFin ? jour : `${jour} → ${jourFin}`;
  }
  return debut.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function badgeQuandEvenement(dateDebutIso) {
  const dateEvent = new Date(dateDebutIso);
  const aujourdhui = new Date();
  const memeJour = (a, b) => a.toDateString() === b.toDateString();
  if (memeJour(dateEvent, aujourdhui)) return { texte: 'Aujourd\'hui', classe: 'badge-aujourdhui' };
  const demain = new Date(aujourdhui);
  demain.setDate(demain.getDate() + 1);
  if (memeJour(dateEvent, demain)) return { texte: 'Demain', classe: 'badge-demain' };
  return null;
}

// Un seul bouton : détecte iOS (Calendrier natif via .ics) vs le reste (Google Agenda,
// plus fiable qu'un .ics sur Android où le comportement du navigateur est très inégal).
function lienCalendrierAuto(event) {
  const estIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (estIOS) {
    return `<a href="${window.API_BASE}/${window.COMMUNE_SLUG}/agenda/${event.id}/ics" class="lien-calendrier">📅 Ajouter à mon calendrier</a>`;
  }
  return `<a href="${urlGoogleCalendar(event)}" target="_blank" rel="noopener" class="lien-calendrier">📅 Ajouter à mon calendrier</a>`;
}

// Ouvre un événement précis (venant d'un lien de notification) : le déplie et y fait défiler.
function ouvrirEventParId(id) {
  const carte = document.querySelector(`[data-event-id="${id}"]`);
  if (!carte) return;
  carte.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const zoneDepliee = carte.querySelector('.contenu-article-deplie');
  if (zoneDepliee?.hidden) carte.querySelector('.entete-event-compact').click();
}

let rayonAutourDeMoi = 20;

function initSousOngletsAgenda() {
  document.querySelectorAll('.sous-onglet-agenda-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sous-onglet-agenda-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const estAutour = btn.dataset.sousonglet === 'autour';
      document.getElementById('sous-contenu-agenda-local').hidden = estAutour;
      document.getElementById('sous-contenu-agenda-autour').hidden = !estAutour;
      if (estAutour) chargerAutourDeMoi();
    });
  });

  document.querySelectorAll('#lignes-rayon-autour button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#lignes-rayon-autour button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      rayonAutourDeMoi = parseInt(btn.dataset.rayon, 10);
      chargerAutourDeMoi();
    });
  });
}

async function chargerAutourDeMoi() {
  const zoneMessage = document.getElementById('message-autour-de-moi');
  const zoneListe = document.getElementById('liste-autour-de-moi');

  if (window.COMMUNE_COORDS_MANQUANTES || !window.COMMUNE_LAT) {
    zoneMessage.textContent = 'La position de votre commune n\'est pas encore renseignée (Modération) — impossible de chercher autour.';
    zoneListe.innerHTML = '';
    afficherEvenementsAutourSurCarte([]);
    return;
  }

  zoneMessage.textContent = 'Recherche en cours…';
  try {
    const url = `${window.API_BASE}/decouverte/evenements?lat=${window.COMMUNE_LAT}&lng=${window.COMMUNE_LNG}&rayon=${rayonAutourDeMoi}`;
    const res = await fetch(url);
    const data = await res.json();
    zoneListe.innerHTML = '';

    if (!data.evenements.length) {
      zoneMessage.textContent = data.communes_participantes
        ? `${data.communes_participantes} commune(s) partenaire(s) à moins de ${rayonAutourDeMoi} km, mais rien de prévu pour l'instant.`
        : `Aucune commune partenaire dans un rayon de ${rayonAutourDeMoi} km pour l'instant.`;
      afficherEvenementsAutourSurCarte([]);
      return;
    }

    zoneMessage.textContent = `${data.evenements.length} événement(s) dans ${data.communes_participantes} commune(s)`;
    data.evenements.forEach((e) => zoneListe.appendChild(renderCarteEvenementAutour(e)));
    afficherEvenementsAutourSurCarte(data.evenements);
  } catch {
    zoneMessage.textContent = 'Erreur lors de la recherche.';
  }
}

function renderCarteEvenementAutour(e) {
  const el = document.createElement('article');
  el.className = 'carte-article-compacte';
  const dateAffichee = new Date(e.date_debut).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const badgeOrigine = e.commune_nationale
    ? `🇫🇷 ${escapeAttr(e.commune_nom)} · National`
    : `📍 ${escapeAttr(e.commune_nom)} · ${e.commune_distance_km} km`;
  el.innerHTML = `
    <div style="padding:12px;">
      <span class="badge-categorie-article">${badgeOrigine}</span>
      <h3 class="titre-article-compact">${escapeAttr(e.titre)}</h3>
      <p class="extrait-article-compact">${dateAffichee}${e.lieu ? ' · ' + escapeAttr(e.lieu) : ''}</p>
      ${e.description ? `<p style="font-size:13px;color:var(--boue);margin-top:6px;">${escapeAttr(e.description)}</p>` : ''}
    </div>
  `;
  return el;
}

let carteAgenda;

async function chargerAgenda() {
  const url = new URL(`${window.API_BASE}/${window.COMMUNE_SLUG}/agenda`, window.location.origin);
  if (modeHistoriqueAgenda) url.searchParams.set('historique', 'true');
  const res = await appelApi(url);
  if (!res.ok) return;
  const { events } = await res.json();
  const conteneur = document.getElementById('liste-events');
  conteneur.innerHTML = '';
  if (!events.length) {
    conteneur.innerHTML = `<p class="dechets-vide">${modeHistoriqueAgenda ? 'Aucun événement passé.' : 'Aucun événement à venir — proposez le premier !'}</p>`;
  }
  events.forEach((e) => conteneur.appendChild(renderEvent(e)));
  afficherEvenementsSurCarte(events);
}

function initToggleCarteAgenda() {
  const btn = document.getElementById('btn-toggle-carte-agenda');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const zone = document.getElementById('carte-agenda');
    const ouverte = zone.hidden;
    zone.hidden = !ouverte;
    btn.textContent = ouverte ? '📋 Revenir à la liste' : '🗺️ Voir sur la carte';
    if (ouverte) {
      setTimeout(() => {
        if (!carteAgenda) {
          carteAgenda = L.map('carte-agenda', { maxZoom: 20 }).setView(
            [window.COMMUNE_LAT ?? 43.6047, window.COMMUNE_LNG ?? 1.4442],
            window.COMMUNE_COORDS_MANQUANTES ? 6 : 14,
          );
          L.tileLayer(
            'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
            { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 20 },
          ).addTo(carteAgenda);
        }
        carteAgenda.invalidateSize();
      }, 50);
    }
  });
}

function afficherEvenementsSurCarte(events) {
  if (!carteAgenda) return;
  carteAgenda.eachLayer((couche) => {
    if (couche instanceof L.Marker) carteAgenda.removeLayer(couche);
  });
  events.filter((e) => e.lat && e.lng).forEach((e) => {
    L.marker([e.lat, e.lng]).addTo(carteAgenda).bindPopup(`<strong>${escapeAttr(e.titre)}</strong><br>${formatDateAffichageEvent(e)}`);
  });
}

let carteAutourDeMoi;

function initToggleCarteAutourDeMoi() {
  const btn = document.getElementById('btn-toggle-carte-autour');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const zone = document.getElementById('carte-autour-de-moi');
    const ouverte = zone.hidden;
    zone.hidden = !ouverte;
    btn.textContent = ouverte ? '📋 Revenir à la liste' : '🗺️ Voir sur la carte';
    if (ouverte) {
      setTimeout(() => {
        if (!carteAutourDeMoi) {
          carteAutourDeMoi = L.map('carte-autour-de-moi', { maxZoom: 20 }).setView(
            [window.COMMUNE_LAT ?? 43.6047, window.COMMUNE_LNG ?? 1.4442],
            window.COMMUNE_COORDS_MANQUANTES ? 6 : 10,
          );
          L.tileLayer(
            'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
            { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 20 },
          ).addTo(carteAutourDeMoi);
        }
        carteAutourDeMoi.invalidateSize();
      }, 50);
    }
  });
}

// Marqueurs colorés par origine — distingue en un coup d'œil une commune partenaire locale
// d'un événement national, comme les badges déjà utilisés dans la liste (🇫🇷 vs 📍).
function afficherEvenementsAutourSurCarte(events) {
  if (!carteAutourDeMoi) return;
  carteAutourDeMoi.eachLayer((couche) => {
    if (couche instanceof L.Marker) carteAutourDeMoi.removeLayer(couche);
  });
  events.filter((e) => e.lat && e.lng).forEach((e) => {
    const icone = L.divIcon({
      className: 'marqueur-autour-de-moi',
      html: e.commune_nationale ? '🇫🇷' : '📍',
      iconSize: [26, 26],
    });
    const dateAffichee = new Date(e.date_debut).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    L.marker([e.lat, e.lng], { icon: icone }).addTo(carteAutourDeMoi).bindPopup(
      `<strong>${escapeAttr(e.titre)}</strong><br>${escapeAttr(e.commune_nom)}${e.commune_distance_km != null ? ` · ${e.commune_distance_km} km` : ''}<br>${dateAffichee}`,
    );
  });
}

function initToggleHistoriqueAgenda() {
  const btn = document.getElementById('btn-toggle-historique-agenda');
  if (!btn) return;
  btn.addEventListener('click', () => {
    modeHistoriqueAgenda = !modeHistoriqueAgenda;
    btn.textContent = modeHistoriqueAgenda ? '📅 Voir les événements à venir' : '🕰️ Voir les événements passés';
    chargerAgenda();
  });
}

function renderEvent(event) {
  const el = document.createElement('article');
  el.className = 'carte-event-compact';
  el.dataset.eventId = event.id;
  const estGestionnaireEvent = ['admin', 'elu', 'superadmin'].includes(window.ROLE);
  const peutModifier = event.est_moi || estGestionnaireEvent;
  const dateAffichee = formatDateAffichageEvent(event);
  const badgeQuand = !modeHistoriqueAgenda ? badgeQuandEvenement(event.date_debut) : null;

  el.innerHTML = `
    <button type="button" class="entete-event-compact">
      ${event.photo_url ? `<img src="${event.photo_url}" class="miniature-liste-article">` : '<div class="miniature-liste-article miniature-vide">📅</div>'}
      <div class="texte-entete-event">
        <div class="badges-event-compact">
          <span class="badge-categorie-article ${event.officiel ? 'badge-officiel-event' : ''}">${event.officiel ? '🏛️ Officiel' : '👤 Citoyen'}</span>
          ${badgeQuand ? `<span class="badge-categorie-article ${badgeQuand.classe}">${badgeQuand.texte}</span>` : ''}
        </div>
        <h3 class="titre-article-compact">${escapeAttr(event.titre)}</h3>
        <p class="extrait-article-compact">${dateAffichee}${event.lieu ? ' · ' + escapeAttr(event.lieu) : ''}</p>
        <span class="date-article-compact">👥 ${event.total_participants} participant(s)</span>
      </div>
    </button>
    <div class="contenu-article-deplie" hidden></div>
  `;

  const zoneDepliee = el.querySelector('.contenu-article-deplie');
  let deploye = false;
  el.querySelector('.entete-event-compact').addEventListener('click', () => {
    deploye = !deploye;
    zoneDepliee.hidden = !deploye;
    if (deploye && zoneDepliee.dataset.rempli !== 'true') {
      remplirContenuEvenement(zoneDepliee, event, peutModifier);
      zoneDepliee.dataset.rempli = 'true';
    }
  });

  const img = el.querySelector('.entete-event-compact img');
  if (img) {
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', (e) => {
      e.stopPropagation(); // empêche le clic de remonter jusqu'au bouton d'accordéon
      ouvrirLightbox(event.photo_url);
    });
  }

  return el;
}

function remplirContenuEvenement(zone, event, peutModifier) {
  // Distinct de peutModifier (qui inclut admin) : validation des présences civiques réservée
  // à l'organisateur, élu ou superadmin — voir la garde bespoke côté serveur (agenda.ts).
  const peutValiderPresences = event.est_moi || ['elu', 'superadmin'].includes(window.ROLE);

  zone.innerHTML = `
    ${event.description ? `<p>${escapeAttr(event.description)}</p>` : ''}
    <p style="font-size:11.5px;color:var(--roseau);">Organisé par ${escapeAttr(event.auteur_prenom)} ${escapeAttr(event.auteur_nom)}</p>

    <button type="button" class="btn-toggle-participants">👥 Voir les participants ▾</button>
    <div class="zone-participants-repliable" hidden></div>

    ${!event.est_moi ? `<button class="btn-participer ${event.je_participe ? 'active' : ''}">${event.je_participe ? 'Je ne participe plus' : 'Je participe'}</button>` : ''}

    ${event.necessite_validation_presence && !event.est_moi ? `<div class="carte-scan-civique">${renderZoneScanCivique(event)}</div>` : ''}
    ${event.necessite_validation_presence && peutModifier ? `
      <a href="${window.API_BASE}/${window.COMMUNE_SLUG}/agenda/${event.id}/qr-page" target="_blank" class="lien-qr-civique">📱 Voir le QR à afficher sur place</a>
    ` : ''}
    ${event.necessite_validation_presence && peutValiderPresences ? `
      <button type="button" class="btn-gerer-presences">🎫 Gérer les présences</button>
      <div class="zone-validation-presences" hidden></div>
    ` : ''}

    <div class="liens-calendrier">
      ${lienCalendrierAuto(event)}
    </div>

    <div class="actions-admin" style="margin-top:8px;">
      ${peutModifier ? '<button class="btn-modifier-event">Modifier</button><button class="btn-supprimer-event">Supprimer</button><button class="btn-voir-contacts-event">Voir les coordonnées</button>' : ''}
    </div>
    <div class="zone-contacts-event" hidden></div>
  `;

  if (event.necessite_validation_presence && !event.est_moi) {
    initZoneScanCivique(zone.querySelector('.carte-scan-civique'), event.id);
  }
  zone.querySelector('.btn-gerer-presences')?.addEventListener('click', () => {
    const zonePresences = zone.querySelector('.zone-validation-presences');
    if (!zonePresences.hidden) { zonePresences.hidden = true; return; }
    ouvrirPanneauValidationPresences(zonePresences, event.id);
  });

  const zoneParticipants = zone.querySelector('.zone-participants-repliable');
  zone.querySelector('.btn-toggle-participants').addEventListener('click', (e) => {
    const ouvert = zoneParticipants.hidden;
    zoneParticipants.hidden = !ouvert;
    e.target.textContent = `👥 ${ouvert ? 'Masquer' : 'Voir'} les participants ${ouvert ? '▲' : '▾'}`;
    if (ouvert && !zoneParticipants.dataset.rempli) {
      zoneParticipants.innerHTML = event.participants.length
        ? event.participants.map((p) => `<p class="commentaire">${escapeAttr(p.prenom)} ${escapeAttr(p.nom)}</p>`).join('')
        : `<p class="dechets-vide">Personne pour l'instant.</p>`;
      zoneParticipants.dataset.rempli = 'true';
    }
  });

  zone.querySelector('.btn-participer')?.addEventListener('click', () => ouvrirDialogueParticipation(event));

  zone.querySelector('.btn-modifier-event')?.addEventListener('click', () => ouvrirEditionEvent(event));
  zone.querySelector('.btn-supprimer-event')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cet événement ?')) return;
    await appelApi(`/${window.COMMUNE_SLUG}/agenda/${event.id}`, { method: 'DELETE' });
    chargerAgenda();
  });

  zone.querySelector('.btn-voir-contacts-event')?.addEventListener('click', async () => {
    const zoneContacts = zone.querySelector('.zone-contacts-event');
    zoneContacts.hidden = !zoneContacts.hidden;
    if (!zoneContacts.hidden) {
      const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda/${event.id}/contacts`);
      if (!res.ok) { zoneContacts.innerHTML = '<p class="dechets-vide">Non autorisé.</p>'; return; }
      const { participants } = await res.json();
      zoneContacts.innerHTML = participants.length
        ? participants.map((p) => `
            <p class="commentaire">${escapeAttr(p.prenom)} ${escapeAttr(p.nom)}
              ${p.telephone ? ' · 📞 ' + escapeAttr(p.telephone) : ''}
              ${p.email ? ' · ✉️ ' + escapeAttr(p.email) : ''}
            </p>`).join('')
        : `<p class="dechets-vide">Aucun participant avec coordonnées.</p>`;
    }
  });
}

function ouvrirDialogueParticipation(event) {
  if (event.je_participe) {
    envoyerParticipation(event.id, {});
    return;
  }
  const telephone = prompt('Laisser un numéro de téléphone (optionnel, pour être contacté par l\'organisateur) :') || '';
  const email = prompt('Ou une adresse email (optionnel) :') || '';
  envoyerParticipation(event.id, { contact_telephone: telephone.trim() || undefined, contact_email: email.trim() || undefined });
}

async function envoyerParticipation(eventId, contact) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda/${eventId}/participer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contact),
  });
  const data = await res.clone().json().catch(() => null);
  if (res.ok) traiterRecompense(data);
  else if (data?.erreur) afficherToastMessage(data.erreur, 'erreur');
  chargerAgenda();
}

// ── Type d'action civique (points de participation citoyenne) — réservé aux gestionnaires,
// voir la garde côté serveur dans worker/src/routes/agenda.ts (POST / et PATCH /:id). ──

const OPTIONS_TYPE_ACTION = [
  { valeur: '', label: 'Événement classique (pas de suivi de présence)' },
  { valeur: 'reunion', label: '🏛️ Réunion publique / conseil de quartier' },
  { valeur: 'reunion_conseil', label: '🏛️ Réunion du conseil citoyen' },
  { valeur: 'atelier', label: '🎨 Atelier de concertation' },
  { valeur: 'nettoyage', label: '🧹 Nettoyage citoyen' },
  { valeur: 'plantation', label: '🌱 Plantation / jardin partagé' },
  { valeur: 'maraude', label: '🤝 Maraude solidaire' },
  { valeur: 'chantier', label: '🔨 Chantier participatif' },
  { valeur: 'aide_ponctuelle', label: '🙋 Aide ponctuelle' },
];

function htmlChampTypeAction(prefixe, valeurActuelle) {
  return `
    <div class="bloc-action-civique">
      <label class="label-champ-edition">🌍 Type d'action citoyenne (optionnel)</label>
      <select id="type-action-${prefixe}">
        ${OPTIONS_TYPE_ACTION.map((o) => `<option value="${o.valeur}" ${o.valeur === (valeurActuelle || '') ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>
      <p class="aide-action-civique">Si renseigné, les participants devront scanner un QR code sur place pour valider leur présence et gagner des points de participation citoyenne.</p>
    </div>
  `;
}
function lireChampTypeAction(corps, prefixe) {
  return corps.querySelector(`#type-action-${prefixe}`).value || undefined;
}

// ── Aide date/heure : décompose une date/heure de début/fin optionnelle en horodatages,
// avec des valeurs par défaut sensées (pas d'heure = toute la journée ; pas d'heure de fin
// = +1h après le début). Aucun changement côté backend nécessaire : tout se calcule ici. ──

function versDateLocale(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function versHeureLocale(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function calculerDatesEvenement(date, heureDebut, dateFin, heureFin) {
  const finEffective = dateFin || date;
  if (heureDebut) {
    const debut = new Date(`${date}T${heureDebut}`);
    let fin;
    if (heureFin) {
      fin = new Date(`${finEffective}T${heureFin}`);
    } else {
      fin = new Date(debut);
      fin.setHours(fin.getHours() + 1); // pas d'heure de fin précisée : +1h par défaut
    }
    return { date_debut: debut.toISOString(), date_fin: fin.toISOString() };
  }
  // Pas d'heure du tout : événement "toute la journée"
  return {
    date_debut: new Date(`${date}T00:00:00`).toISOString(),
    date_fin: new Date(`${finEffective}T23:59:59`).toISOString(),
  };
}

function decomposerDatesEvenement(event) {
  const debut = new Date(event.date_debut);
  const fin = new Date(event.date_fin);
  const estJourneeEntiere = debut.getHours() === 0 && debut.getMinutes() === 0 && fin.getHours() === 23 && fin.getMinutes() === 59;
  return {
    date: versDateLocale(debut),
    heureDebut: estJourneeEntiere ? '' : versHeureLocale(debut),
    dateFin: versDateLocale(fin),
    heureFin: estJourneeEntiere ? '' : versHeureLocale(fin),
  };
}

function htmlChampsDateHeure(prefixe, valeurs = {}) {
  return `
    <label class="label-champ-edition">Date</label>
    <input type="date" id="date-${prefixe}" value="${valeurs.date || ''}" required>
    <label class="label-champ-edition">Heure (optionnel — sinon "toute la journée")</label>
    <input type="time" id="heure-debut-${prefixe}" value="${valeurs.heureDebut || ''}">
    <button type="button" id="btn-plus-options-${prefixe}" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);font-size:12px;padding:6px 10px;margin-top:6px;">+ Heure de fin / plusieurs jours</button>
    <div id="options-avancees-${prefixe}" ${(valeurs.heureFin || (valeurs.dateFin && valeurs.dateFin !== valeurs.date)) ? '' : 'hidden'}>
      <label class="label-champ-edition">Heure de fin</label>
      <input type="time" id="heure-fin-${prefixe}" value="${valeurs.heureFin || ''}">
      <label class="label-champ-edition">Date de fin (si sur plusieurs jours)</label>
      <input type="date" id="date-fin-${prefixe}" value="${valeurs.dateFin || ''}">
    </div>
  `;
}

function initToggleOptionsAvancees(corps, prefixe) {
  corps.querySelector(`#btn-plus-options-${prefixe}`).addEventListener('click', () => {
    const zone = corps.querySelector(`#options-avancees-${prefixe}`);
    zone.hidden = !zone.hidden;
  });
}

function lireChampsDateHeure(corps, prefixe) {
  return calculerDatesEvenement(
    corps.querySelector(`#date-${prefixe}`).value,
    corps.querySelector(`#heure-debut-${prefixe}`).value,
    corps.querySelector(`#date-fin-${prefixe}`).value,
    corps.querySelector(`#heure-fin-${prefixe}`).value,
  );
}

function htmlChampPosition(prefixe, lat, lng) {
  return `
    <label class="label-champ-edition">📍 Lieu sur la carte (optionnel)</label>
    <div id="mini-carte-${prefixe}" class="mini-carte-position"></div>
    <button type="button" id="btn-position-${prefixe}" style="background:transparent;color:var(--eau);border:1.5px solid var(--eauL);font-size:12px;padding:6px 10px;margin-top:6px;">📍 Utiliser ma position actuelle</button>
    <p id="position-choisie-${prefixe}" style="font-size:12px;color:var(--roseau);margin-top:4px;">${lat && lng ? 'Position enregistrée — clique sur la carte pour la déplacer.' : 'Clique sur la carte pour placer le lieu (pas besoin d\'être sur place), ou utilise ta position actuelle.'}</p>
    <input type="hidden" id="lat-${prefixe}" value="${lat ?? ''}">
    <input type="hidden" id="lng-${prefixe}" value="${lng ?? ''}">
  `;
}

// La carte se centre sur le lieu déjà enregistré, sinon sur la commune — permet de
// programmer un événement sans être physiquement sur place au moment de la création.
function initBoutonPosition(corps, prefixe, latInitial, lngInitial) {
  const inputLat = corps.querySelector(`#lat-${prefixe}`);
  const inputLng = corps.querySelector(`#lng-${prefixe}`);
  const texteStatut = corps.querySelector(`#position-choisie-${prefixe}`);

  const latDepart = latInitial ?? window.COMMUNE_LAT ?? 43.6047;
  const lngDepart = lngInitial ?? window.COMMUNE_LNG ?? 1.4442;

  const carte = L.map(`mini-carte-${prefixe}`, { maxZoom: 20 }).setView(
    [latDepart, lngDepart],
    latInitial ? 15 : (window.COMMUNE_COORDS_MANQUANTES ? 6 : 13),
  );
  L.tileLayer(
    'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    { attribution: '© IGN-F/Geoportail', maxNativeZoom: 19, maxZoom: 20 },
  ).addTo(carte);

  let marqueur = latInitial && lngInitial ? L.marker([latInitial, lngInitial]).addTo(carte) : null;

  const definirPosition = (lat, lng) => {
    inputLat.value = lat;
    inputLng.value = lng;
    if (marqueur) marqueur.setLatLng([lat, lng]);
    else marqueur = L.marker([lat, lng]).addTo(carte);
    texteStatut.textContent = 'Position enregistrée.';
  };

  carte.on('click', (e) => definirPosition(e.latlng.lat, e.latlng.lng));

  corps.querySelector(`#btn-position-${prefixe}`).addEventListener('click', () => {
    if (!navigator.geolocation) { afficherToastMessage('Géolocalisation indisponible.', 'erreur'); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      definirPosition(position.coords.latitude, position.coords.longitude);
      carte.setView([position.coords.latitude, position.coords.longitude], 15);
    }, () => afficherToastMessage('Impossible de récupérer la position.', 'erreur'));
  });

  // La carte est créée dans une modale tout juste insérée dans le DOM : Leaflet a besoin
  // d'un invalidateSize() une fois le conteneur réellement visible, sinon les tuiles restent
  // grisées ou mal alignées (bug classique de Leaflet dans un conteneur caché/animé).
  setTimeout(() => carte.invalidateSize(), 80);
}

function ouvrirEditionEvent(event) {
  const valeurs = decomposerDatesEvenement(event);
  const estGestionnaireAgenda = ['admin', 'elu', 'superadmin'].includes(window.ROLE);
  const html = `
    <form id="form-modale-edition-event">
      <label class="label-champ-edition">Titre</label>
      <input type="text" id="titre-edition-event-modale" value="${escapeAttr(event.titre)}" maxlength="150">

      <label class="label-champ-edition">Description</label>
      <textarea id="description-edition-event-modale">${escapeAttr(event.description || '')}</textarea>

      <label class="label-champ-edition">Lieu</label>
      <input type="text" id="lieu-edition-event-modale" value="${escapeAttr(event.lieu || '')}" placeholder="Lieu">

      ${htmlChampsDateHeure('edition-event-modale', valeurs)}
      ${htmlChampPosition('edition-event-modale', event.lat, event.lng)}
      ${estGestionnaireAgenda ? htmlChampTypeAction('edition-event-modale', event.type_action) : ''}

      <button type="submit" style="margin-top:12px;">✓ Enregistrer</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Modifier l\'événement', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  initToggleOptionsAvancees(corps, 'edition-event-modale');
  initBoutonPosition(corps, 'edition-event-modale', event.lat, event.lng);

  corps.querySelector('#form-modale-edition-event').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-edition-event-modale').value.trim();
    const description = corps.querySelector('#description-edition-event-modale').value.trim();
    const lieu = corps.querySelector('#lieu-edition-event-modale').value.trim();
    if (!titre) return;
    const { date_debut, date_fin } = lireChampsDateHeure(corps, 'edition-event-modale');
    const lat = corps.querySelector('#lat-edition-event-modale').value;
    const lng = corps.querySelector('#lng-edition-event-modale').value;
    const typeAction = estGestionnaireAgenda ? lireChampTypeAction(corps, 'edition-event-modale') : undefined;

    const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titre, description, lieu, date_debut, date_fin,
        ...(lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : {}),
        ...(estGestionnaireAgenda ? { type_action: typeAction ?? '' } : {}),
      }),
    });
    if (res.ok) { fermerModaleFormulaire(overlay); chargerAgenda(); }
    else { const data = await res.json(); afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur', 'erreur'); }
  });
}

function initFormulaireAgenda() {
  const btn = document.getElementById('btn-ouvrir-creation-agenda');
  if (!btn) return;
  btn.addEventListener('click', () => ouvrirModaleCreationAgenda());
}

function ouvrirModaleCreationAgenda() {
  const estGestionnaireAgenda = ['admin', 'elu', 'superadmin'].includes(window.ROLE);
  const html = `
    <form id="form-modale-agenda">
      <input type="text" id="titre-agenda-modale" placeholder="Titre" maxlength="150" required>
      <textarea id="description-agenda-modale" placeholder="Description"></textarea>
      <input type="text" id="lieu-agenda-modale" placeholder="Lieu (texte)">
      <input type="file" id="image-agenda-modale" accept="image/*">
      ${htmlChampsDateHeure('agenda-modale')}
      ${htmlChampPosition('agenda-modale')}
      ${estGestionnaireAgenda ? htmlChampTypeAction('agenda-modale') : ''}
      <button type="submit" style="margin-top:12px;">Créer</button>
    </form>
  `;
  const overlay = ouvrirModaleFormulaire('Proposer un événement', html);
  const corps = overlay.querySelector('.corps-modale-formulaire');
  initToggleOptionsAvancees(corps, 'agenda-modale');
  initBoutonPosition(corps, 'agenda-modale');

  corps.querySelector('#form-modale-agenda').addEventListener('submit', async (e) => {
    e.preventDefault();
    const titre = corps.querySelector('#titre-agenda-modale').value.trim();
    const description = corps.querySelector('#description-agenda-modale').value.trim();
    const lieu = corps.querySelector('#lieu-agenda-modale').value.trim();
    if (!titre) return;
    const { date_debut, date_fin } = lireChampsDateHeure(corps, 'agenda-modale');
    const lat = corps.querySelector('#lat-agenda-modale').value;
    const lng = corps.querySelector('#lng-agenda-modale').value;
    const typeAction = estGestionnaireAgenda ? lireChampTypeAction(corps, 'agenda-modale') : undefined;

    let r2Key;
    const fichier = corps.querySelector('#image-agenda-modale').files[0];
    if (fichier) {
      try {
        const compresse = await compresserImage(fichier);
        const resUpload = await appelApi(`/${window.COMMUNE_SLUG}/agenda/upload`, {
          method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: compresse,
        });
        if (resUpload.ok) { const { key } = await resUpload.json(); r2Key = key; }
      } catch { console.warn('Upload image échoué, événement publié sans image.'); }
    }

    const res = await creerEvent(titre, description, lieu, date_debut, date_fin, r2Key, lat, lng, typeAction);
    if (res.ok) {
      fermerModaleFormulaire(overlay);
    } else {
      const data = await res.json();
      afficherToastMessage(data.erreur ? JSON.stringify(data.erreur) : 'Erreur de création', 'erreur');
    }
  });
}

async function creerEvent(titre, description, lieu, dateDebut, dateFin, r2Key, lat, lng, typeAction) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titre, description, lieu, date_debut: dateDebut, date_fin: dateFin, r2_key: r2Key,
      ...(lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : {}),
      ...(typeAction ? { type_action: typeAction } : {}),
    }),
  });
  if (res.ok) chargerAgenda();
  return res;
}
