// worker/src/backoffice/contrat-dpa.ts
// Génère le contrat de sous-traitance RGPD (art. 28), pré-rempli pour une commune donnée —
// voir docs/dpa-contrat-sous-traitance.md pour la version de référence (identique, à tenir
// synchronisée si l'un des deux évolue). Rendu uniquement à la demande depuis la fiche commune
// du backoffice (bouton "Générer le contrat DPA"), jamais automatique ni envoyé tout seul :
// Léandre relit et complète les [●] restants avant tout envoi à une vraie commune.
function echapper(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
}

const PLACEHOLDER = '<span class="a-completer">[●]</span>';

type Entreprise = {
  entreprise_raison_sociale?: string; entreprise_forme_juridique?: string; entreprise_siret?: string;
  entreprise_adresse?: string; entreprise_cp_ville?: string; entreprise_email?: string; entreprise_telephone?: string;
};
type Maire = { civilite?: string | null; nomComplet: string } | null;
type Commune = { nom: string; population?: number | null };

export function genererContratDpaHtml(commune: Commune, entreprise: Entreprise, maire: Maire): string {
  const nomCommune = echapper(commune.nom);
  const raisonSociale = echapper(entreprise.entreprise_raison_sociale) || 'Juicy Solutions';
  const formeJuridique = entreprise.entreprise_forme_juridique ? echapper(entreprise.entreprise_forme_juridique) : 'entrepreneur individuel (EI)';
  const siretEntreprise = echapper(entreprise.entreprise_siret) || PLACEHOLDER;
  const adresseEntreprise = entreprise.entreprise_adresse ? echapper(entreprise.entreprise_adresse) : PLACEHOLDER;
  const cpVilleEntreprise = entreprise.entreprise_cp_ville ? echapper(entreprise.entreprise_cp_ville) : PLACEHOLDER;
  const emailEntreprise = echapper(entreprise.entreprise_email) || 'contact@plateforme-agora.fr';

  const nomMaire = maire?.nomComplet
    ? `${maire.civilite ? echapper(maire.civilite) + ' ' : ''}${echapper(maire.nomComplet)}`
    : `[M./Mme Prénom NOM]`;

  const dateDuJour = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  return `
    <style>
      .contrat h1 { font-size: 20px; color: var(--navy); text-align: center; margin-bottom: 4px; }
      .contrat .sous-titre { text-align: center; font-size: 13px; color: var(--gris); margin-bottom: 4px; }
      .contrat .version { text-align: center; font-size: 11.5px; color: var(--gris); margin-bottom: 26px; }
      .contrat h2 { font-size: 14.5px; color: var(--navy); margin: 22px 0 8px; border-bottom: 1px solid var(--bord); padding-bottom: 4px; }
      .contrat p { font-size: 12.5px; line-height: 1.65; margin-bottom: 8px; text-align: justify; }
      .contrat ol, .contrat ul { font-size: 12.5px; line-height: 1.65; margin: 6px 0 10px 20px; }
      .contrat table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 11.5px; }
      .contrat table, .contrat th, .contrat td { border: 1px solid var(--bord); }
      .contrat th, .contrat td { padding: 6px 8px; text-align: left; vertical-align: top; }
      .contrat th { background: var(--fond-doux); }
      .a-completer { color: #b45309; font-weight: 600; }
      .contrat .signatures { display: flex; gap: 24px; margin-top: 30px; }
      .contrat .signatures > div { flex: 1; border: 1px dashed var(--bord); border-radius: 10px; padding: 14px 16px; text-align: center; font-size: 12px; color: var(--gris); }
      .contrat .signatures b { display: block; font-size: 13px; color: var(--encre); margin-bottom: 40px; }
    </style>

    <div class="contrat">
      <h1>Accord de sous-traitance de données à caractère personnel</h1>
      <div class="sous-titre">Plateforme Agora — Annexe RGPD au contrat d'abonnement (article 28 du RGPD)</div>
      <div class="version">Version 2.1 — généré le ${dateDuJour} pour la commune de ${nomCommune}</div>

      <h2>Entre les soussignés</h2>
      <p><strong>La commune de ${nomCommune}</strong>, collectivité territoriale, SIRET ${PLACEHOLDER}, dont la mairie
      est située ${PLACEHOLDER}, représentée par ${nomMaire}, maire, agissant en vertu de ${PLACEHOLDER},
      ci-après dénommée « <strong>le Responsable du traitement</strong> » ou « <strong>la Commune</strong> »,</p>
      <p><strong>ET</strong></p>
      <p><strong>Monsieur Léandre SALLE, ${formeJuridique}</strong>, exerçant son activité sous le nom d'usage
      « ${raisonSociale} » (non déclaré comme nom commercial au Registre National des Entreprises),
      immatriculé au RCS d'Amiens sous le numéro SIREN ${siretEntreprise}, dont le siège est situé
      ${adresseEntreprise}, ${cpVilleEntreprise}, éditeur et exploitant de la plateforme Agora
      (plateforme-agora.fr), joignable pour toute question relative aux données personnelles à l'adresse
      ${emailEntreprise}, ci-après dénommé « <strong>le Sous-traitant</strong> »,</p>
      <p>ci-après ensemble « <strong>les Parties</strong> » et individuellement « <strong>une Partie</strong> ».</p>

      <h2>Préambule</h2>
      <p>La Commune a souscrit à la plateforme Agora, solution numérique éditée et exploitée par le Sous-traitant,
      afin d'informer, d'alerter et de faire participer ses habitants (ci-après « <strong>le Contrat principal</strong> »,
      qu'il s'agisse d'une offre gratuite ou payante). Pour l'exécution du Contrat principal, le Sous-traitant
      traite des données à caractère personnel pour le compte de la Commune, qui en détermine les finalités et
      les moyens essentiels. Les Parties concluent en conséquence le présent accord (ci-après « <strong>l'Accord</strong> »),
      conformément à l'article 28 du RGPD.</p>

      <h2>Article 1 — Définitions</h2>
      <p>Les termes « données à caractère personnel », « traitement », « responsable du traitement »,
      « sous-traitant », « personne concernée », « violation de données à caractère personnel » et
      « analyse d'impact » ont le sens que leur donne l'article 4 du RGPD. En outre :</p>
      <ul>
        <li><strong>Plateforme</strong> : l'application web Agora (application citoyenne et back-office municipal) ;</li>
        <li><strong>Utilisateurs</strong> : les habitants et usagers inscrits sur la Plateforme, ainsi que les élus
        et agents de la Commune disposant d'un accès au back-office ;</li>
        <li><strong>Sous-traitant ultérieur</strong> : tout prestataire auquel le Sous-traitant recourt pour mener
        des activités de traitement spécifiques pour le compte de la Commune ;</li>
        <li><strong>Réglementation applicable</strong> : le RGPD, la loi n° 78-17 du 6 janvier 1978 modifiée et tout
        texte ou référentiel de la CNIL qui leur est applicable.</li>
      </ul>

      <h2>Article 2 — Objet et hiérarchie des documents</h2>
      <p>2.1. L'Accord définit les conditions dans lesquelles le Sous-traitant traite, pour le compte de la Commune,
      les données à caractère personnel décrites à l'<strong>Annexe 1</strong>.</p>
      <p>2.2. L'Accord fait partie intégrante du Contrat principal. En cas de contradiction entre l'Accord et le
      Contrat principal sur une question relative à la protection des données à caractère personnel, l'Accord prévaut.</p>

      <h2>Article 3 — Description du traitement</h2>
      <table>
        <tr><th>Nature des opérations</th><td>Hébergement, collecte, enregistrement, organisation, conservation, consultation, modification, diffusion aux Utilisateurs de la Commune, envoi de courriels et de notifications, modération, export, effacement</td></tr>
        <tr><th>Finalités</th><td>Fonctionnement des services de la Plateforme activés par la Commune, détaillés module par module à l'Annexe 1</td></tr>
        <tr><th>Personnes concernées</th><td>Habitants et usagers inscrits ; élus et agents municipaux utilisateurs du back-office</td></tr>
        <tr><th>Catégories de données</th><td>Identification et contact, données de compte, contenus publiés, participation (votes, réponses aux sondages), géolocalisation ponctuelle, données techniques et de connexion — détail à l'Annexe 1</td></tr>
        <tr><th>Données sensibles</th><td>Aucune donnée relevant de l'article 9 du RGPD n'est sollicitée par la Plateforme. Les Utilisateurs sont invités à ne pas en publier ; tout contenu de cette nature est traité dans le cadre de la modération (article 6.3)</td></tr>
        <tr><th>Durée</th><td>Durée du Contrat principal, augmentée du délai de restitution et de suppression prévu à l'article 15</td></tr>
      </table>

      <h2>Article 4 — Instructions documentées</h2>
      <p>4.1. Le Sous-traitant traite les données uniquement sur instruction documentée de la Commune, y compris en
      ce qui concerne les transferts vers un pays tiers, sauf obligation imposée par le droit de l'Union ou le droit
      français ; dans ce cas, il en informe la Commune avant le traitement, sauf si ce droit l'interdit.</p>
      <p>4.2. Constituent des instructions documentées : (i) l'Accord et le Contrat principal ; (ii) les paramétrages
      effectués par la Commune dans le back-office (modules activés, options de modération, rôles attribués) ;
      (iii) toute instruction écrite complémentaire adressée par un représentant habilité de la Commune.</p>
      <p>4.3. Le Sous-traitant informe immédiatement la Commune si, selon lui, une instruction constitue une
      violation de la Réglementation applicable. Il peut alors en suspendre l'exécution jusqu'à sa confirmation ou
      sa modification par la Commune.</p>
      <p>4.4. Le Sous-traitant s'interdit tout traitement des données pour ses propres finalités, notamment toute
      exploitation commerciale, publicitaire, toute cession à des tiers ou toute utilisation pour l'entraînement de
      modèles d'intelligence artificielle. Il peut produire des statistiques d'usage <strong>agrégées et anonymes</strong>
      pour le pilotage et l'amélioration de la Plateforme.</p>

      <h2>Article 5 — Confidentialité</h2>
      <p>5.1. Le Sous-traitant garantit la confidentialité des données traitées. Il veille à ce que les seules
      personnes autorisées à y accéder, dans la stricte mesure nécessaire à l'exécution du Contrat principal, soient
      soumises à une obligation contractuelle ou légale de confidentialité et reçoivent la sensibilisation nécessaire
      en matière de protection des données.</p>
      <p>5.2. Cette obligation survit à la fin de l'Accord, sans limitation de durée.</p>

      <h2>Article 6 — Sécurité des traitements</h2>
      <p>6.1. Le Sous-traitant met en œuvre les mesures techniques et organisationnelles appropriées prévues à
      l'article 32 du RGPD, compte tenu de l'état des connaissances, des coûts de mise en œuvre et des risques pour
      les personnes concernées. Ces mesures sont décrites à l'<strong>Annexe 2</strong>.</p>
      <p>6.2. Le Sous-traitant peut faire évoluer ces mesures, à condition de ne pas abaisser le niveau global de
      sécurité. Il tient l'Annexe 2 à jour et la communique à la Commune sur simple demande.</p>
      <p>6.3. La Plateforme comprend un dispositif de modération des contenus publiés par les habitants
      (signalement, masquage, revue par la Commune). La décision de maintien ou de suppression d'un contenu relève
      de la Commune ; le Sous-traitant applique ses instructions et peut, en cas de contenu manifestement illicite
      porté à sa connaissance, le masquer à titre conservatoire en en informant sans délai la Commune.</p>

      <h2>Article 7 — Sous-traitants ultérieurs</h2>
      <p>7.1. <strong>Autorisation générale.</strong> La Commune autorise le Sous-traitant à recourir aux
      sous-traitants ultérieurs listés à l'<strong>Annexe 3</strong>.</p>
      <p>7.2. <strong>Changements.</strong> Le Sous-traitant informe la Commune par écrit (courriel à l'adresse de
      contact déclarée) de tout ajout ou remplacement envisagé d'un sous-traitant ultérieur, au moins
      <strong>trente (30) jours</strong> avant sa mise en œuvre, en précisant l'identité du prestataire, les
      traitements concernés et la localisation des données. La Commune dispose d'un délai de <strong>quinze (15)
      jours</strong> à compter de cette information pour formuler une objection motivée. Les Parties recherchent
      alors de bonne foi une solution ; à défaut, la Commune peut résilier le Contrat principal sans pénalité, avec
      remboursement au prorata des sommes versées d'avance pour la période non exécutée.</p>
      <p>7.3. <strong>Urgence.</strong> En cas de nécessité impérieuse liée à la sécurité ou à la continuité du
      service (défaillance d'un prestataire, faille de sécurité), le remplacement peut intervenir sans préavis ; le
      Sous-traitant en informe la Commune dans les meilleurs délais et la procédure d'objection de l'article 7.2
      s'applique a posteriori.</p>
      <p>7.4. <strong>Obligations répercutées.</strong> Le Sous-traitant impose à chaque sous-traitant ultérieur, par
      contrat, des obligations de protection des données offrant des garanties équivalentes à celles de l'Accord. Il
      demeure pleinement responsable envers la Commune de l'exécution, par le sous-traitant ultérieur, de ses
      obligations (article 28.4 du RGPD).</p>

      <h2>Article 8 — Localisation et transferts hors de l'Union européenne</h2>
      <p>8.1. La base de données de la Plateforme est hébergée dans l'Union européenne (Francfort, Allemagne). Les
      fichiers déposés (photos, documents) sont stockés dans un espace de stockage Cloudflare R2 soumis à une
      restriction de juridiction « Union européenne ».</p>
      <p>8.2. Certains traitements impliquent ou peuvent impliquer un accès ou un traitement transitoire depuis un
      pays tiers, notamment les États-Unis (distribution applicative via un réseau mondial, envoi de courriels). Ces
      transferts sont encadrés, conformément au chapitre V du RGPD, par la décision d'adéquation relative au cadre
      de protection des données UE–États-Unis (<em>EU-U.S. Data Privacy Framework</em>) pour les prestataires
      certifiés et/ou par les clauses contractuelles types adoptées par la Commission européenne
      (décision (UE) 2021/914), tels que détaillés à l'Annexe 3.</p>
      <p>8.3. Le Sous-traitant tient à la disposition de la Commune la documentation relative à ces garanties et
      s'engage à l'informer de toute évolution significative du cadre juridique des transferts (notamment une remise
      en cause de la décision d'adéquation) et des mesures qu'il prend en conséquence.</p>

      <h2>Article 9 — Exercice des droits des personnes concernées</h2>
      <p>9.1. Il appartient à la Commune de fournir l'information prévue aux articles 13 et 14 du RGPD. Le
      Sous-traitant met à sa disposition un modèle de politique de confidentialité adapté à la Plateforme, que la
      Commune reste libre d'adapter et dont elle demeure responsable.</p>
      <p>9.2. La Plateforme permet aux Utilisateurs d'exercer eux-mêmes certains droits : consultation et
      rectification de leur profil, <strong>export de leurs données</strong> (format JSON) et <strong>suppression de
      leur compte</strong> depuis leur espace personnel.</p>
      <p>9.3. Lorsqu'une personne concernée adresse au Sous-traitant une demande d'exercice de ses droits, le
      Sous-traitant la transmet à la Commune dans un délai de <strong>cinq (5) jours ouvrés</strong>, sans y répondre
      lui-même sauf instruction de la Commune.</p>
      <p>9.4. Le Sous-traitant aide la Commune, par des mesures techniques et organisationnelles appropriées et dans
      toute la mesure du possible, à répondre aux demandes qui ne peuvent être traitées en libre-service, dans un
      délai lui permettant de respecter le délai légal d'un mois.</p>

      <h2>Article 10 — Violations de données à caractère personnel</h2>
      <p>10.1. Le Sous-traitant notifie à la Commune toute violation de données à caractère personnel <strong>dans
      les meilleurs délais et au plus tard quarante-huit (48) heures</strong> après en avoir pris connaissance, par
      courriel à l'adresse de contact déclarée par la Commune, doublé d'un appel téléphonique au ${PLACEHOLDER}.</p>
      <p>10.2. La notification comporte, dans la mesure où ces informations sont disponibles : la nature de la
      violation, les catégories et le nombre approximatif de personnes et d'enregistrements concernés, les
      conséquences probables, les mesures prises ou proposées pour y remédier et en atténuer les effets, ainsi que
      les coordonnées d'un point de contact. Les informations indisponibles au moment de la notification sont
      communiquées de manière échelonnée, sans retard indu.</p>
      <p>10.3. Il revient à la Commune, en sa qualité de responsable du traitement, de notifier la violation à la
      CNIL et, le cas échéant, aux personnes concernées. Le Sous-traitant l'assiste dans ces démarches et ne procède
      lui-même à aucune notification ni communication publique sans son accord écrit préalable, sauf obligation
      légale.</p>
      <p>10.4. Le Sous-traitant documente toute violation (faits, effets, mesures prises) et tient cette
      documentation à la disposition de la Commune.</p>

      <h2>Article 11 — Analyse d'impact et consultation préalable</h2>
      <p>Le Sous-traitant fournit à la Commune les informations et l'assistance raisonnablement nécessaires à la
      réalisation d'une analyse d'impact relative à la protection des données (AIPD) et, le cas échéant, à la
      consultation préalable de la CNIL (articles 35 et 36 du RGPD).</p>

      <h2>Article 12 — Registre, délégué à la protection des données</h2>
      <p>12.1. Le Sous-traitant tient un registre des catégories d'activités de traitement effectuées pour le
      compte de ses clients, conformément à l'article 30.2 du RGPD.</p>
      <p>12.2. La Commune communique au Sous-traitant les coordonnées de son délégué à la protection des données
      (DPO), le cas échéant mutualisé : ${PLACEHOLDER}.</p>
      <p>12.3. Le point de contact du Sous-traitant pour toute question relative à la protection des données est :
      Léandre SALLE — ${emailEntreprise} — ${PLACEHOLDER}.</p>

      <h2>Article 13 — Âge minimum des Utilisateurs</h2>
      <p>13.1. La création d'un compte habitant sur la Plateforme est réservée aux personnes âgées d'au moins
      <strong>quinze (15) ans</strong>, qui le déclarent lors de leur inscription (case de déclaration obligatoire,
      sans laquelle le compte ne peut être créé).</p>
      <p>13.2. Les mineurs de moins de quinze ans peuvent participer aux activités ouvertes au public (notamment
      chasses au trésor et visites guidées) sous le compte et la responsabilité d'un titulaire de l'autorité
      parentale, sans création de compte à leur nom.</p>
      <p>13.3. Le Sous-traitant supprime tout compte dont il apprend qu'il a été créé en méconnaissance de cette
      règle, après en avoir informé la Commune.</p>

      <h2>Article 14 — Obligations de la Commune</h2>
      <p>La Commune s'engage à :</p>
      <ol>
        <li>déterminer et documenter la base légale de chacun des traitements (notamment mission d'intérêt public
        pour l'information municipale et consentement pour la géolocalisation et les notifications), et tenir à
        jour son propre registre des activités de traitement ;</li>
        <li>informer les Utilisateurs conformément aux articles 13 et 14 du RGPD ;</li>
        <li>documenter par écrit toute instruction adressée au Sous-traitant ;</li>
        <li>veiller au respect, pendant toute la durée du traitement, des obligations que le RGPD met à la charge
        du responsable du traitement ;</li>
        <li>attribuer les accès au back-office aux seuls élus et agents qui en ont besoin, les retirer sans délai
        en cas de fin de fonctions, et veiller à la confidentialité de leurs identifiants ;</li>
        <li>assurer la modération des contenus publiés par les habitants dans le respect de l'article 6.3 ;</li>
        <li>superviser les traitements, y compris par la réalisation d'audits (article 16).</li>
      </ol>

      <h2>Article 15 — Sort des données en fin de contrat</h2>
      <p>15.1. Au terme du Contrat principal, pour quelque cause que ce soit, la Commune peut exporter l'ensemble
      de ses données depuis le back-office ou en demander la restitution, dans un format structuré, couramment
      utilisé et lisible par machine (JSON ou CSV), pendant un délai de <strong>trente (30) jours</strong>.</p>
      <p>15.2. À l'issue de ce délai, ou plus tôt sur instruction écrite de la Commune, le Sous-traitant supprime
      de manière définitive l'ensemble des données de la Commune de ses systèmes et de ceux de ses sous-traitants
      ultérieurs. Les copies présentes dans les sauvegardes techniques sont supprimées au fil de leur cycle de
      rotation, dans un délai maximal de [trente (30)] jours supplémentaires ; elles ne sont ni consultées ni
      restaurées entre-temps, sauf demande de la Commune.</p>
      <p>15.3. Le Sous-traitant peut conserver des données agrégées et anonymes, ainsi que les données dont la
      conservation est imposée par une obligation légale (notamment données de facturation), pour la durée de
      cette obligation.</p>
      <p>15.4. Sur demande, le Sous-traitant remet à la Commune une attestation écrite de suppression.</p>

      <h2>Article 16 — Documentation et audits</h2>
      <p>16.1. Le Sous-traitant met à la disposition de la Commune les informations nécessaires pour démontrer le
      respect de ses obligations (Annexes à jour, attestations ou documentation de ses sous-traitants ultérieurs,
      réponses à questionnaire de sécurité).</p>
      <p>16.2. Si ces informations sont insuffisantes, la Commune peut faire réaliser un audit, y compris une
      inspection, par elle-même ou par un auditeur indépendant soumis au secret professionnel et non concurrent du
      Sous-traitant, dans la limite d'<strong>un audit par an</strong> (sauf violation de données ou demande d'une
      autorité de contrôle), moyennant un préavis écrit de <strong>trente (30) jours</strong> et dans des
      conditions ne perturbant pas l'exploitation de la Plateforme. L'audit ne peut porter sur les données des
      autres clients du Sous-traitant.</p>
      <p>16.3. Les frais de l'audit sont à la charge de la Commune, sauf si l'audit révèle un manquement
      substantiel du Sous-traitant à ses obligations.</p>

      <h2>Article 17 — Responsabilité et assurance</h2>
      <p>17.1. Chaque Partie est responsable des dommages résultant de ses propres manquements à la Réglementation
      applicable et à l'Accord, dans les conditions de l'article 82 du RGPD. Le Sous-traitant n'est tenu responsable
      que s'il n'a pas respecté les obligations que le RGPD met spécifiquement à la charge des sous-traitants ou
      s'il a agi en dehors des instructions licites de la Commune ou contrairement à celles-ci.</p>
      <p>17.2. Sauf faute lourde ou dolosive, et hors dommages corporels, la responsabilité totale du Sous-traitant
      au titre de l'Accord, toutes causes confondues, est limitée au montant le plus élevé des deux sommes
      suivantes : (i) les sommes hors taxes effectivement versées par la Commune au titre du Contrat principal au
      cours des douze (12) mois précédant le fait générateur ; (ii) ${PLACEHOLDER} euros.</p>
      <p>17.3. Lorsqu'une personne concernée obtient réparation de l'une des Parties pour un dommage imputable en
      tout ou partie à l'autre, la Partie ayant indemnisé peut se retourner contre l'autre à hauteur de sa part de
      responsabilité (article 82.5 du RGPD).</p>
      <p>17.4. Le Sous-traitant ${PLACEHOLDER} (déclare être titulaire d'une police d'assurance responsabilité
      civile professionnelle couvrant les conséquences pécuniaires de sa responsabilité au titre de l'Accord, y
      compris les risques liés aux atteintes aux données / s'engage à souscrire une telle police), dont il justifie
      sur demande.</p>

      <h2>Article 18 — Durée</h2>
      <p>18.1. L'Accord entre en vigueur à la date de sa signature par la dernière des Parties, ou, si elle est
      antérieure, à la date du premier traitement de données pour le compte de la Commune. Il prend fin à
      l'expiration des obligations prévues à l'article 15.</p>
      <p>18.2. Les articles 5 (Confidentialité), 15 (Sort des données) et 17 (Responsabilité) survivent à la fin
      de l'Accord pour la durée nécessaire à leur pleine exécution.</p>

      <h2>Article 19 — Modifications</h2>
      <p>19.1. Toute modification de l'Accord fait l'objet d'un avenant écrit signé par les Parties, à l'exception
      de la mise à jour de l'Annexe 3, qui suit la procédure de l'article 7, et de l'Annexe 2, qui suit l'article
      6.2.</p>
      <p>19.2. Si l'évolution de la Réglementation applicable ou de la doctrine de la CNIL l'exige, les Parties
      s'engagent à négocier de bonne foi les adaptations nécessaires.</p>

      <h2>Article 20 — Droit applicable et règlement des différends</h2>
      <p>20.1. L'Accord est soumis au droit français.</p>
      <p>20.2. En cas de différend relatif à l'interprétation ou à l'exécution de l'Accord, les Parties s'efforcent
      de le régler à l'amiable dans un délai de trente (30) jours à compter de sa notification écrite par la Partie
      la plus diligente. Elles peuvent recourir à une médiation.</p>
      <p>20.3. À défaut d'accord amiable, le différend est porté devant la juridiction administrative
      territorialement compétente.</p>

      <div class="signatures">
        <div><b>Pour la commune de ${nomCommune}</b>${nomMaire}, maire<br>Signature et cachet</div>
        <div><b>Pour le Sous-traitant</b>Léandre SALLE<br>Signature</div>
      </div>

      <h2>Annexe 1 — Description détaillée des traitements</h2>
      <p>Les bases légales indiquées sont des propositions : leur détermination relève de la Commune. Les durées de
      conservation sont celles appliquées par défaut par la Plateforme ; la Commune peut demander à les adapter.</p>
      <table>
        <tr><th>Module</th><th>Finalité</th><th>Données traitées</th><th>Base légale suggérée</th><th>Conservation par défaut</th></tr>
        <tr><td>Compte habitant</td><td>Permettre l'accès aux services</td><td>Nom, prénom, courriel, mot de passe haché, commune(s) de rattachement, date d'inscription, rôle</td><td>Mission d'intérêt public (art. 6.1.e)</td><td>Durée de vie du compte ; suppression après 3 ans d'inactivité, précédée d'un avertissement par courriel</td></tr>
        <tr><td>Profil enrichi et annuaire</td><td>Mettre en relation les habitants (entraide, compétences)</td><td>Bio, compétences, passions, disponibilités, photo, choix de visibilité</td><td>Consentement (art. 6.1.a)</td><td>Jusqu'à modification, retrait ou suppression du compte</td></tr>
        <tr><td>Actualités, bulletin, agenda, conseil municipal</td><td>Informer les habitants</td><td>Contenus publiés par la Commune ; le cas échéant nom des élus et intervenants</td><td>Mission d'intérêt public</td><td>Tant que publié par la Commune</td></tr>
        <tr><td>Alertes et notifications</td><td>Prévenir les habitants</td><td>Abonnement push, préférences de notification, courriel</td><td>Consentement / mission d'intérêt public</td><td>Jusqu'au désabonnement ou expiration de l'abonnement push</td></tr>
        <tr><td>Mur des voisins, coups de main</td><td>Échanges et entraide entre habitants</td><td>Messages, photos, réponses, auteur, date</td><td>Mission d'intérêt public</td><td>Durée de vie du compte ; contenus masqués par la modération : 6 mois</td></tr>
        <tr><td>Signalements</td><td>Signaler un problème sur la voie publique</td><td>Description, photo, position géographique ponctuelle, auteur, statut</td><td>Mission d'intérêt public ; consentement (géolocalisation)</td><td>1 an après clôture du signalement</td></tr>
        <tr><td>Sondages et votes de projets</td><td>Consulter les habitants</td><td>Réponses, votes, date</td><td>Mission d'intérêt public</td><td>Réponses individuelles : 6 mois après clôture ; résultats agrégés ensuite</td></tr>
        <tr><td>Chasse au trésor, visite guidée</td><td>Valoriser le patrimoine</td><td>Progression, validations GPS/QR, points</td><td>Consentement</td><td>Durée de vie du compte</td></tr>
        <tr><td>Modération</td><td>Prévenir et traiter les contenus illicites</td><td>Signalements, motif, contenu signalé, décisions</td><td>Mission d'intérêt public</td><td>1 an après la décision</td></tr>
        <tr><td>Back-office élus et agents</td><td>Administrer la Plateforme</td><td>Nom, courriel professionnel, rôle, journal des actions</td><td>Mission d'intérêt public</td><td>Durée des fonctions + 1 an</td></tr>
        <tr><td>Données techniques et de connexion</td><td>Sécurité, prévention des abus, diagnostic</td><td>Adresse IP, date et heure, identifiant de session, type de navigateur</td><td>Intérêt légitime / obligation légale</td><td>12 mois au plus</td></tr>
        <tr><td>Modération automatique des photos (option)</td><td>Détecter les images inappropriées avant publication</td><td>Photo soumise par l'habitant</td><td>Mission d'intérêt public</td><td>Aucune conservation après traitement</td></tr>
      </table>

      <h2>Annexe 2 — Mesures techniques et organisationnelles de sécurité</h2>
      <p><strong>Hébergement et localisation</strong> — Base de données PostgreSQL managée hébergée dans l'Union
      européenne (région Francfort). Stockage des fichiers (Cloudflare R2) soumis à une restriction de juridiction
      « Union européenne ». Chiffrement des données au repos assuré par les hébergeurs.</p>
      <p><strong>Cloisonnement entre communes</strong> — Architecture mutualisée à cloisonnement applicatif :
      l'identifiant de la commune est imposé par le serveur applicatif sur chaque requête et n'est jamais déterminé
      par le client ; un Utilisateur ne peut accéder qu'aux données de la ou des communes auxquelles il est
      rattaché.</p>
      <p><strong>Authentification et contrôle des accès</strong> — Mots de passe hachés et salés (PBKDF2, 100 000
      itérations) ; jamais stockés en clair. Cookies de session HttpOnly, Secure et à portée restreinte (SameSite).
      Gestion des rôles selon le principe du moindre privilège. Secrets techniques stockés dans des variables
      d'environnement chiffrées, jamais dans le code source.</p>
      <p><strong>Confidentialité des échanges</strong> — Chiffrement de toutes les communications en transit
      (HTTPS/TLS). Notifications push envoyées selon le standard Web Push avec chiffrement de bout en bout du
      contenu (RFC 8291).</p>
      <p><strong>Intégrité, disponibilité, résilience</strong> — Sauvegardes automatiques de la base de données par
      l'hébergeur. Protection contre les attaques par déni de service et filtrage du trafic. Mécanismes anti-spam
      et limitation du nombre de publications.</p>
      <p><strong>Modération</strong> — Signalement de contenu par les habitants, masquage immédiat et revue par la
      Commune ; option de modération automatique des photos.</p>
      <p><strong>Organisation</strong> — Procédure de gestion des incidents et des violations de données
      (notification à la Commune sous 48 h). Mises à jour régulières des dépendances logicielles. Minimisation :
      aucune collecte de données non nécessaires, pas de traceur publicitaire ni de mesure d'audience tierce.
      Fonctions d'export et de suppression de compte en libre-service.</p>

      <h2>Annexe 3 — Sous-traitants ultérieurs autorisés</h2>
      <p>Liste à jour au ${dateDuJour}.</p>
      <table>
        <tr><th>Sous-traitant ultérieur</th><th>Prestation</th><th>Localisation des données</th><th>Garanties pour les transferts</th></tr>
        <tr><td>Cloudflare, Inc. (États-Unis)</td><td>Hébergement et distribution de l'application (Pages), serveur applicatif (Workers), stockage des fichiers (R2)</td><td>Fichiers : Union européenne (bucket R2 en juridiction « UE ») ; traitement applicatif sur le réseau mondial</td><td>Certification Data Privacy Framework ; clauses contractuelles types</td></tr>
        <tr><td>Supabase, Inc. (États-Unis)</td><td>Base de données PostgreSQL managée</td><td>Union européenne (Francfort, Allemagne)</td><td>DPA Supabase ; hébergement fixé en UE</td></tr>
        <tr><td>Resend, Inc. (États-Unis)</td><td>Envoi des courriels transactionnels</td><td>États-Unis</td><td>Certification Data Privacy Framework ; clauses contractuelles types</td></tr>
        <tr><td>Cloudflare, Inc. — Workers AI (si la Commune active l'option)</td><td>Modération automatique des photos par IA</td><td>Réseau mondial ; aucune conservation après analyse, aucun entraînement de modèle</td><td>Mêmes garanties que Cloudflare ci-dessus</td></tr>
      </table>
      <p><strong>Services d'acheminement des notifications push (non choisis par le Sous-traitant).</strong> Le
      standard Web Push impose que chaque notification transite par le service push du fournisseur du navigateur
      utilisé par l'habitant (Google, Mozilla ou Apple), qui ne reçoit qu'un contenu chiffré de bout en bout et des
      métadonnées techniques d'acheminement. Mentionnés ici par transparence.</p>
      <p><strong>Services appelés directement depuis le terminal de l'Utilisateur.</strong> Pour afficher la carte,
      le navigateur de l'Utilisateur interroge directement le service public de l'IGN (Géoplateforme, France), qui
      reçoit à cette occasion l'adresse IP de l'Utilisateur et la zone consultée. Aucune donnée de compte ne lui est
      transmise. La vigilance météo n'est pas interrogée par le navigateur de l'habitant : elle est synchronisée
      automatiquement côté serveur depuis un jeu de données publiques en lecture anonyme — ce flux n'implique donc
      aucun sous-traitant au sens du RGPD.</p>
    </div>
  `;
}
