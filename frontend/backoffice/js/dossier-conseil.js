// frontend/backoffice/js/dossier-conseil.js — remplit le dossier pour le conseil municipal
// (dossier-conseil.html) : nom de la commune, département, lien + QR vers l'app, texte prêt à
// publier. Réutilise l'endpoint public de l'affiche citoyenne (/api/backoffice/affiche-citoyens-
// contenu?slug=..., voir worker/src/backoffice/modele-affiche.ts), qui renvoie nom + département.
// Le slug vient de l'URL ; à défaut, de la dernière commune ouverte sur cet appareil (même clé
// localStorage que frontend/js/config.js) — c'est ce qui permet au lien des réglages de l'app
// de fonctionner sans connaître le slug.
(function () {
  const params = new URLSearchParams(location.search);
  let memorisee = '';
  try { memorisee = localStorage.getItem('agora_derniere_commune') || ''; } catch { /* stockage bloqué */ }
  const slug = (params.get('slug') || memorisee || '').trim();
  const fondatrice = params.get('programme') === 'fondatrice';
  const urlApp = `${location.origin}/${slug}/`;
  const urlAffichee = `plateforme-agora.fr/${slug}/`;
  const urlAffiche = `plateforme-agora.fr/backoffice/affiche-citoyens?slug=${slug}`;
  const CONTACT = 'Léandre Sallé · contact@plateforme-agora.fr · 06 48 06 10 97';

  // Codes INSEE des départements → nom, pour l'en-tête de la délibération.
  const DEPARTEMENTS = {
    '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes',
    '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', '10': 'Aube', '11': 'Aude',
    '12': 'Aveyron', '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
    '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '2A': 'Corse-du-Sud', '2B': 'Haute-Corse',
    '21': "Côte-d'Or", '22': "Côtes-d'Armor", '23': 'Creuse', '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme',
    '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers',
    '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre', '37': 'Indre-et-Loire',
    '38': 'Isère', '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire',
    '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère',
    '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne',
    '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord',
    '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques',
    '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône',
    '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie',
    '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines', '79': 'Deux-Sèvres',
    '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var', '84': 'Vaucluse', '85': 'Vendée',
    '86': 'Vienne', '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort',
    '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': "Val-d'Oise",
    '971': 'Guadeloupe', '972': 'Martinique', '973': 'Guyane', '974': 'La Réunion', '976': 'Mayotte',
  };

  const remplirTexte = (selecteur, texte) => {
    document.querySelectorAll(selecteur).forEach((el) => { el.textContent = texte; });
  };

  function message(nom) {
    return `📲 ${nom} a désormais son application !\n\n`
      + 'Actualités de la mairie, alertes, agenda des événements, entraide entre voisins : toute la vie de la commune au même endroit, sur votre téléphone.\n\n'
      + `Pour l'installer : scannez le QR code de l'affiche en mairie, ou ouvrez ce lien : ${urlAffichee}\n`
      + "Puis ajoutez-la à votre écran d'accueil et créez votre compte.\n\n"
      + "C'est gratuit et sans publicité. Besoin d'aide ? Passez à la mairie, on vous accompagne.";
  }

  function rendre(communeNom, departement) {
    const nom = communeNom || params.get('nom') || 'votre commune';
    document.title = `Agora — Dossier pour le conseil municipal · ${nom}`;

    remplirTexte('[data-commune]', nom);
    remplirTexte('[data-commune-maj]', nom.toLocaleUpperCase('fr-FR'));
    remplirTexte('[data-url]', urlAffichee);
    remplirTexte('[data-url-affiche]', urlAffiche);
    remplirTexte('[data-contact]', CONTACT);
    remplirTexte('[data-message]', message(nom));

    const code = (departement || '').toUpperCase();
    const nomDep = DEPARTEMENTS[code];
    remplirTexte('[data-departement-ligne]', nomDep ? ` — ${nomDep.toLocaleUpperCase('fr-FR')} (${code})` : '');

    document.querySelectorAll('[data-fondatrice]').forEach((el) => { el.hidden = !fondatrice; });

    if (slug && typeof qrcode === 'function') {
      const qr = qrcode(0, 'M');
      qr.addData(urlApp);
      qr.make();
      const svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      document.querySelectorAll('[data-qr]').forEach((el) => { el.innerHTML = svg; });
    }
  }

  (async function () {
    let communeNom = null, departement = null;
    if (slug) {
      try {
        const d = await fetch('/api/backoffice/affiche-citoyens-contenu?slug=' + encodeURIComponent(slug)).then((r) => r.json());
        communeNom = d.commune_nom || null;
        departement = d.departement || null;
      } catch { /* réseau KO : on rend quand même avec le nom passé en paramètre */ }
    }
    rendre(communeNom, departement);
  })();
})();
