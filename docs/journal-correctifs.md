# Journal des correctifs — Plateforme-Agora

Un correctif par entrée, le plus récent en haut. Pour chacun : symptôme, cause, correction,
vérification, et ce qu'il faut retenir pour ne pas le reproduire.

---

## 2026-10-23 — Sécurité : CORS trop permissif, CSRF, cookies SameSite=None

**Gravité :** critique (lecture possible des données d'un utilisateur connecté depuis un site tiers)
**Statut :** sur la branche `securite/cors-csrf-cookies`, **pas encore en production**
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
- À faire après déploiement : connexion habitant, mairie et backoffice sur le vrai site (et sur
  l'adresse `.pages.dev` de secours).

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
