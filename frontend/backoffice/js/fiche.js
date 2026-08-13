// frontend/backoffice/js/fiche.js — remplit la fiche de présentation à partir des paramètres
// d'URL (?slug=...&nom=...) et génère le QR code vers l'app de la commune (encodeur vendoré,
// sans plafond de longueur, contrairement au générateur QR du Worker).
(function () {
  const params = new URLSearchParams(location.search);
  const slug = (params.get('slug') || 'eaucourt').trim();
  const nom = (params.get('nom') || 'votre commune').trim();

  const urlApp = `${location.origin}/${slug}/`;
  const urlAffichee = `plateforme-agora.fr/${slug}/`;

  document.getElementById('nom-commune').textContent = nom;
  document.getElementById('url-app').textContent = urlAffichee;
  document.title = `Agora — Fiche de présentation · ${nom}`;

  // typeNumber 0 = version auto (s'adapte à la longueur de l'URL), correction 'M'.
  const qr = qrcode(0, 'M');
  qr.addData(urlApp);
  qr.make();
  document.getElementById('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
})();
