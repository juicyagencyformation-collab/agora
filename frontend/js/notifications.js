// frontend/js/notifications.js
let evenementInstallDiffere = null;
let enregistrementSW = null;

// Capté au tout premier niveau du script, avant toute autre initialisation — pour ne
// manquer l'invite d'installation de Chrome sous aucun prétexte si elle se déclenche tôt.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  evenementInstallDiffere = e;

  // Si une interface d'installation est déjà affichée à l'écran au moment où l'événement
  // arrive, on la redessine pour transformer le message de secours en vrai bouton actif.
  const banniere = document.getElementById('banniere-onboarding-pwa');
  if (banniere && !banniere.hidden) afficherBanniereOnboarding();

  const sectionProfil = document.getElementById('section-installation-profil');
  if (sectionProfil?.innerHTML.trim()) initSectionInstallationProfil();
});

function estIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

function estDejaInstallee() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function urlBase64VersUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const donneesBrutes = atob(base64);
  return Uint8Array.from([...donneesBrutes].map((c) => c.charCodeAt(0)));
}

async function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    enregistrementSW = await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('Échec d\'enregistrement du Service Worker :', err);
  }
}

// ── Lien direct depuis une notification vers l'élément précis concerné ──
// (article déplié, ou écran de détail Chasse/Énigme), plutôt que juste ouvrir l'onglet général.

function initLiensDirectsNotification() {
  // App déjà ouverte au moment du clic : le Service Worker nous transmet la cible.
  navigator.serviceWorker?.addEventListener('message', (event) => {
    if (event.data?.type === 'notification-click') {
      gererLienDirectNotification(new URL(event.data.url, window.location.origin).searchParams);
    }
  });

  // App fraîchement ouverte depuis la notification : la cible est dans l'URL de chargement.
  const params = new URLSearchParams(window.location.search);
  if (params.get('type') && params.get('id')) {
    // On laisse le temps à initApp() de finir sa mise en place avant d'agir.
    window.addEventListener('load', () => setTimeout(() => gererLienDirectNotification(params), 400));
  }
}

async function gererLienDirectNotification(params) {
  const onglet = params.get('onglet');
  const type = params.get('type');
  const id = params.get('id');
  if (!onglet || !type || !id) return;

  activerOnglet(onglet);

  if (type === 'article') {
    await chargerArticles();
    setTimeout(() => ouvrirArticleParId(id), 250);
  } else if (type === 'post') {
    await chargerMur();
    setTimeout(() => ouvrirPostParId(id), 250);
  } else if (type === 'sondage') {
    await chargerThermometre();
    setTimeout(() => ouvrirSondageParId(id), 250);
  } else if (type === 'event') {
    await chargerAgenda();
    setTimeout(() => ouvrirEventParId(id), 250);
  } else if (type === 'annonce') {
    await chargerCoupsDeMain();
    setTimeout(() => ouvrirAnnonceParId(id), 250);
  } else if (type === 'chasse' || type === 'enigme') {
    // Les deux sections (chasses officielles + énigmes photo) sont affichées ensemble sur le
    // même écran : on ouvre le détail visé puis on défile jusqu'à sa section, plutôt que de
    // basculer un sous-onglet qui n'existe plus.
    const estEnigme = type === 'enigme';
    if (estEnigme) {
      await chargerEnigmes();
      setTimeout(() => {
        ouvrirDetailEnigme(id);
        document.getElementById('section-trouve-la-photo')?.scrollIntoView({ block: 'start' });
      }, 250);
    } else {
      await chargerChasses();
      setTimeout(() => {
        ouvrirDetailChasse(id);
        document.getElementById('section-chasses-officielles')?.scrollIntoView({ block: 'start' });
      }, 250);
    }
  }
}

// ── Section "Installer l'application" — toujours visible dans Mon profil, jamais
// masquée définitivement. Instructions volontairement très simples et illustrées,
// pensées pour un public non technophile. ──

