// frontend/backoffice/js/affiche-citoyens.js — remplit l'affiche citoyenne à partir du contenu
// servi par l'endpoint public /api/backoffice/affiche-citoyens-contenu?slug=... (voir
// worker/src/backoffice/modele-affiche.ts) : substitue {{logo}}, {{commune}}, {{qr}}, {{url}}.
// Contrairement à fiche.js, le logo vient de LA COMMUNE (communes.logo_url), pas de la marque
// Agora — voir le commentaire d'en-tête de modele-affiche.ts pour le pourquoi.
(function () {
  const params = new URLSearchParams(location.search);
  const slug = (params.get('slug') || '').trim();
  const urlApp = `${location.origin}/${slug}/`;
  const urlAffichee = `plateforme-agora.fr/${slug}/`;

  const echapper = (s) => (s || '').replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));

  function rendre(contenu, communeNom, logoUrl) {
    const nom = communeNom || params.get('nom') || 'votre commune';
    document.title = `Agora — Affiche citoyenne · ${nom}`;

    const logoHtml = logoUrl
      ? `<img src="${logoUrl}" alt="${echapper(nom)}" style="max-height:100px;max-width:100px;object-fit:contain" />`
      : `<div class="marque">${echapper(nom)}</div>`;

    const qr = qrcode(0, 'M');
    qr.addData(urlApp);
    qr.make();
    const qrSvg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });

    document.getElementById('feuille').innerHTML = (contenu || '')
      .replace(/\{\{logo\}\}/g, logoHtml)
      .replace(/\{\{commune\}\}/g, echapper(nom))
      .replace(/\{\{qr\}\}/g, qrSvg)
      .replace(/\{\{url\}\}/g, echapper(urlAffichee));
  }

  (async function () {
    let contenu = '', communeNom = null, logoUrl = null;
    try {
      const d = await fetch('/api/backoffice/affiche-citoyens-contenu?slug=' + encodeURIComponent(slug)).then((r) => r.json());
      contenu = d.contenu_html || '';
      communeNom = d.commune_nom || null;
      logoUrl = d.logo_url || null;
    } catch { /* réseau KO : on affichera au moins le titre par défaut */ }
    rendre(contenu, communeNom, logoUrl);
  })();
})();
