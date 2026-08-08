// frontend/js/navigation.js
async function initUtilisateur() {
  try {
    const res = await appelApi(`/${window.COMMUNE_SLUG}/auth/me`);
    if (!res.ok) return;
    const data = await res.json();
    window.USER_ID = data.user_id;
    window.ROLE = data.role;
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
      lois: 'lois',
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
  initFormulaireProchainConseil();
  initFormulaireAnnuaire();
  initFormulaireBulletin();
  initFormulairePhotoDuJour();
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
  initFormulaireBadgeCitoyen();
  initBoutonDeconnexionProfil();
  initTogglesCategoriesProfil();
  await initServiceWorker();
  initOnboardingPwa();
  initLiensDirectsNotification();
  initFormulaireLoi();
  activerOnglet('accueil');
})();
