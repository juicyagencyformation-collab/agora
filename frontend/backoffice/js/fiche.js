// frontend/backoffice/js/fiche.js — remplit la fiche de présentation à partir du modèle éditable
// (backoffice, endpoint public /api/backoffice/fiche-contenu) : substitue {{logo}}, {{commune}},
// {{qr}} (QR vers l'app), {{url}}. Le design/print vit dans fiche.html. QR généré via l'encodeur
// vendoré (sans plafond de longueur, contrairement au générateur du Worker).
// Peut aussi servir d'APERÇU EN DIRECT, embarquée en <iframe> dans Réglages > Modèle de fiche
// (voir synchroniserApercuFiche dans app.js) : le parent poste le brouillon en cours d'édition
// (pas encore enregistré) via postMessage, prioritaire sur le contenu chargé par l'API tant que
// des messages arrivent — permet de voir le vrai rendu sans sauvegarder à chaque essai.
(function () {
  const params = new URLSearchParams(location.search);
  const slug = (params.get('slug') || 'eaucourt').trim();
  const nom = (params.get('nom') || 'votre commune').trim();
  const urlApp = `${location.origin}/${slug}/`;
  const urlAffichee = `plateforme-agora.fr/${slug}/`;
  document.title = `Plateforme-Agora — Fiche de présentation · ${nom}`;

  const echapper = (s) => (s || '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));

  // Onglets actifs de la commune (null = inconnus : toutes les cartes restent). Une carte de module
  // (data-onglet="cle" ou "cle1,cle2") disparaît si aucun de ses onglets n'est actif.
  let ongletsActifs = null;
  function masquerModulesInactifs() {
    if (!ongletsActifs) return;
    document.querySelectorAll('#feuille [data-onglet]').forEach((carte) => {
      const cles = carte.dataset.onglet.split(',').map((c) => c.trim());
      if (!cles.some((c) => ongletsActifs.includes(c))) carte.remove();
    });
  }

  function rendre(contenu, logoUrl) {
    const logoHtml = logoUrl
      ? `<img src="${logoUrl}" alt="Plateforme-Agora" style="max-height:64px;max-width:220px;object-fit:contain" />`
      : '<div class="marque">Plateforme-Agora</div>';

    // QR code vers l'app (typeNumber 0 = version auto selon la longueur de l'URL).
    const qr = qrcode(0, 'M');
    qr.addData(urlApp);
    qr.make();
    const qrSvg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });

    document.getElementById('feuille').innerHTML = (contenu || '')
      .replace(/\{\{logo\}\}/g, logoHtml)
      .replace(/\{\{commune\}\}/g, echapper(nom))
      .replace(/\{\{qr\}\}/g, qrSvg)
      .replace(/\{\{url\}\}/g, echapper(urlAffichee));
    masquerModulesInactifs();
  }

  let apercuActif = false;
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.type !== 'apercu-fiche') return;
    apercuActif = true;
    rendre(e.data.contenu_html, e.data.logo_url);
  });

  (async function () {
    let contenu = '', logoUrl = null;
    try {
      const d = await fetch('/api/backoffice/fiche-contenu?slug=' + encodeURIComponent(slug)).then((r) => r.json());
      contenu = d.contenu_html || '';
      logoUrl = d.logo_url || null;
      ongletsActifs = Array.isArray(d.onglets_actifs) ? d.onglets_actifs : null;
    } catch { /* réseau KO : on affichera au moins le titre par défaut */ }
    // Un message d'aperçu a pu arriver pendant ce fetch : ne pas l'écraser avec le contenu enregistré.
    if (!apercuActif) rendre(contenu, logoUrl);
  })();
})();
