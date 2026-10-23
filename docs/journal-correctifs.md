# Journal des correctifs — Plateforme-Agora

Un correctif par entrée, le plus récent en haut. Pour chacun : symptôme, cause, correction,
vérification, et ce qu'il faut retenir pour ne pas le reproduire.

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