function initSectionInstallationProfil() {
  const zone = document.getElementById('section-installation-profil');
  if (!zone) return;

  if (estDejaInstallee()) {
    zone.innerHTML = `
      <p style="font-size:13px;color:var(--prairie);">✅ L'application est déjà installée sur cet appareil, comme une vraie application.</p>
    `;
    return;
  }

  const instructions = estIOS()
    ? `
      <div class="etape-installation-profil">
        <span class="numero-etape">1</span>
        <p>En bas de l'écran, appuie sur le bouton <strong>Partager</strong> <span style="font-size:20px;">⬆️</span></p>
      </div>
      <div class="etape-installation-profil">
        <span class="numero-etape">2</span>
        <p>Fais défiler la liste et appuie sur <strong>"Sur l'écran d'accueil"</strong> <span style="font-size:20px;">➕</span></p>
      </div>
      <div class="etape-installation-profil">
        <span class="numero-etape">3</span>
        <p>Appuie sur <strong>"Ajouter"</strong> en haut à droite. C'est fait !</p>
      </div>
    `
    : `
      <div class="etape-installation-profil">
        <span class="numero-etape">1</span>
        <p>Appuie sur le grand bouton bleu ci-dessous</p>
      </div>
      <div class="etape-installation-profil">
        <span class="numero-etape">2</span>
        <p>Confirme en appuyant sur <strong>"Installer"</strong></p>
      </div>
      <button type="button" id="btn-installer-pwa-profil" class="bouton-ouvrir-modale" style="margin-top:8px;">📲 Installer l'application</button>
    `;

  zone.innerHTML = `
    <p style="font-size:13px;color:var(--roseau);">Pour un accès rapide, comme une vraie application, directement depuis l'écran d'accueil de ton téléphone.</p>
    ${instructions}
  `;

  zone.querySelector('#btn-installer-pwa-profil')?.addEventListener('click', async () => {
    if (!evenementInstallDiffere) {
      afficherToastMessage('Utilise le menu ⋮ de ton navigateur, puis "Installer l\'application" ou "Ajouter à l\'écran d\'accueil".', 'info');
      return;
    }
    evenementInstallDiffere.prompt();
    await evenementInstallDiffere.userChoice;
    evenementInstallDiffere = null;
  });
}

// ── Bannière d'installation + notifications — rappel tous les 3 jours tant que l'app
// n'est pas installée, pour ne jamais laisser quelqu'un sans moyen de la retrouver ──

const TROIS_JOURS_MS = 3 * 24 * 3600 * 1000;

function initOnboardingPwa() {
  if (estDejaInstallee()) {
    // Déjà installée : plus besoin de rappel d'installation, jamais.
    if (Notification?.permission === 'default') afficherBanniereOnboarding();
    return;
  }

  // Pas encore installée : on affiche (ou réaffiche) tant que 3 jours se sont écoulés
  // depuis la dernière fois — jamais fermée "pour toujours".
  const dernierRappel = parseInt(localStorage.getItem('agora_dernier_rappel_install') || '0', 10);
  if (Date.now() - dernierRappel >= TROIS_JOURS_MS) {
    afficherBanniereOnboarding();
  }
}

