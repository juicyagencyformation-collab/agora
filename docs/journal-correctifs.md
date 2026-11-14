# Journal des correctifs — Plateforme-Agora

Un correctif par entrée, le plus récent en haut. Pour chacun : symptôme, cause, correction,
vérification, et ce qu'il faut retenir pour ne pas le reproduire.

---

## 2026-11-14 — Conseil : comptes rendus inconsultables (erreur 401)

**Gravité :** moyenne (documents publics officiels inaccessibles aux habitants)
**Fichiers :** `worker/src/backoffice/administration.ts` (`TABLES_URLS_R2`)

### Symptôme
Signalé par Léandre : certains comptes rendus de l'onglet Conseil renvoient une erreur 401 à
l'ouverture.

### Cause
L'URL du fichier (`articles.fichier_pv_url`) est figée à l'upload. Les comptes rendus envoyés
entre le 30 juillet et le 27 août 2026 pointent encore vers l'ancienne adresse `.r2.dev`,
désactivée après la migration de bucket du 2026-10-10. Le script de rattrapage
`reparer-anciennes-urls-r2` ne listait pas cette colonne : elle avait échappé aux deux
recensements (10/10 et 12/10).

### Correction
`{ table: 'articles', colonnes: ['fichier_pv_url'] }` ajouté à `TABLES_URLS_R2`, puis exécution
de `GET compter-anciennes-urls-r2` → `POST reparer-anciennes-urls-r2` → recomptage à 0.

### Vérification
Ouvrir un compte rendu qui était cassé après la réparation.

### À retenir
Toute colonne qui stocke une URL R2 doit figurer dans `TABLES_URLS_R2`. Pour les recenser, il
faut chercher toutes les colonnes `*_url` écrites après un `uploaderFichier()`, pas seulement
les fichiers qui mentionnent `R2_PUBLIC_BASE`.

---

## 2026-11-13 — Parcours : la consigne d'un point de passage effacée à chaque « Modifier »

**Gravité :** faible (perte silencieuse de contenu saisi par la mairie)
**Fichiers :** `frontend/js/chasse-tresor.js` (`soumettreEditionChasse`)

### Symptôme
Aucun signalement. Repéré en relisant le formulaire pendant le chantier « brouillon de parcours ».

### Cause
La modification d'un parcours publié renvoie chaque étape au serveur, mais la branche du type
« point de passage » manquait : le champ `contenu` (la consigne « Prenez à gauche… ») n'était pas
envoyé, et le serveur l'enregistrait vide. La création, elle, l'envoyait (en double, branche copiée).

### Correction
Branche ajoutée à la modification, doublon retiré à la création.

### Vérification
Relecture du code (pas de test automatisé côté front dans le projet).

### À retenir
Un formulaire qui renvoie l'objet entier doit renvoyer chaque champ de chaque type, sinon le
serveur l'efface.

---

## 2026-11-13 — Énigmes de chasse/balade : « pont-levis » refusé si la réponse attendue est « pont levis »

**Gravité :** faible (frustration des joueurs, aucune donnée en jeu)
**Fichiers :** `worker/src/routes/chasses_tresor.ts` (`normaliserReponse`)

### Symptôme
Repéré en préparant les parcours d'Eaucourt : une réponse juste, mais saisie avec un tiret, une
apostrophe courbe (clavier iPhone : « l’église ») ou un point final, était refusée.

### Cause
La comparaison ignorait la casse, les accents et les espaces, mais pas la ponctuation.

### Correction
Tout ce qui n'est ni lettre ni chiffre compte comme un espace, des deux côtés (saisie et réponse
attendue) ; « œ »/« æ » valent « oe »/« ae ». S'applique aussi aux jeux joués depuis une autre
commune (`jeux_ailleurs.ts` réutilise la même validation).

### Vérification
`worker/test/reponse-enigme.test.ts` (tirets, apostrophes droites/courbes, guillemets, ligatures,
et cas qui doivent rester refusés) ; suite complète verte (418 tests).

### À retenir
Une réponse saisie au clavier de téléphone contient des apostrophes typographiques : toujours
normaliser la ponctuation, pas seulement les accents.

---

## 2026-11-10 — Nettoyeur HTML des articles : attributs d'événement non retirés

