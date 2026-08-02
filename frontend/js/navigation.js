// frontend/js/navigation.js
async function initUtilisateur() {
  try {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/auth/me`);
    if (!res.ok) return;
    const data = await res.json();
    window.USER_ID = data.user_id;
    window.ROLE = data.role;
    // "est-admin" = peut créer/modifier/supprimer du contenu (admin, élu, superadmin)
    document.body.classList.toggle('est-admin', ['admin', 'elu', 'superadmin'].includes(data.role));
    // "est-gestionnaire-roles" = peut attribuer des rôles (élu, superadmin)
    document.body.classList.toggle('est-gestionnaire-roles', ['elu', 'superadmin'].includes(data.role));
    // "est-superadmin" = seul rôle pouvant désactiver des onglets
    document.body.classList.toggle('est-superadmin', data.role === 'superadmin');

    // Le citoyen ne doit même pas savoir que l'onglet Modération existe
    const peutVoirModeration = ['admin', 'elu', 'superadmin'].includes(data.role);
    document.querySelectorAll('[data-onglet="moderation"]').forEach((btn) => {
      btn.style.display = peutVoirModeration ? '' : 'none';
    });
  } catch {
    // pas connecté ou Worker inaccessible — formulaires admin resteront masqués
  }
}

async function initVisibiliteOnglets() {
  try {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/onglets`);
    if (!res.ok) return;
    const { onglets } = await res.json();

    // Les clés en base utilisent des underscores, les data-onglet HTML des tirets.
    const CORRESPONDANCE = {
      actualites: 'actualites', alertes: 'alertes', thermometre: 'thermometre',
      mur: 'mur', agenda: 'agenda', coups_de_main: 'coups-de-main',
      chasse_tresor: 'chasse-tresor', conseil: 'conseil', profil: 'profil',
      annuaire: 'annuaire', bulletin: 'bulletin', photo_du_jour: 'photo-du-jour', enigmes: 'enigmes',
      lois: 'lois',
    };

    onglets.forEach(({ cle, actif }) => {
      const cleHtml = CORRESPONDANCE[cle];
      if (!cleHtml || actif) return; // actif ou pas de tab correspondant : rien à cacher
      document.querySelectorAll(`[data-onglet="${cleHtml}"], [data-sousonglet="${cleHtml}"]`).forEach((btn) => {
        btn.style.display = 'none';
      });
    });
  } catch {
    // en cas d'échec, on laisse tous les onglets visibles par défaut
  }
}

// Applique les couleurs de la commune aux variables CSS — premier pas vers la personnalisation
// par les élus. Note : seuls --eau (couleur principale) et --aube (accent) sont dynamiques pour
// l'instant ; les teintes dérivées (--eauM/--eauL/--eauXL) restent fixes jusqu'à ce qu'on construise
// un vrai calcul de palette. Suffisant pour un premier jet fonctionnel.
function appliquerTheme(commune) {
  if (commune.couleur_theme) document.documentElement.style.setProperty('--eau', commune.couleur_theme);
  if (commune.couleur_accent) document.documentElement.style.setProperty('--aube', commune.couleur_accent);
}

async function initCommune() {
  try {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/commune`);
    if (!res.ok) return;
    const { commune } = await res.json();
    window.COMMUNE_LAT = commune.lat ?? 43.6047;
    window.COMMUNE_LNG = commune.lng ?? 1.4442;
    window.COMMUNE_COORDS_MANQUANTES = commune.lat === null;
    if (commune.nom) document.getElementById('nom-commune').textContent = commune.nom;
    appliquerTheme(commune);
  } catch {
    // Worker inaccessible : on continue avec les valeurs par défaut
  }
}

const CHARGEURS = {
  accueil: () => chargerDashboard(),
  actualites: () => chargerArticles(),
  alertes: () => initCarteAlertes(),
  thermometre: () => chargerThermometre(),
  mur: () => initMur(),
  agenda: () => chargerAgenda(),
  'coups-de-main': () => chargerCoupsDeMain(),
  'chasse-tresor': () => chargerChasses(),
  conseil: () => chargerConseil(),
  annuaire: () => chargerAnnuaire(),
  bulletin: () => chargerBulletin(),
  'photo-du-jour': () => chargerPhotoDuJour(),
  profil: () => { chargerProfil(); initReglagesNotificationsProfil(); },
  lois: () => chargerLois(),
  moderation: () => chargerPanneauModeration(),
};
const dejaCharges = new Set();

function activerOnglet(cle) {
  document.querySelectorAll('.onglet-contenu').forEach((s) => s.hidden = true);
  document.getElementById(`onglet-${cle}`).hidden = false;

  document.querySelectorAll('.barre-onglets button, .sidebar-nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.onglet === cle);
  });

  // Accueil (dashboard) reflète l'état d'autres onglets (déchets, alertes, agenda...)
  // donc il se recharge à chaque visite plutôt qu'une seule fois.
  if (cle === 'accueil' || cle === 'profil' || !dejaCharges.has(cle)) {
    CHARGEURS[cle]?.();
    dejaCharges.add(cle);
  }
}

document.querySelectorAll('.barre-onglets button, .sidebar-nav button').forEach((btn) => {
  btn.addEventListener('click', () => activerOnglet(btn.dataset.onglet));
});

(async function initApp() {
  await initUtilisateur();
  await initCommune();
  await initVisibiliteOnglets();
  initFormulaireArticle();
  initFormulaireAlerte();
  initFormulaireAgenda();
  initToggleHistoriqueAgenda();
  initToggleCarteAgenda();
  initSousOngletsAgenda();
  initFormulaireMur();
  initFormulaireChasse();
  initFormulaireCoupDeMain();
  initFormulaireDechets();
  initFormulaireSondage();
  initFormulaireDeliberation();
  initFormulairePv();
  initFormulaireAnnuaire();
  initFormulaireBulletin();
  initFormulairePhotoDuJour();
  initFormulaireEnigme();
  initSousOngletsChasse();
  initVoletSeuilPhoto();
  initVoletCouleurs();
  initVoletEnigme();
  initVoletMur();
  initVoletRgpd();
  initVoletRegional();
  initVoletSyncLois();
  await initServiceWorker();
  initOnboardingPwa();
  initLiensDirectsNotification();
  initFormulaireLoi();
  activerOnglet('accueil');
})();