function afficherBanniereOnboarding() {
  const zone = document.getElementById('banniere-onboarding-pwa');
  if (!zone) return;

  const etapeInstall = estDejaInstallee()
    ? ''
    : estIOS()
      ? `
        <div class="etape-onboarding">
          <strong>1. Installe l'app sur ton écran d'accueil</strong>
          <p>Appuie sur <strong>Partager</strong> <span style="font-size:16px;">⬆️</span> en bas de Safari, puis <strong>"Sur l'écran d'accueil"</strong>.</p>
        </div>`
      : `
        <div class="etape-onboarding">
          <strong>1. Installe l'app sur ton téléphone</strong>
          <p>Accès plus rapide, comme une vraie application.</p>
          <button type="button" id="btn-installer-pwa" class="bouton-ouvrir-modale" style="margin:8px 0 0;">📲 Installer l'application</button>
        </div>`;

  zone.innerHTML = `
    <div class="carte-onboarding-pwa">
      <button type="button" class="btn-fermer-modale btn-fermer-onboarding">✕</button>
      <h3 style="margin:0 0 10px;font-family:'Playfair Display',serif;color:var(--eau);">Bienvenue !</h3>
      ${etapeInstall}
      <div class="etape-onboarding">
        <strong>${estDejaInstallee() ? '' : '2. '}Active les notifications</strong>
        <p>Sois prévenu(e) des nouveaux articles, chasses au trésor et énigmes.</p>
        <button type="button" id="btn-activer-notifs-onboarding" class="bouton-ouvrir-modale" style="margin:8px 0 0;background:var(--aube);color:var(--boue);">🔔 Activer les notifications</button>
      </div>
      ${estDejaInstallee() ? '' : '<p style="font-size:10.5px;color:var(--roseau);margin-top:10px;">Tu peux aussi retrouver ces instructions à tout moment dans "Mon profil".</p>'}
    </div>
  `;
  zone.hidden = false;

  zone.querySelector('.btn-fermer-onboarding').addEventListener('click', () => {
    zone.hidden = true;
    localStorage.setItem('agora_dernier_rappel_install', Date.now().toString());
  });

  zone.querySelector('#btn-installer-pwa')?.addEventListener('click', async () => {
    if (!evenementInstallDiffere) {
      afficherToastMessage('Utilise le menu ⋮ de ton navigateur, puis "Installer l\'application".', 'info');
      return;
    }
    evenementInstallDiffere.prompt();
    await evenementInstallDiffere.userChoice;
    evenementInstallDiffere = null;
  });

  zone.querySelector('#btn-activer-notifs-onboarding').addEventListener('click', async () => {
    const ok = await activerNotifications();
    if (ok) {
      zone.hidden = true;
      localStorage.setItem('agora_dernier_rappel_install', Date.now().toString());
      afficherToastMessage('Notifications activées ! 🔔', 'succes');
    }
  });

  localStorage.setItem('agora_dernier_rappel_install', Date.now().toString());
}


// ── Activation / désactivation des notifications (réutilisé par l'onboarding et Mon profil) ──

async function activerNotifications() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    // Sur iPhone, Safari n'expose les notifications que si l'app tourne depuis l'écran
    // d'accueil (comme installée) — sinon 'Notification'/'PushManager' n'existent tout
    // simplement pas, quelle que soit la version d'iOS. On guide vers l'installation plutôt
    // que d'afficher un message générique qui ne dit pas quoi faire.
    if (estIOS() && !estDejaInstallee()) {
      afficherToastMessage('Installe d\'abord l\'application sur ton écran d\'accueil pour activer les notifications 👇', 'info');
      activerOnglet('profil');
      document.getElementById('section-installation-profil')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      afficherToastMessage('Les notifications ne sont pas supportées sur ce navigateur.', 'erreur');
    }
    return false;
  }
  if (!enregistrementSW) await initServiceWorker();
  if (!enregistrementSW) {
    afficherToastMessage('Impossible de préparer les notifications — réessaie dans quelques secondes.', 'erreur');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    afficherToastMessage('Notifications refusées.', 'erreur');
    return false;
  }

  try {
    const abonnement = await enregistrementSW.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64VersUint8Array(window.VAPID_PUBLIC_KEY),
    });
    await appelApi(`/${window.COMMUNE_SLUG}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(abonnement.toJSON()),
    });
    return true;
  } catch (err) {
    console.warn('Échec de l\'abonnement push :', err);
    afficherToastMessage('Impossible d\'activer les notifications.', 'erreur');
    return false;
  }
}

async function desactiverNotifications() {
  if (!enregistrementSW) return;
  const abonnement = await enregistrementSW.pushManager.getSubscription();
  if (!abonnement) return;
  await appelApi(`/${window.COMMUNE_SLUG}/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: abonnement.endpoint }),
  });
  await abonnement.unsubscribe();
}

