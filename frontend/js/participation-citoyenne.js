// frontend/js/participation-citoyenne.js
// Présence citoyenne vérifiée (scan QR + validation humaine), distincte de la simple
// inscription "je participe" gérée dans agenda.js. Voir worker/src/lib/points-citoyens.ts.
// Aucun point n'est jamais calculé ici : le serveur seul décide, ce module ne fait
// qu'afficher ce qu'il renvoie.

const LABELS_STATUT_PRESENCE = {
  inscrit: 'En attente de scan',
  scanne: 'Scanné, à valider',
  confirme: 'Confirmé ✓',
  non_confirme: 'Non confirmé',
  no_show: 'Absence',
  desiste_a_temps: 'Désisté(e)',
  desiste_tardif: 'Désisté(e) tardivement',
};

// ── Côté citoyen : scanner sa présence sur place ──

function renderZoneScanCivique(event) {
  const statut = event.ma_participation_citoyenne;
  if (statut === 'confirme') {
    return `<span class="pill-statut-presence pill-statut-confirme">✓ Présence confirmée</span>`;
  }
  if (statut === 'non_confirme') {
    return `
      <span class="pill-statut-presence pill-statut-non_confirme">Non confirmée</span>
      <p class="aide-action-civique" style="margin-top:8px;">Tu penses vraiment y être allé·e ? Signale-le, un superadmin va vérifier.</p>
      <button type="button" class="btn-contester-presence">Contester</button>
    `;
  }
  if (statut === 'scanne') {
    return `
      <span class="pill-statut-presence pill-statut-scanne">Scanné</span>
      <p class="aide-action-civique" style="margin-top:8px;">En attente de validation par l'organisateur.</p>
    `;
  }
  return `
    <button type="button" class="btn-scanner-civique">📷 Scanner ma présence sur place</button>
    <div class="zone-scanner-civique"></div>
    <form class="form-code-manuel-civique">
      <input type="text" placeholder="Code manuel (si scan impossible)">
      <button type="button" class="btn-code-manuel-civique">Valider</button>
    </form>
  `;
}

function initZoneScanCivique(zone, eventId) {
  zone.querySelector('.btn-scanner-civique')?.addEventListener('click', () => {
    const zoneCam = zone.querySelector('.zone-scanner-civique');
    zoneCam.id = `zone-scanner-civique-${eventId}`;
    demarrerScannerQr(zoneCam.id, (token) => envoyerScanCivique(eventId, token));
  });

  zone.querySelector('.btn-code-manuel-civique')?.addEventListener('click', () => {
    const input = zone.querySelector('.form-code-manuel-civique input');
    const code = input.value.trim();
    if (code) envoyerScanCivique(eventId, code);
    input.value = '';
  });

  zone.querySelector('.btn-contester-presence')?.addEventListener('click', async () => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda/${eventId}/contester`, { method: 'POST' });
    const data = await res.json();
    afficherToastMessage(res.ok ? 'Contestation envoyée — un superadmin va vérifier.' : (data.erreur || 'Erreur'), res.ok ? 'succes' : 'erreur');
    if (res.ok) chargerAgenda();
  });
}

async function envoyerScanCivique(eventId, qrToken) {
  const position = await new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000 },
    );
  });

  const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda/${eventId}/scanner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qr_token: qrToken, ...(position || {}) }),
  });
  const data = await res.json();
  if (res.ok) {
    afficherToastMessage('Présence déclarée ✅ — en attente de validation par l\'organisateur.', 'succes');
    chargerAgenda();
  } else {
    afficherToastMessage(data.erreur || 'Erreur lors du scan', 'erreur');
  }
}

// ── Côté organisateur/élu/superadmin : valider les présences scannées ──

async function ouvrirPanneauValidationPresences(zone, eventId) {
  zone.hidden = false;
  zone.innerHTML = `<p class="dechets-vide">Chargement…</p>`;
  const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda/${eventId}/participations-citoyennes`);
  if (!res.ok) { zone.innerHTML = `<p class="dechets-vide">Impossible de charger les présences.</p>`; return; }
  const data = await res.json();
  renderPanneauValidationPresences(zone, eventId, data);
}

