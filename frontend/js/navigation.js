// frontend/js/navigation.js
async function initUtilisateur() {
  try {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/auth/me`);
    // Utilisateur arrivé sur une commune qui n'est pas la sienne (URL modifiée à la main,
    // mauvais lien...) : le serveur refuse (403) et indique sa vraie commune. On l'y renvoie.
    if (res.status === 403) {
      const err = await res.json().catch(() => ({}));
      if (err.votre_commune && err.votre_commune !== window.COMMUNE_SLUG) {
        window.location.href = `/${err.votre_commune}/`;
      }
      return;
    }
    if (!res.ok) return;
    const data = await res.json();
    window.USER_ID = data.user_id;
    window.ROLE = data.role;

    // Série de connexion comptée ici (ouverture de l'app) : si des badges de palier / une montée
    // de niveau viennent d'être débloqués, on les met en attente de célébration (jouée à la fin
    // de initApp, comme les récompenses du login). On n'écrase pas celles déjà posées au login.
    if (((data.nouveaux_badges && data.nouveaux_badges.length) || data.monte_de_niveau || data.streak_du_jour)
        && !sessionStorage.getItem('agora_recompenses_connexion')) {
      sessionStorage.setItem('agora_recompenses_connexion', JSON.stringify({
        nouveaux_badges: data.nouveaux_badges || [],
        monte_de_niveau: !!data.monte_de_niveau,
        niveau: data.niveau,
        streak_du_jour: !!data.streak_du_jour,
        streak_actuel: data.streak_actuel,
      }));
    }
    document.body.classList.toggle('est-admin', ['admin', 'elu', 'maire', 'superadmin'].includes(data.role));
    document.body.classList.toggle('est-gestionnaire-roles', ['elu', 'maire', 'superadmin'].includes(data.role));
    document.body.classList.toggle('est-superadmin', data.role === 'superadmin');

    const peutVoirModeration = ['admin', 'elu', 'maire', 'superadmin'].includes(data.role);
    document.querySelectorAll('[data-onglet="moderation"]').forEach((btn) => {
      btn.style.display = peutVoirModeration ? '' : 'none';
    });
  } catch {}
}

async function initVisibiliteOnglets() {
  try {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/moderation/onglets`);
    if (!res.ok) return;
    const { onglets } = await res.json();

    const CORRESPONDANCE = {
      actualites: 'actualites', alertes: 'alertes', thermometre: 'thermometre',
      mur: 'mur', agenda: 'agenda', coups_de_main: 'coups-de-main',
      chasse_tresor: 'chasse-tresor', conseil: 'conseil', profil: 'profil',
      annuaire: 'annuaire', bulletin: 'bulletin', photo_du_jour: 'photo-du-jour', enigmes: 'enigmes',
      lois: 'lois', memoire: 'memoire',
    };

    onglets.forEach(({ cle, actif }) => {
      const cleHtml = CORRESPONDANCE[cle];
      if (!cleHtml || actif) return;
      document.querySelectorAll(`[data-onglet="${cleHtml}"], [data-sousonglet="${cleHtml}"]`).forEach((btn) => {
        btn.style.display = 'none';
      });
    });
  } catch {}
}

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
    window.COMMUNE_LOGO_URL = commune.logo_url ?? null;
    if (commune.nom) document.getElementById('nom-commune').textContent = commune.nom;
    appliquerTheme(commune);
  } catch {}
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
  memoire: () => chargerMemoire(),
  profil: () => { chargerProfil(); initReglagesNotificationsProfil(); initSectionInstallationProfil(); },
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

  // Bouton retour du téléphone (voir aussi le popstate dans utils.js) : depuis un onglet ≠
  // Accueil, un seul niveau d'historique suffit (Accueil ↔ onglet courant), qu'on pousse en
  // le quittant et qu'on consomme en y revenant — que ce soit via un clic direct sur "Accueil"
  // ou via le bouton retour lui-même.
  if (cle !== 'accueil' && !history.state?.agoraOnglet) {
    history.pushState({ agoraOnglet: true }, '');
  } else if (cle === 'accueil' && history.state?.agoraOnglet) {
    history.back();
  }

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
  initToggleCarteAutourDeMoi();
  initSousOngletsAgenda();
  initFormulaireMur();
  initFormulaireChasse();
  initFormulaireCoupDeMain();
  initFormulaireDechets();
  initFormulaireSondage();
  initFormulaireDeliberation();
  initFormulairePv();
  initFormulaireMembreConseil();
  initFormulaireProchainConseil();
  initFormulaireAnnuaire();
  initFormulaireBulletin();
  initFormulairePhotoDuJour();
  initFormulaireMemoire();
  initFormulaireEnigme();
  initSousOngletsChasse();
  initVoletSeuilPhoto();
  initVoletLogo();
  initVoletCouleurs();
  initVoletEnigme();
  initVoletMur();
  initVoletRgpd();
  initVoletRegional();
  initVoletSyncLois();
  initVoletsGeneriquesModeration();
  initFormulaireInfosMairie();
  initFormulaireBadgeCitoyen();
  initBoutonDeconnexionProfil();
  initTogglesCategoriesProfil();
  initBadgeEntete();
  await initServiceWorker();
  initOnboardingPwa();
  initLiensDirectsNotification();
  initFormulaireLoi();
  activerOnglet('accueil');
  celebrerRecompensesConnexion();
})();

// Récompenses débloquées lors de la connexion (badges de série de connexion, montée de niveau
// via l'XP quotidien) : stockées par connexion.html dans sessionStorage, célébrées ici une fois
// l'app chargée. Petit délai pour laisser l'accueil s'afficher avant l'animation.
function celebrerRecompensesConnexion() {
  const brut = sessionStorage.getItem('agora_recompenses_connexion');
  if (!brut) return;
  sessionStorage.removeItem('agora_recompenses_connexion');
  let recompenses;
  try { recompenses = JSON.parse(brut); } catch { return; }
  setTimeout(() => {
    if (recompenses.streak_du_jour) celebrerStreakConnexion(recompenses.streak_actuel);
    if (recompenses.monte_de_niveau) celebrerMonteeNiveau(recompenses.niveau);
    (recompenses.nouveaux_badges || []).forEach((cle) => mettreEnFileBadge(cle));
  }, 700);
}