**Gravité :** haute (injection de script stockée, élargie par l'espace associations)
**Fichiers :** `worker/src/lib/sanitize.ts`, `worker/src/routes/actus.ts`, `worker/src/routes/decouverte.ts`

### Symptôme
Aucun incident constaté. Repéré en relisant le code avant d'exposer le HTML des articles sur la
page publique `/lire/<id>`.

### Cause
`sanitizeHtml` supprimait les balises interdites mais gardait les balises autorisées telles
quelles : `<b onmouseover=…>`, `<p onclick=…>`, `<span/onclick=…>` (sans espace) passaient, et un
`<img … onerror=…` sans « > » final restait dans le texte. Avant le lot 2 des associations, seule
la mairie écrivait des articles ; depuis, un responsable d'association le peut aussi.

### Correction
- Chaque balise est reconstruite depuis une liste blanche (b, i, u, s, br, p sans attribut ; a avec
  `href` http(s) seulement ; span avec quatre propriétés de style) ; tout « < » orphelin est échappé.
- Le HTML est re-nettoyé à la lecture (`GET /actus`, `GET /decouverte/articles/:id`) pour couvrir
  ce qui a été enregistré avant le correctif.
- La page publique `/lire/<id>` n'exécute aucun script (CSP `default-src 'none'`).

### Vérification
`worker/test/article-public.test.ts` (attributs collés au nom de balise, `javascript:`, « < »
orphelin, mise en forme de l'éditeur conservée, dont `color: rgb(…)`) ; suite complète verte.

### À retenir
Un nettoyeur ne « laisse passer » jamais une balise : il la reconstruit.

---

## 2026-11-06 — Pages légales inaccessibles depuis l'accueil, éditeur erroné des espaces citoyens

**Gravité :** haute (conformité légale : LCEN et RGPD)
**Fichiers :** `frontend/js/config.js`, `frontend/mentions-legales.html`, `frontend/confidentialite.html`,
`frontend/conditions-utilisation.html`, `frontend/accueil.html`, `frontend/guide-communes.html`

### Symptôme
- Un visiteur nouveau qui cliquait « Mentions légales », « Confidentialité » ou « CGU » en bas de
  la page d'accueil était renvoyé vers « Rejoindre ma commune » : les pages légales du site
  étaient inaccessibles.
- Les mentions légales affirmaient partout « éditée par la mairie, directeur de la publication :
  le maire », y compris pour les 34 821 espaces citoyens ouverts le jour même, que la mairie n'a
  jamais adoptés.
- Confidentialité : Turnstile, les transferts hors UE et le formulaire de demande des mairies
  n'étaient pas mentionnés ; « contacter la mairie » même pour un espace citoyen.

### Cause
`config.js` redirige vers `/rejoindre.html` toute page sans commune déterminable, y compris les
pages légales ouvertes à la racine. Les textes dataient d'avant les espaces citoyens (migration 100).

### Correction
- `config.js` : pages légales à la racine → `COMMUNE_SLUG = null`, aucune redirection, aucune
  commune mémorisée ; elles affichent la version « plateforme » et un retour vers l'accueil.
- Mentions légales : éditeur de la plateforme (Juicy Solutions, adresse, SIREN, téléphone) toujours
  affiché ; éditeur de l'espace selon son statut (mairie si officiel, Juicy si citoyen ou Explorateurs).
- Confidentialité : responsable selon l'espace, Turnstile (intérêt légitime, art. 6.1.f),
  transferts (chapitre V : DPF et/ou clauses types), demandes des mairies (conservation 3 ans),
  droits de limitation, d'opposition et de retrait du consentement.
- Accueil : FAQ « Des habitants utilisent déjà l'espace de notre commune ? », réponse RGPD nuancée,
  mention d'information sous le formulaire. Guide : section « Espace citoyen ou officiel ».

### Vérification
Chrome headless sans historique, en production : `/confidentialite`, `/conditions-utilisation`,
`/mentions-legales` restent sur leur page ; Adon (citoyen) → Juicy ; Eaucourt (officiel) → mairie ;
Explorateurs → Juicy.

### À retenir
Toute nouvelle page légale ou à la racine doit figurer dans la liste de `config.js` ; à chaque
changement du statut juridique d'un espace, relire mentions légales, confidentialité et CGU ensemble.

---

## 2026-11-05 — Relances automatiques arrêtées, email de Bienvenue corrigé

**Gravité :** faible (décision de prudence et qualité des textes)
**Fichier :** `worker/src/index.ts` (cron) ; texte du modèle « Bienvenue » en base (`modeles_email`)

### Décision
Plus aucune relance email automatique, pour protéger la réputation du domaine (sorti de la liste
noire Spamhaus le jour même) : relance d'inactivité et séquence J+3 / J+7 / encouragement /
proposition payante retirées du cron quotidien. Léandre appelle lui-même les mairies qui se
connectent. Restent : Bienvenue (1er habitant inscrit), bilan mensuel (communes payantes), emails
de service.

### Constat au passage
- La séquence n'avait envoyé que 2 emails depuis sa création (août) : aucun risque de volume.
- Elle pouvait écrire à un **simple habitant** (premier compte d'une commune créée via « Rejoindre »,
  sans compte mairie), avec un texte destiné au maire. À corriger avant toute réactivation
  (`inclureCitoyen=false`, commentaire laissé dans `index.ts`).

### Email de Bienvenue (texte en base, sauvegarde de l'ancien faite)
- Objet : « Merci d'avoir **choisit Pateforme**-Agora » → « Merci d'avoir **choisi Plateforme**-Agora ».
- « Quatre idées » → « Cinq idées » (cinq étaient listées).
- Calendrier des déchets : « dans l'onglet Modération » → « dans l'onglet Ma commune ».

---

## 2026-11-05 — Lien de désinscription dans les emails de suivi

**Gravité :** moyenne (obligation CNIL pour la prospection, exigence Gmail/Yahoo, engagement pris
auprès de Spamhaus)
**Fichiers :** `worker/src/lib/desinscription.ts` et `worker/src/routes/desinscription.ts`
(nouveaux), `email-commune.ts`, `bilan-mensuel.ts`, `prospection.ts`, `onboarding-drip.ts`,
`administration.ts`, `db/migrations/100_desinscriptions_email.sql`

### Constat
Aucun email automatique de l'application ne proposait de se désinscrire, y compris la prospection.

### Correction
- **Emails de suivi** (bienvenue à la 1re inscription, relance d'inactivité, séquence d'onboarding,
  bilan mensuel, présentation et email libre de prospection) : lien « Ne plus recevoir ces emails »
  en bas, et en-têtes `List-Unsubscribe` + `List-Unsubscribe-Post` (bouton « Se désabonner » de
  Gmail/Outlook/Yahoo).
- **Emails de service** (connexion, mot de passe, accès, convention, échéance) : inchangés.
- Le lien ouvre une page de confirmation avec un bouton (les antivirus « cliquent » les liens) ;
  le bouton des messageries enregistre directement (RFC 8058).
- Lien signé (HMAC de l'adresse) : impossible de désinscrire quelqu'un d'autre.
- Une adresse désinscrite ne reçoit plus aucun email de suivi ; la prospection et la séquence le
  signalent clairement au lieu d'un faux « échec d'envoi ». Fiche commune du backoffice :
  « ✉ N'accepte plus les emails de suivi ».

### Vérification
- 358 tests passent, dont 7 nouveaux (signature, lien et en-têtes ajoutés, adresse désinscrite
  ignorée, GET sans effet, POST qui enregistre, lien bricolé refusé).

### À retenir
- Tout nouvel email **non indispensable au service** doit passer par `envoyerEmailSuivi`, jamais
  `envoyerEmail` directement.
- Une réinscription ne se fait que sur demande expresse de la personne (suppression de sa ligne
  dans `desinscriptions_email`).

---

## 2026-11-05 — Domaine plateforme-agora.fr sur la liste noire Spamhaus (DBL)

**Gravité :** haute (emails vers les mairies refusés : liens de connexion, conventions, réponses)
**Hors code** : réputation du domaine, aucun fichier modifié.

### Symptôme
Les emails envoyés aux mairies depuis Roundcube (OVH) étaient rejetés, alors que ceux vers Gmail
passaient. Rejet de la mairie de Tourly : `554 5.7.1 … blocked using dbl.spamhaus.org`.

### Cause
La campagne de prospection d'août-septembre 2026 : environ 13 900 emails à froid, 23 % de rejets,
et aucun lien de désinscription. Spamhaus a inscrit le **domaine**, ce qui bloque tout ce qui
l'utilise : boîte OVH, emails de l'application (Resend), et même les liens vers le site placés
dans un email envoyé d'ailleurs.

### Correction
- Whois rendu public, au nom du titulaire.
- 1er ticket (ST7327062) fermé sans examen : il avait été ouvert depuis une adresse Gmail, que
  Spamhaus refuse pour vérifier l'autorité sur un domaine.
- 2e ticket ouvert depuis `contact@plateforme-agora.fr`, sans VPN, en citant le premier :
  **domaine retiré le jour même** (score de réputation remis à zéro, sans liste blanche).

### Vérification
`nslookup plateforme-agora.fr.dbl.spamhaus.org` → « domaine inexistant » (= non listé), alors que
le domaine de test `dbltest.com` reste trouvé (le contrôle est donc fiable).

### À retenir
- **Plus jamais de prospection en masse depuis plateforme-agora.fr** (engagement pris auprès de
  Spamhaus) : domaine séparé, faible volume, lien de désinscription dans chaque message.
- Le domaine sera **réinscrit** si sa réputation rechute.
- Si une mairie « ne reçoit pas » un email : vérifier d'abord la commande ci-dessus
  (une réponse en `127.0.1.x` = inscrit).
- Demande de retrait : toujours depuis une adresse **du domaine concerné**, jamais Gmail/Outlook.

---

## 2026-11-05 — Chasse au trésor : 8 étapes saisies, 3 enregistrées

**Gravité :** moyenne (travail de saisie perdu sans avertissement, aucune donnée exposée)
**Fichier :** `frontend/js/chasse-tresor.js` (`verifierEtapesChasse`)

### Symptôme
Léandre crée « visite d'eaucourt sur somme » (balade) avec 8 étapes ; au moment de jouer, il n'y
en a que 3. En base, seules 3 étapes existent : la perte a eu lieu à la création.

### Cause
`soumettreChasse` sautait EN SILENCE (`continue`) toute étape sans titre, sans indice ou sans
position sur la carte, puis créait la chasse avec les seules étapes complètes et affichait
« Chasse créée ! ». La modale d'édition faisait de même (comptée en « échec » après coup).

### Correction et vérification
Avant tout envoi, chaque étape est vérifiée : titre, indice, position, et selon le type le texte,
la question et la réponse, ou la photo. Une étape incomplète bloque l'enregistrement : cadre rouge
et message « Étape N : il manque … » au-dessus du bouton. En création, seule une ligne restée
entièrement vide est ignorée. Un échec d'envoi de photo bloque aussi la création, au lieu de faire
échouer la chasse entière côté serveur. Vérifié dans Chrome (sans interface) : une étape sans
indice est refusée sans aucune requête, puis acceptée une fois l'indice saisi, la ligne vide ignorée.

### À retenir
Un formulaire ne doit jamais écarter en silence une partie de la saisie : soit il l'enregistre,
soit il dit précisément ce qui manque.

---

## 2026-11-05 — Chasse au trésor : la cachette de l'étape suivante lisible dans les réponses réseau

**Gravité :** faible (triche possible au jeu, aucune donnée personnelle exposée)
**Fichiers :** `worker/src/routes/chasses_tresor.ts`, `worker/src/routes/jeux_ailleurs.ts`, `frontend/js/chasse-tresor.js`

### Symptôme
Aucun signalé : repéré en relisant la logique des jeux avant l'ouverture aux touristes.

### Cause
En mode « chasse » (QR codes), la liste des chasses renvoyait l'étape suivante en entier : titre
(« Le lavoir ») et coordonnées GPS, alors que l'écran n'affiche que l'indice. Quiconque ouvrait les
outils du navigateur allait droit au QR. Par ailleurs, scanner un QR ne vérifiait pas la position :
une photo du QR partagée en ligne suffisait à valider l'étape depuis chez soi.

### Correction et vérification
L'étape suivante ne contient plus que `id`, `ordre`, `indice` et `type_contenu` en mode chasse (la
balade garde ses points, nécessaires à la carte). Le scan d'un QR exige désormais la position du
joueur, à 200 m au plus de l'étape (`erreurDistanceQr`), chez soi comme dans un autre village.
Tests ajoutés dans `worker/test/jeux-ailleurs.test.ts` (QR scanné depuis Paris refusé, pas de titre
ni de coordonnées en mode chasse).

### À retenir
Toute donnée envoyée au téléphone est lisible par le joueur, même si l'écran ne l'affiche pas : un
secret de jeu ne sort jamais du Worker avant d'être gagné (même règle que la position des énigmes photo).

---

## 2026-10-27 — Backoffice : « Voir la convention » affichait « Devis introuvable »

**Gravité :** faible (document de convention inaccessible, aucune donnée touchée)
**Fichiers :** `frontend/backoffice/js/document.js`, `frontend/backoffice/document.html`

### Cause
La page des documents n'accepte que les types de sa liste blanche (`facture`, `contrat-dpa`) et
retombe sur `devis` sinon. `convention` y avait été oublié lors de l'ajout de la convention : la page
cherchait un devis avec l'identifiant de la convention (404).

### Correction et vérification
`convention` ajouté à la liste. Vérifié dans Chrome (sans interface) : la page appelle bien
`/conventions/:id/document` et affiche la convention.

### À retenir
Tout nouveau type de document se déclare à DEUX endroits de `document.js` : la liste blanche
(ligne `const type = …`) et sa branche de rendu.

---

## 2026-10-26 — Backoffice : l'export des données d'une commune ne se téléchargeait pas

**Gravité :** moyenne (restitution DPA art. 15.1 impossible, aucune donnée exposée)
**Fichiers :** `worker/src/backoffice/export-commune.ts`, `worker/test/export-commune.test.ts`

### Symptôme
Le bouton « ⬇ Exporter les données » donnait un téléchargement en échec (« Site non disponible »),
nommé d'après l'identifiant de la commune au lieu de `donnees-<slug>-<date>.json`.

### Cause
Une requête Supabase par table (60 tables + pagination) : au-delà de la limite Cloudflare de
50 sous-requêtes par invocation Worker, l'appel plantait avant de répondre. Invisible en tests
(le faux Supabase n'a pas cette limite).

### Correction
Une seule requête : les 60 tables sont embarquées depuis `communes` via leur clé étrangère
`commune_id` (`communes?select=...,users(...),articles(...)`). Colonnes toujours listées une à une.

### Vérification
- Requête testée sur la base réelle (Eaucourt) : 200 en 0,8 s, 382 Ko, aucun plafond sur les
  embarqués (457 lignes de `connexions_journalieres`, comme le comptage direct). 283 tests passent.

### À retenir
Toute route qui boucle sur des tables ou des lignes compte ses sous-requêtes : rester bien sous 50,
sinon regrouper (embarquement PostgREST, filtre `in.(...)`, upsert en masse).

---

## 2026-10-24 — Sécurité : blocage d'un compte après 10 échecs de mot de passe

**Gravité :** moyenne (le limiteur Cloudflare ne freinait pas un essai de mots de passe à petit rythme)
**Fichiers :** `worker/src/lib/securite.ts`, `worker/src/auth.ts`, `worker/src/backoffice/auth.ts`,
`worker/src/cron.ts`, `db/migrations/083_tentatives_connexion.sql`

### Pourquoi
Mesuré en production le 2026-10-23 : le limiteur Cloudflare par IP est approximatif (premier blocage
vers la 47e tentative en rafale). Il fallait un plafond strict, par compte.

### Correction
- Chaque échec de mot de passe est enregistré (table `tentatives_connexion` : commune, email, date ;
  commune vide = backoffice). **10 échecs en 15 minutes** sur un compte → connexion par mot de passe
  refusée (429) pendant 15 minutes. Une connexion réussie remet le compteur à zéro.
- Habitants **et** backoffice.
- Échecs comptés que l'email existe ou non : n'indique jamais si un compte existe.
- Lien de connexion et « Mot de passe oublié » restent utilisables : provoquer le blocage d'un compte
  n'empêche pas son titulaire d'entrer.
- **Fail-open** : table absente ou Supabase injoignable → la connexion fonctionne (verrou inactif,
  erreur dans les logs). Purge quotidienne des échecs de plus de 24 h.

### Vérification
- 251 tests passent, dont 5 nouveaux (seuil, filtres, email en minuscules, fail-open table absente et
  réseau coupé).

- **Testé en production le 2026-10-24** (migration 083 appliquée) : 10 échecs → « mot de passe
  incorrect », 11e → bloqué (429, bon message) ; un autre compte depuis la même IP n'est pas affecté.
  Lignes de test supprimées ensuite.

### À retenir
- Un compte bloqué se débloque seul au bout de 15 minutes ; en urgence, supprimer ses lignes dans
  `tentatives_connexion` (filtre sur l'email).

---

## 2026-10-23 — Page « Rejoindre » : recherche par code postal

**Gravité :** faible (gêne utilisateur, fausses demandes d'activation)
**Fichiers :** `worker/src/routes/decouverte.ts`, `frontend/rejoindre.html`

### Symptôme
Un habitant de Montluçon a tapé « 03100 » : aucun résultat (la recherche ne portait que sur le nom), il
a donc envoyé une « demande d'activation » alors que sa commune était déjà disponible.

### Correction
Saisie composée uniquement de 2 à 5 chiffres → recherche sur le code postal, en préfixe (« 03100 » →
Montluçon et Lavault-Sainte-Anne ; « 80132 » → 19 communes). Sinon, recherche par nom comme avant.
Aucune API externe : les 17 079 prospects ont déjà leur code postal en base.

### À retenir
Seul le code postal **principal** de chaque commune est enregistré : une ville à plusieurs codes postaux
n'est trouvée que par le principal ou par son nom.

---

## 2026-10-23 — Backoffice : « Comptes liés » créait des comptes admin trop facilement

**Gravité :** haute (une habitante s'est retrouvée admin de 3 communes, dont 2 sans rapport avec elle)
**Fichiers :** `worker/src/backoffice/administration.ts`, `frontend/backoffice/*`, `docs/sop-virtual-assistants.md`

### Incident
Le 12 octobre, pour rattacher une habitante (Fisli Aya) inscrite par erreur à Eaucourt, l'écran
« Comptes liés » a été utilisé avec 3 communes sélectionnées : 3 comptes **admin** créés en 1,4 s (rôle
par défaut de l'écran). Deux ont été « déliés » aussitôt, mais délier ne supprime pas le compte : ils
sont restés admin. Découvert le 23 octobre ; corrigé à la main (2 comptes anonymisés, Salouël repassé
citoyen — ce dernier changement bloqué un temps par le bug des menus déroulants ci-dessous).

### Correction
- **Plus de rôle par défaut** (côté écran ET côté serveur, qui refuse une demande sans rôle).
- **Confirmation** avant de lier : liste des communes, rôle des comptes qui seront créés, avertissement
  si ce rôle donne des droits de gestion.
- **Rôle affiché** pour chaque compte lié.
- **Délier** propose ensuite de supprimer le compte (qui sinon garde ses droits).
- Consigne VA : cet outil ne sert jamais à corriger la commune d'un habitant.

### À retenir
Il n'existe pas d'action « changer la commune d'un habitant ». Si le besoin revient, en faire une vraie
action plutôt que de détourner « Comptes liés ».

---

## 2026-10-23 — Backoffice : menus déroulants qui affichaient une mauvaise valeur

**Gravité :** moyenne (modifications ignorées sans message, affichage trompeur)
**Fichier :** `frontend/backoffice/index.html`

### Symptôme
Impossible de passer un compte d'**Admin à Citoyen** depuis la fiche utilisateur : après « Enregistrer »,
le compte restait admin (cas de Fisli Aya, Salouël).

### Cause
Les menus déroulants dont les options sont générées par une boucle Alpine (`x-for`) recevaient leur
valeur **avant** que les options existent : ils affichaient alors leur **première option**, quelle que soit
la vraie valeur. Un compte admin apparaissait « Citoyen » ; choisir « Citoyen » ne changeait rien à
l'écran, donc aucune modification n'était détectée, et l'enregistrement renvoyait « admin ».
Reproduit dans Chrome sans interface avec la même version d'Alpine (3.14.9) : affiché `citoyen`,
valeur réelle `admin`.

### Portée
10 menus touchés : rôle (fiche utilisateur, création, comptes liés), **statut des devis, des factures
(3 écrans) et des prospects**, type d'interaction. Ils pouvaient afficher un statut faux (ex. une facture
payée affichée « émise »). **Les données en base n'ont jamais été faussées** : seul l'affichage l'était,
et un changement vers la valeur affichée par erreur était ignoré.

### Correction
Chaque option indique explicitement si elle est la valeur courante (`:selected`). Vérifié en
navigateur : le menu affiche bien `admin`.

### À retenir
Tout nouveau `<select x-model>` du backoffice dont les options viennent d'un `x-for` doit porter
`:selected="valeur === modele"` sur l'option (inutile si la première option est une option vide « Tous… »).

---

## 2026-10-23 — Backoffice : onglet Utilisateurs (+ deux failles corrigées au passage)

**Gravité :** faible (accès réservé au staff), corrigé à l'occasion de la nouvelle fonctionnalité
**Fichiers :** `worker/src/backoffice/administration.ts`, `worker/src/auth.ts`,
`worker/src/backoffice/email-commune.ts`, `db/migrations/082_blocage_comptes.sql`, `frontend/backoffice/*`

### Constats
1. **Recherche d'utilisateurs** : le texte tapé était inséré tel quel dans le filtre Supabase. Une
   virgule ou une parenthèse (« Dupont, Jean ») cassait la requête, ou pouvait y ajouter un filtre.
2. **Comptes superadmin** : modifiables depuis le backoffice (identité, email, rôle, mot de passe,
   comptes liés), alors que la règle du projet l'interdit. Seule la suppression était refusée.

### Correction
- Recherche nettoyée (`nettoyerRecherche`) : les caractères qui structurent le filtre sont retirés.
- Toute action du staff sur un compte passe par `chargerCompteGerable` : refus si superadmin ou anonymisé.

### Nouveautés de sécurité livrées avec l'onglet
- **Blocage de compte** réversible, contrôlé à **chaque** ouverture de session : connexion, lien de
  connexion, rafraîchissement de session, bascule entre comptes liés. Au blocage, les sessions longues
  sont révoquées et les liens de connexion encore valides supprimés ; le jeton court (15 min) expire seul.
- **Lien de connexion de dépannage** : envoyé uniquement à l'adresse du compte, jamais montré au staff
  (un VA ne peut donc pas s'en servir pour se connecter à la place d'un habitant), valable 24 h.
- Blocage, déblocage et envoi de lien inscrits au journal d'activité.

### À retenir
- La migration 082 doit être appliquée **avant** le déploiement du Worker (sinon la connexion échoue
  sur une colonne inconnue).
- Limite connue, inchangée : « Réinitialiser le mot de passe » affiche le mot de passe au staff, donc un
  VA peut techniquement se connecter à la place d'un habitant. Préférer le lien de connexion.

---

## 2026-10-23 — Sécurité : limite de tentatives (connexion, formulaires)

**Gravité :** moyenne (rien ne freinait les essais de mots de passe ni l'envoi massif de formulaires)
**Statut :** **actif en production** depuis le 2026-10-23 (secret `RELAIS_SECRET` posé sur Pages puis
sur le Worker)
**Fichiers :** `worker/src/lib/securite.ts`, `worker/src/index.ts`, `worker/wrangler.toml`,
`frontend/functions/[[path]].js`, `worker/test/securite-limite.test.ts` (nouveau)

### Problème de fond
Derrière le relais `/api`, le Worker ne voit pas l'IP du visiteur mais l'IP de sortie de Cloudflare,
**la même pour tout le monde**. Une limite par IP naïve aurait bloqué toute la plateforme au bout de
5 connexions par minute.

### Correction
- Le relais (Pages Function) transmet l'IP réelle dans `X-Agora-Client-IP`, prouvée par un secret
  partagé `RELAIS_SECRET`. Sans ce secret, une IP envoyée par un tiers est ignorée.
- Deux limiteurs Cloudflare (`wrangler.toml`) : **strict 5/min** et **large 20/min**.

| Route | Limite |
|---|---|
| Connexion habitant / backoffice | 5/min par **IP + email** (acharnement sur un compte) et 20/min par IP |
| Mot de passe oublié, demande de contact, découverte (demande d'accès…) | 5/min par IP (protège aussi le quota Resend) |
| Inscription, réinitialisation, lien de connexion, démo | 20/min par IP (plusieurs habitants sur un même Wi-Fi) |

- Au-delà : réponse 429 « Trop de tentatives, réessayez dans une minute ».
- **Garde-fous** : inactive sans binding ou sans `RELAIS_SECRET` ; les lectures (GET) ne sont jamais limitées.

### Vérification
- 237 tests passent, dont 9 nouveaux (6e tentative bloquée, autre habitant sur la même IP non
  pénalisé, IP inventée ignorée, inactive sans secret).

### Constaté en production (wrangler tail, 2026-10-23)
- Le relais fonctionne : le Worker reçoit l'IP réelle. Sans lui, il voit `2a06:98c0:3600::103`
  (IP de sortie de Cloudflare) pour **tous** les visiteurs — l'hypothèse de départ était juste.
- Le limiteur Cloudflare est **approximatif par conception** (compteurs locaux synchronisés en
  différé, cf. documentation) : sur une rafale de 60 tentatives, le premier blocage est arrivé vers la
  47e, puis de façon intermittente. Il freine une attaque massive, **pas** un essai lent de mots de passe.
- Pour un plafond strict, il faudrait un compteur d'échecs par compte (en base) ou un Durable Object.

### À retenir
- Ordre d'activation : secret côté **Pages d'abord** (puis redéploiement Pages), **Worker ensuite**.
  L'inverse bloquerait tout le monde pendant l'intervalle.
- Limite connue : 5/min reste 300/heure — un acharné peut encore épuiser le quota Resend gratuit
  (100/jour). Acceptable au volume actuel.

---

## 2026-10-23 — Sécurité : CORS trop permissif, CSRF, cookies SameSite=None

**Gravité :** critique (lecture possible des données d'un utilisateur connecté depuis un site tiers)
**Statut :** en production (commit `38adb92`)
**Fichiers :** `worker/src/lib/securite.ts` (nouveau), `worker/src/index.ts`, `worker/src/auth.ts`,
`worker/src/backoffice/auth.ts`, `worker/src/backoffice/administration.ts`, `worker/src/routes/decouverte.ts`,
`worker/test/securite.test.ts` (nouveau)

### Constat (audit externe, vérifié dans le code)
1. **CORS** : l'API acceptait, avec les cookies, toute origine qui *finit par* `.pages.dev` ou qui
   *contient* `localhost` ou `192.168.`. Un site `pirate.pages.dev` pouvait appeler
   `plateforme-agora.fr/api/...` au nom d'un habitant connecté et **lire la réponse**
   (profil, export RGPD…).
2. **CSRF** : rien n'empêchait un site tiers d'envoyer une écriture (POST…) avec les cookies de
   l'utilisateur.
3. **Cookies** en `SameSite=None` : envoyés par le navigateur même depuis un site tiers. Ce réglage
   datait de l'époque où l'API était sur un autre domaine ; depuis le relais same-origin `/api`
   (app citoyenne ET backoffice), il n'est plus nécessaire.

### Correction
- **Liste d'origines exacte** (regex ancrées, jamais « finit par » / « contient ») :
  `plateforme-agora.fr` et ses sous-domaines, `newappcitoyenne.pages.dev` (secours + aperçus).
  `localhost` / `127.0.0.1` / `192.168.x.x` seulement si `ENVIRONNEMENT=dev` (fichier local `.dev.vars`).
- **Anti-CSRF** : toute écriture avec une origine inconnue → 403. Sans en-tête Origin (appel serveur à
  serveur, ex. webhook Resend protégé par sa signature) → accepté, sauf si le navigateur signale une
  requête inter-sites.
- **Cookies `SameSite=Lax`** partout, via une constante unique `OPTIONS_COOKIE` (17 occurrences remplacées).
- Les lectures (GET) ne sont jamais bloquées par l'anti-CSRF.

### Vérification
- 228 tests passent, dont 11 nouveaux (origines pirates refusées, connexion depuis le vrai site acceptée,
  webhook Resend non bloqué, localhost refusé hors dev).
- Vérifié en production : écriture depuis `pirate.pages.dev` → 403, aucun en-tête CORS pour une origine
  pirate ; connexion habitant et backoffice depuis `plateforme-agora.fr` et `newappcitoyenne.pages.dev`
  → acceptées (réponse « mot de passe incorrect » avec de faux identifiants, donc non bloquées).
- Confirmé par Léandre : vraies connexions habitant, mairie et backoffice fonctionnelles (cookies Lax acceptés).

### À retenir
- Toute nouvelle origine légitime (ex. un futur domaine) s'ajoute dans `worker/src/lib/securite.ts`, sinon
  ses écritures seront refusées (403).
- Les sessions ouvertes avant le déploiement gardent leurs anciens cookies jusqu'au prochain
  rafraîchissement (15 min max) : aucune déconnexion attendue.
- Reste à traiter : limite de tentatives sur la connexion — vérifier d'abord quelle IP le Worker voit
  derrière le relais (sinon tous les habitants partageraient le même compteur).

---

## 2026-10-23 — Vigilance météo automatique : communes non alertées

**Gravité :** haute (information de sécurité non affichée, échec silencieux)
**Commits :** `f539ee1` (correctif) + commit suivant (optimisation)
**Fichiers :** `worker/src/lib/vigilance-meteofrance.ts`, `worker/src/lib/notification-meteo.ts`

### Symptôme
Le 23 octobre, la Somme était en vigilance **orange vent** (10h–20h, heure de Paris).
Seules 4 communes ont reçu l'alerte (nibas, plateforme-agora, argoules, abbecourt).
**Eaucourt et les 86 autres communes de la Somme : rien**, ni bandeau, ni notification.
Aucune erreur visible : les jours sans vigilance, le problème était invisible.

### Cause
- La table `communes` est passée à **14 347 lignes** avec l'import des prospects
  (405 avec un département renseigné).
- La synchro (cron horaire) faisait plusieurs requêtes **par commune**, l'une après l'autre.
- Cloudflare limite le nombre de requêtes sortantes par exécution (50 sur le plan gratuit).
  Le compte (15 pages de communes + 15 appels Météo + 1 à 4 requêtes par commune) atteignait
  la limite après la 4e commune : exécution coupée net, les suivantes jamais traitées.
- Diagnostic déduit des horodatages en base (coupure pile au moment de la 5e commune concernée).
  Les logs Cloudflare passés ne sont pas consultables.

**Défauts secondaires trouvés au passage :**
1. Une erreur sur une commune interrompait aussi toutes les suivantes.
2. Le bandeau affichait l'heure du passage du cron au lieu des horaires officiels, sans heure de fin
   (« Depuis le 23 oct. 10:00 » au lieu de « Du 23 oct. 10:00 au 23 oct. 20:00 »).
3. Quand une vigilance revenait, sa date de début restait celle de l'épisode précédent.
4. Le résumé météo du matin avait le même défaut (une requête par commune sur 14 000 lignes).

### Correction
- **Requêtes groupées** : une lecture des alertes en cours, une mise à jour groupée, une fermeture
  groupée, une lecture des abonnés. Le coût ne dépend plus du nombre de communes.
- **Un seul appel Météo pour toute la France** (au lieu d'un par département), tri en mémoire.
- **Sortie anticipée** : si rien n'est actif en France et aucune alerte n'est ouverte, la synchro
  s'arrête après 2 requêtes. C'est le cas la plupart des heures.
- **Horaires officiels** Météo-France enregistrés (début et fin) ; les tranches qui s'enchaînent
  (ex. orange 10h–18h puis 18h–22h) sont fusionnées pour que le bandeau ne clignote pas.
- **Source en panne = on ne touche à rien** : avant, une panne d'Opendatasoft aurait refermé à tort
  les vigilances en cours.
- Notifications envoyées **après** l'enregistrement des alertes : l'affichage ne dépend jamais d'elles.
- Résumé du matin : abonnés lus en une seule requête, seules les communes avec abonnés sont traitées.

### Coût en requêtes (par passage horaire)

| | Avant | Après |
|---|---|---|
| Jour calme | ~435 (coupé à 50) | **2** |
| Jour de vigilance | plusieurs centaines (coupé à 50) | **~8** + envois push |

### Vérification
- 217 tests passent.
- Lecture de la source testée sur les données réelles du jour : un seul appel, 15 départements en
  orange vent, Somme = orange de 10h à 20h (heure de Paris).
- **Confirmé en production** au passage du cron de 11h00 (heure de Paris) : Eaucourt reçoit l'alerte
  orange vent avec les horaires officiels (10h → 20h), et **175 communes** au total sont servies en
  une seule exécution (Somme, Oise, Calvados, Seine-Maritime…), contre 4 avant le correctif.

### À retenir
- **Jamais de boucle de requêtes par commune dans un cron** : la table `communes` contient des
  milliers de prospects. Toujours grouper.
- **Limite restante, hors code** : chaque notification push compte comme une requête et coûte du
  CPU (chiffrement). Sur le plan Workers gratuit (50 requêtes, 10 ms CPU), une commune avec
  quelques dizaines d'abonnés peut encore faire couper un envoi — vigilance comme actus ou autres.
  **Recommandation : plan Workers payant (5 $/mois)**, seule vraie protection pour les notifications.
- À ne pas faire pour économiser : espacer le cron (une vigilance pourrait arriver avec 3 h de retard).