function renderPanneauValidationPresences(zone, eventId, data) {
  const pct = data.total ? Math.round((data.total_confirmes / data.total) * 100) : 0;
  const labelRole = {
    elu: '🏛️ Vous validez en tant qu\'élu(e) — bonus de +10 pts pour chaque présence.',
    maire: '🎖️ Vous validez en tant que maire — bonus de +10 pts pour chaque présence.',
    superadmin: '👑 Vous validez en tant que superadmin — pouvoir de correction.',
  };

  zone.innerHTML = `
    <div class="panneau-validation-presences">
      ${labelRole[data.role_validateur] ? `<p class="note-role-validateur">${labelRole[data.role_validateur]}</p>` : ''}
      ${data.alerte_audit ? `<p class="alerte-audit-presences">⚠️ Beaucoup de présences validées ici sans aucun scan — à vérifier.</p>` : ''}
      <p class="progression-presences">${data.total_confirmes} / ${data.total} confirmé(s)</p>
      <div class="jauge"><div class="jauge-remplie" style="width:${pct}%"></div></div>
      <input type="text" class="filtre-participants-presences" placeholder="Rechercher un participant…">
      ${data.total_confirmes < data.total ? '<button type="button" class="btn-valider-tous-presences">✓ Valider tous les scannés</button>' : ''}
      <div class="liste-participants-presences"></div>
    </div>
  `;

  const listeEl = zone.querySelector('.liste-participants-presences');
  const rendreListe = (filtre = '') => {
    const f = filtre.trim().toLowerCase();
    const participants = data.participations.filter((p) => !f || `${p.prenom} ${p.nom}`.toLowerCase().includes(f));
    listeEl.innerHTML = participants.length
      ? participants.map(renderLigneParticipantPresence).join('')
      : `<p class="dechets-vide">Aucun participant.</p>`;
    listeEl.querySelectorAll('.btn-valider-participant-presence').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await validerParticipationCivique(eventId, btn.dataset.pid);
        await ouvrirPanneauValidationPresences(zone, eventId);
      });
    });
  };
  rendreListe();
  zone.querySelector('.filtre-participants-presences').addEventListener('input', (e) => rendreListe(e.target.value));

  zone.querySelector('.btn-valider-tous-presences')?.addEventListener('click', async () => {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda/${eventId}/participations-citoyennes/valider-tous`, { method: 'POST' });
    if (res.ok) {
      const resultat = await res.json();
      afficherToastMessage(`${resultat.nombre_valides} présence(s) validée(s) — ${resultat.points_totaux} pts distribués.`, 'succes');
    }
    await ouvrirPanneauValidationPresences(zone, eventId);
  });
}

function renderLigneParticipantPresence(p) {
  return `
    <div class="ligne-toggle-onglet ligne-participant-presence">
      <span>${escapeAttr(p.prenom)} ${escapeAttr(p.nom)}${p.hors_geofence ? ' <span title="Scan loin du lieu de l\'action">⚠️</span>' : ''}${p.contestee_le ? ' <span title="Contestée par le citoyen">🚩</span>' : ''}</span>
      <span class="actions-ligne-presence">
        <span class="pill-statut-presence pill-statut-${p.statut}">${LABELS_STATUT_PRESENCE[p.statut] ?? p.statut}</span>
        ${p.statut === 'scanne' ? `<button type="button" class="btn-valider-participant-presence" data-pid="${p.id}">Valider</button>` : ''}
      </span>
    </div>
  `;
}

async function validerParticipationCivique(eventId, participationId) {
  const res = await appelApi(`/${window.COMMUNE_SLUG}/agenda/${eventId}/participations-citoyennes/${participationId}/valider`, { method: 'PATCH' });
  const data = await res.json();
  if (res.ok) {
    if (data.points_gagnes) afficherToastMessage(`Présence validée — +${data.points_gagnes} pts`, 'succes');
  } else {
    afficherToastMessage(data.erreur || 'Erreur de validation', 'erreur');
  }
}