// ── Section "Notifications" dans Mon profil ──

async function initReglagesNotificationsProfil() {
  const zone = document.getElementById('reglages-notifications-profil');
  if (!zone) return;

  const permissionActuelle = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  // On vérifie l'abonnement PUSH réel, pas seulement la permission navigateur — sinon si un
  // essai précédent a échoué après l'octroi de la permission, le bouton disparaît à tort et
  // on ne peut plus jamais réessayer.
  let abonnementReel = null;
  if (permissionActuelle === 'granted') {
    if (!enregistrementSW) await initServiceWorker();
    abonnementReel = await enregistrementSW?.pushManager.getSubscription();
  }

  const res = await appelApi(`/${window.COMMUNE_SLUG}/push/preferences`);
  const { preferences } = res.ok ? await res.json() : {
    preferences: { notif_articles: true, notif_chasses: true, notif_enigmes: true, notif_mur: true, notif_thermo: true, notif_agenda: true, notif_entraide: true, notif_meteo: false },
  };

  zone.innerHTML = `
    ${abonnementReel
      ? '<p style="font-size:12.5px;color:var(--prairie);">Notifications activées sur cet appareil.</p>'
      : `<button type="button" id="btn-activer-notifs-profil" class="bouton-ouvrir-modale">Activer les notifications sur cet appareil</button>`}
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13.5px;">
      <input type="checkbox" id="pref-notif-articles" style="width:auto;margin:0;" ${preferences.notif_articles ? 'checked' : ''}> 📰 Nouveaux articles
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13.5px;">
      <input type="checkbox" id="pref-notif-chasses" style="width:auto;margin:0;" ${preferences.notif_chasses ? 'checked' : ''}> 🗺️ Nouvelles chasses au trésor
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13.5px;">
      <input type="checkbox" id="pref-notif-enigmes" style="width:auto;margin:0;" ${preferences.notif_enigmes ? 'checked' : ''}> 🧭 Nouvelles énigmes photo
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13.5px;">
      <input type="checkbox" id="pref-notif-mur" style="width:auto;margin:0;" ${preferences.notif_mur ? 'checked' : ''}> 💬 Mur des voisins
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13.5px;">
      <input type="checkbox" id="pref-notif-thermo" style="width:auto;margin:0;" ${preferences.notif_thermo ? 'checked' : ''}> 🌡️ Nouveaux sondages (Thermomètre)
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13.5px;">
      <input type="checkbox" id="pref-notif-agenda" style="width:auto;margin:0;" ${preferences.notif_agenda ? 'checked' : ''}> 📅 Nouveaux événements (Agenda)
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13.5px;">
      <input type="checkbox" id="pref-notif-entraide" style="width:auto;margin:0;" ${preferences.notif_entraide ? 'checked' : ''}> 🤲 Entraide (offres/demandes)
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13.5px;">
      <input type="checkbox" id="pref-notif-meteo" style="width:auto;margin:0;" ${preferences.notif_meteo ? 'checked' : ''}> 🌦️ Résumé météo chaque matin
    </label>
  `;

  zone.querySelector('#btn-activer-notifs-profil')?.addEventListener('click', async () => {
    const ok = await activerNotifications();
    if (ok) { afficherToastMessage('Notifications activées ! 🔔', 'succes'); initReglagesNotificationsProfil(); }
  });

  ['articles', 'chasses', 'enigmes', 'mur', 'thermo', 'agenda', 'entraide', 'meteo'].forEach((cle) => {
    zone.querySelector(`#pref-notif-${cle}`).addEventListener('change', async (e) => {
      await appelApi(`/${window.COMMUNE_SLUG}/push/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [`notif_${cle}`]: e.target.checked }),
      });
    });
  });
}
