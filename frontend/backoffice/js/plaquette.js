// frontend/backoffice/js/plaquette.js — rend la plaquette personnalisée d'une commune (plaquette.html).
// Toutes les données (commune, barème, textes des offres, onglets gratuits, offre fondatrice) viennent
// de GET /api/backoffice/plaquette (worker/src/backoffice/plaquette.ts) : rien de chiffré en dur ici.
// Les textes des modules ont été vérifiés dans le code le 2026-11-23 (voir les commentaires) ; toute
// valeur venant de la base est échappée avant d'entrer dans le HTML.
(async function () {
  const params = new URLSearchParams(location.search);
  const zone = document.getElementById('plaquette');
  const chargement = document.getElementById('chargement');
  const etat = document.getElementById('etat');

  const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const euros = (n) => Math.round(n).toLocaleString('fr-FR') + ' €';
  const exact = (n) => { const r = Math.round(n * 100) / 100; return r.toLocaleString('fr-FR', { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 }) + ' €'; };
  const centimes = (n) => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const parHabitant = (an, h) => {
    const c = Math.round(an / 12 / h * 100);
    return c < 100 ? `${c} centime${c > 1 ? 's' : ''} par habitant et par mois` : `${(c / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € par habitant et par mois`;
  };
  const dateLongue = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  // Modules de l'application (clés de TOUS_LES_ONGLETS, worker/src/backoffice/administration.ts).
  const MODULES = {
    actualites: ['Actualités', 'Publier une fois, être lu par tous, photos comprises ; une aide à la rédaction prépare le texte.'],
    agenda: ['Agenda', 'Événements de la mairie, des associations et des commerces, inscription en un clic, ajout au calendrier du téléphone.'],
    alertes: ['Alertes et signalements', "La mairie prévient tout le village par notification ; l'habitant signale un problème avec photo et position."],
    chasse_tresor: ['Chasse au trésor et balades', 'Découvrir le patrimoine du village en jouant, pour les habitants comme pour les visiteurs.'],
    enigmes: ['Énigme photo', '« Où a été prise cette photo ? » Un jeu en famille, ici ou dans les villages voisins.'],
    conseil: ['Conseil municipal', 'Les élus, les séances et les délibérations, accessibles à tous.'],
    thermometre: ['Thermomètre du village', 'Un sondage rapide avant une décision ; les réponses se comptent toutes seules.'],
    mur: ['Mur des voisins', 'Des messages courts entre habitants, effacés au bout de 24 ou 48 heures.'],
    coups_de_main: ['Coups de main', "L'entraide entre voisins : des courses, un trajet, un outil à prêter."],
    annuaire: ['Annuaire, associations et commerces', 'Associations et commerces publient eux-mêmes leurs actualités ; la mairie garde la main (retrait motivé en deux clics, charte de publication).'],
    bulletin: ['Bulletin municipal', 'Un espace pour préparer le bulletin à plusieurs, avec validation par les élus.'],
    photo_du_jour: ['Photo du jour', 'Chaque jour, un cliché de la commune pris par un habitant.'],
    memoire: ['Mémoire du village', "Souvenirs, récits et photos d'autrefois, transmis aux plus jeunes."],
    lois: ['Lois', 'Suivre les textes de loi français et européens et donner son avis : un exercice citoyen, pas un vote officiel.'],
  };
  const ORDRE = ['actualites', 'agenda', 'alertes', 'chasse_tresor', 'enigmes', 'conseil', 'thermometre', 'mur', 'coups_de_main', 'annuaire', 'bulletin', 'photo_du_jour', 'memoire', 'lois'];
  // Écrans réels de la démo Bonvivre (backoffice/plaquette-ecrans/*.jpg) et le module dont chacun dépend.
  const ECRANS = [
    ['accueil', 'Accueil', null], ['actualites', 'Actualités', 'actualites'], ['agenda', 'Agenda', 'agenda'],
    ['alertes', 'Alertes', 'alertes'], ['conseil', 'Conseil municipal', 'conseil'], ['coups-de-main', 'Coups de main', 'coups_de_main'],
    ['photo-du-jour', 'Photo du jour', 'photo_du_jour'], ['chasse-tresor', 'Balades et jeux', 'chasse_tresor'],
  ];

  // Couleur de texte lisible sur la couleur de la commune.
  const encreSur = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#ffffff';
    const v = parseInt(m[1], 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
    return L > 0.4 ? '#1f1b17' : '#ffffff';
  };

  let d;
  try {
    const cle = params.get('prospect') ? 'prospect' : 'commune';
    d = await boFetch('/plaquette?' + cle + '=' + encodeURIComponent(params.get(cle) || ''));
  } catch (e) {
    chargement.textContent = 'Impossible de préparer la plaquette : ' + (e.message || 'erreur inconnue');
    return;
  }

  const c = d.commune;
  const t = d.tarifs;
  const f = d.fondatrice;
  const nom = echapper(c.nom || 'votre commune');
  const h = c.habitants;
  const gratuits = new Set(d.onglets_gratuits || []);
  const payants = ORDRE.filter((k) => !gratuits.has(k));
  const libres = ORDRE.filter((k) => gratuits.has(k));
  const theme = /^#[0-9a-f]{6}$/i.test(c.couleur_theme || '') ? c.couleur_theme : '#2c5f6e';
  const accent = /^#[0-9a-f]{6}$/i.test(c.couleur_accent || '') ? c.couleur_accent : '#e2c97e';
  document.documentElement.style.setProperty('--c-theme', theme);
  document.documentElement.style.setProperty('--c-encre', encreSur(theme));
  document.documentElement.style.setProperty('--c-accent', accent);
  document.title = `Plaquette Plateforme-Agora — ${c.nom || 'commune'}`;

  const urlApp = c.slug ? `plateforme-agora.fr/${c.slug}` : null;
  const lieu = [h ? `${h.toLocaleString('fr-FR')} habitants` : null, c.departement_nom ? `${c.departement_nom} (${c.departement})` : null].filter(Boolean).join(' · ');
  const logoCommune = c.logo_url ? `<img class="commune-logo" src="${echapper(c.logo_url)}" alt="Logo de ${nom}">` : '';
  const initiale = echapper((c.nom || '?').trim().charAt(0).toUpperCase());
  const pastilleModule = (k) => (k && !gratuits.has(k) ? '<span class="pastille p-payant">Autonomie</span>' : '<span class="pastille p-gratuit">Gratuit</span>');
  const pied = (n) => `<footer class="pied"><span><b>Plateforme-Agora</b> · 06 48 06 10 97 · contact@plateforme-agora.fr</span><span>${n} / 4</span></footer>`;
  const telephone = (ecran, avecEntete) => `
    <div class="tel">
      <img class="ecran" src="/backoffice/plaquette-ecrans/${ecran}.jpg?v=20261123-1" alt="">
      ${avecEntete ? `<div class="tel-entete">${c.logo_url ? `<img src="${echapper(c.logo_url)}" alt="">` : `<span class="initiale">${initiale}</span>`}<span>${nom}</span></div>` : ''}
    </div>`;

  // ── Page 1 : couverture ──
  const page1 = `
  <section class="feuille couverture">
    <div class="couv-bandeau">
      <div class="couv-marques">
        <span class="agora"><img src="/icons/agora-icone-1024-fond-transparent.png" alt="">Plateforme-Agora</span>
        ${logoCommune}
      </div>
      <span class="couv-sur">Présentation pour la commune de ${nom}${c.departement_nom ? ` · ${echapper(c.departement_nom)}` : ''}</span>
      <h1>L'application de <em>${nom}</em>, dans chaque poche</h1>
      <p>La mairie informe, les habitants participent, le secrétariat respire. Une application à votre nom et à vos couleurs, que la mairie pilote seule, sans aucune compétence technique.</p>
    </div>
    <div class="couv-corps">
      <div>
        ${telephone('accueil', true)}
        <div class="legende-tel">Aperçu : l'accueil de l'application aux couleurs de ${nom}</div>
      </div>
      <div class="couv-droite">
        <div class="promesse"><h3>Informer</h3><p>Actualités, agenda, alertes : publié une fois par la mairie, reçu sur le téléphone de chaque habitant, avec une notification.</p></div>
        <div class="promesse"><h3>Faire participer</h3><p>Sondages, entraide entre voisins, associations, balades autour du patrimoine : le village se parle et se retrouve.</p></div>
        <div class="promesse"><h3>Gagner du temps</h3><p>Moins d'avis à distribuer et d'appels à la mairie, des signalements déjà situés sur la carte avec une photo.</p></div>
        <div class="puces">
          <span>À vos couleurs et à votre nom</span><span>Rien à télécharger dans un magasin d'applications</span>
          <span>Données stockées en Europe</span><span>Sans publicité</span><span>Sans engagement de durée</span><span>Gratuit pour commencer</span>
        </div>
      </div>
    </div>
    ${pied(1)}
  </section>`;

  // ── Page 2 : personnalisation + écrans réels ──
  const page2 = `
  <section class="feuille">
    <span class="sur">Votre application</span>
    <h2 class="titre-page">À vos couleurs, à votre nom</h2>
    <p class="chapo">Les habitants ne téléchargent pas « une appli de plus » : ils ouvrent l'application de ${nom}.</p>
    <div class="perso">
      <div class="perso-carte">
        <h3>Vos couleurs <span class="pastille p-gratuit">Toutes les versions</span></h3>
        <div class="nuancier"><span style="background:${theme}"></span><span style="background:${accent}"></span><small>Couleur principale et couleur d'accent</small></div>
        <p>La mairie les choisit dans « Ma commune » et peut les changer à tout moment : toute l'application s'adapte aussitôt.</p>
      </div>
      <div class="perso-carte">
        <h3>Votre nom <span class="pastille p-gratuit">Toutes les versions</span></h3>
        ${urlApp ? `<span class="adresse">${echapper(urlApp)}</span>` : ''}
        <p>Le nom de la commune en tête de chaque écran, une adresse à son nom, un QR code et une affiche prêts à imprimer pour inviter les habitants.</p>
      </div>
      <div class="perso-carte">
        <h3>Votre logo <span class="pastille p-marque">Offres payantes</span></h3>
        <div class="icone-accueil"><span class="icone">${c.logo_url ? `<img src="${echapper(c.logo_url)}" alt="">` : initiale}</span><small>Sur l'écran d'accueil du téléphone : « ${nom} »</small></div>
        <p>Le logo dans l'en-tête ; une fois installée, l'application porte le nom et l'icône de la commune. Inclus en Autonomie, Accompagné et pour les communes fondatrices.</p>
      </div>
    </div>
    <span class="sur">Ce que voient vos habitants</span>
    <div class="ecrans" style="margin-top:6px">
      ${ECRANS.map(([fichier, titre, module]) => `
        <div class="ecran-bloc">${telephone(fichier, false)}<strong>${titre} ${pastilleModule(module)}</strong></div>`).join('')}
    </div>
    <p class="note">Écrans réels de Bonvivre, notre commune de démonstration (novembre 2026). Essayez-la : plateforme-agora.fr/bonvivre</p>
    ${pied(2)}
  </section>`;

  // ── Page 3 : fonctionnalités (gratuit / Autonomie d'après les réglages du palier gratuit) ──
  const module = (k) => `<div class="module"><b>${MODULES[k][0]}</b><span>${MODULES[k][1]}</span></div>`;
  const page3 = `
  <section class="feuille">
    <span class="sur">Les fonctionnalités</span>
    <h2 class="titre-page">Une application, toute la vie du village</h2>
    <p class="chapo">Chaque module s'active ou se masque en un clic, selon les besoins de la commune.</p>
    <div class="colonnes">
      <div class="colonne"><h2>Gratuit <span class="pastille p-gratuit">sans limite de temps</span></h2>${libres.map(module).join('')}
        <div class="toujours">
          <h3>Et dans toutes les versions</h3>
          <ul>
            <li>🔔 Notifications sur le téléphone des habitants</li>
            <li>🌦️ Vigilances Météo-France affichées automatiquement</li>
            <li>🗑️ Calendrier des déchets, rappelé la veille à l'accueil</li>
            <li>🏅 Badges et niveaux qui valorisent la participation</li>
            <li>🧭 Les événements des communes voisines</li>
            <li>🎒 Les visiteurs de passage jouent à vos jeux</li>
          </ul>
        </div>
      </div>
      <div class="colonne payante"><h2>Avec Autonomie <span class="pastille p-marque">${payants.length} modules en plus</span></h2>${payants.map(module).join('')}</div>
    </div>
    <div class="atouts">
      <div class="atout"><b>Née sur le terrain</b><span>Conçue par un élu local avec des mairies de village ; chaque fonction a d'abord servi dans une vraie commune.</span></div>
      <div class="atout"><b>Simple à piloter</b><span>Le maire ou la secrétaire de mairie la gère seul ; prévenir tout le village prend une minute.</span></div>
      <div class="atout"><b>Rien à télécharger</b><span>Un lien ou un QR code suffit : l'application s'ajoute à l'écran du téléphone, sans magasin d'applications.</span></div>
      <div class="atout"><b>La mairie garde la main</b><span>Un contenu signalé est masqué aussitôt puis revu par la mairie ; en offre payante, les photos sont vérifiées automatiquement.</span></div>
      <div class="atout"><b>Données en Europe</b><span>Données stockées dans l'Union européenne, sans publicité ; contrat de sous-traitance RGPD avec la commune.</span></div>
      <div class="atout"><b>Faite pour une mairie</b><span>Facture annuelle sur Chorus Pro, mandat administratif, arrêt sur simple email.</span></div>
    </div>
    ${pied(3)}
  </section>`;

  // ── Page 4 : tarifs de la commune, offre fondatrice en avant ──
  const des = t.population_connue ? '' : 'dès ';
  const prixPublic = (an, gratuite) => {
    if (t.sur_devis) return `<div class="montant">Sur devis</div><div class="detail">au-delà de ${t.bareme.seuil_devis.toLocaleString('fr-FR')} habitants</div>`;
    if (gratuite) return `<div class="montant">Gratuit <small>à vie</small></div><div class="detail">moins de ${t.bareme.seuil_gratuite} habitants</div>`;
    return `<div class="montant">${des}${euros(an)} <small>/ an</small></div><div class="detail">soit ${euros(an / 12)} par mois${t.population_connue ? ` · ${parHabitant(an, h)}` : ''}</div>`;
  };
  const prixFondateur = (fond, pub, gratuite, libelle) => (gratuite
    ? `<div class="prix-f"><div class="nom">${libelle}</div><div class="montant">Gratuit <small>à vie</small></div><div class="detail">déjà gratuite sous ${t.bareme.seuil_gratuite} habitants</div></div>`
    : `<div class="prix-f"><div class="nom">${libelle}</div><div class="montant">${des}${exact(fond)} <small>/ an</small></div>
        <div class="detail">au lieu de <s>${euros(pub)}</s> · soit ${centimes(fond / 12)} par mois</div>
        <div class="eco">Économie : ${exact(pub - fond)} par an, chaque année</div></div>`);
  const bareme = t.bareme;
  const calcul = t.gratuite_a_vie
    ? `Moins de ${bareme.seuil_gratuite} habitants : Autonomie est gratuite à vie ; Accompagné coûte ${euros(t.accompagne)} par an.`
    : t.sur_devis ? `Au-delà de ${bareme.seuil_devis.toLocaleString('fr-FR')} habitants, le prix est établi sur devis, selon vos besoins.`
      : `${euros(bareme.plancher)} par an jusqu'à ${bareme.seuil_degressif} habitants, puis ${euros(bareme.par_tranche_de_100)} par tranche de 100 habitants${t.population_connue ? ` : ${euros(t.autonomie)} pour ${h.toLocaleString('fr-FR')} habitants` : ''}. Accompagné : + ${euros(bareme.supplement_accompagne)}.`;
  // Les modules sont listés à part : on ne répète pas « Tous les onglets » ni l'espace associations (= Annuaire).
  const REDONDANT = /tous les onglets|espace associations/i;
  const offreTexte = (o) => (o?.features || []).filter((x) => !REDONDANT.test(x)).map((x) => `<li>✓ ${echapper(x)}</li>`).join('');
  const blocFondateur = f.proposee ? `
    <div class="fondateur">
      <div class="haut">
        <div><span class="sur">Offre commune fondatrice</span><h2>Votre prix en devenant commune fondatrice</h2>
          <div class="places">${f.convention_en_cours ? 'Votre place de commune fondatrice est réservée.' : `Plus que ${f.places_restantes} place${f.places_restantes > 1 ? 's' : ''} sur ${f.places_total}, jusqu'au ${dateLongue(f.fin)}.`}</div></div>
        <span class="moins">−35 % à vie</span>
      </div>
      <div class="prix2">
        ${prixFondateur(t.fondateur_autonomie, t.autonomie, t.gratuite_a_vie, 'Autonomie')}
        ${prixFondateur(t.fondateur_accompagne, t.accompagne, false, 'Accompagné')}
      </div>
      <div class="bas">Tarif garanti tant que l'abonnement continue, avec une prise en main personnalisée.${t.prix_convention ? ' Prix inscrit dans votre convention.' : ''}</div>
    </div>` : t.sur_devis ? `
    <div class="fondateur"><h2>Une offre construite avec vous</h2><p style="font-size:13px; margin-top:4px">Au-delà de ${bareme.seuil_devis.toLocaleString('fr-FR')} habitants, nous établissons un devis selon vos besoins. La version gratuite reste ouverte sans limite de temps.</p></div>` : '';
  const qrCible = c.slug ? `https://plateforme-agora.fr/${c.slug}/` : 'https://plateforme-agora.fr/bonvivre/';
  const page4 = `
  <section class="feuille">
    <span class="sur">Offres et tarifs${lieu ? ` · ${echapper(lieu)}` : ''}</span>
    <h2 class="titre-page">Les tarifs pour ${nom}</h2>
    ${blocFondateur}
    <div class="offres">
      <div class="offre">
        <span class="nom">Gratuit</span><h3>Informer</h3>
        <div class="montant">0 € <small>sans limite de temps</small></div><div class="detail">sans carte bancaire</div>
        <ul>${libres.map((k) => `<li>✓ ${MODULES[k][0]}</li>`).join('')}<li>✓ Vos couleurs et votre nom</li></ul>
      </div>
      <div class="offre vedette">
        ${d.offres.autonomie.badge ? `<span class="badge">${echapper(d.offres.autonomie.badge)}</span>` : ''}
        <span class="nom">${echapper(d.offres.autonomie.label)}</span><h3>${echapper(d.offres.autonomie.titre)}</h3>
        ${prixPublic(t.autonomie, t.gratuite_a_vie)}
        <div class="detail" style="margin-top:4px"><b>Tout le gratuit, plus ${payants.length} modules :</b></div>
        <div class="modules">${payants.map((k) => `<span>${MODULES[k][0]}</span>`).join('')}</div>
        <ul>${offreTexte(d.offres.autonomie)}</ul>
      </div>
      <div class="offre payante">
        <span class="nom">${echapper(d.offres.accompagne.label)}</span><h3>${echapper(d.offres.accompagne.titre)}</h3>
        ${prixPublic(t.accompagne, false)}
        <ul>${offreTexte(d.offres.accompagne)}</ul>
      </div>
    </div>
    <div class="info" style="margin-bottom:10px"><b>Comment le prix est calculé</b>${calcul} Facture annuelle déposée sur Chorus Pro, réglée par virement ou mandat administratif. Sans engagement de durée : arrêt sur simple email, 2 mois avant l'échéance.</div>
    <div class="contact">
      <div><h3>${c.slug ? 'Votre espace existe déjà' : 'Découvrez la démonstration'}</h3><p>${c.slug ? `Scannez le QR code : l'application de ${nom} s'ouvre sur votre téléphone.` : 'Scannez le QR code pour essayer Bonvivre, notre commune de démonstration.'}<br>Un appel ou un email suffit : en ligne sous 48 h, à votre nom et à vos couleurs, avec l'affiche et le QR code pour inviter les habitants.</p></div>
      <div class="coord"><b>Plateforme-Agora</b><br>06 48 06 10 97<br>contact@plateforme-agora.fr<br>plateforme-agora.fr</div>
      <div><div class="qr" data-qr></div><div class="qr-legende">${c.slug ? 'Votre application' : 'Démo Bonvivre'}</div></div>
    </div>
    ${pied(4)}
  </section>`;

  zone.innerHTML = page1 + page2 + page3 + page4;
  chargement.remove();
  etat.textContent = `Plaquette de ${c.nom || 'la commune'}${t.population_connue ? '' : ' — population inconnue : prix « dès »'} · tarifs du barème en vigueur`;

  if (typeof qrcode === 'function') {
    const qr = qrcode(0, 'M');
    qr.addData(qrCible);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    document.querySelectorAll('[data-qr]').forEach((el) => { el.innerHTML = svg; });
  }
})();
