# Agora — Instructions de projet pour Claude Code

## Contexte
Plateforme SaaS civic-tech multi-tenant pour petites communes françaises, développée par
Juicy Solutions (Léandre Sallé), élu à Eaucourt-sur-Somme (Somme), commune de référence.
PWA mobile-first, assez simple pour qu'un maire non-technophile la gère seul.

## Comportement de l'assistant
- Toujours répondre en français, de façon directe et concise (pas de remplissage)
- Toujours expliquer avant de coder quoi que ce soit
- Si une demande est ambiguë, poser UNE seule question de clarification avant de coder
- Toujours privilégier la solution la plus simple et professionnelle qui fonctionne (YAGNI)
  plutôt que la plus complète en théorie
- Le contenu (listes, formulaires) doit rester visuellement sobre : menus déroulants plutôt
  que tout afficher à plat

## Priorités architecturales (par ordre)
1. Sécurité : isolation tenant irréprochable
2. Souveraineté : zéro vendor lock-in côté client
3. Simplicité : le code le plus court qui fait le job proprement
4. Performance : edge-first, cache quand pertinent

## Matrice de permissions par module
admin, élu et superadmin peuvent créer/modifier/supprimer le contenu de : actus, thermomètre
(sondages), mur, coups de main, agenda, signalements/alertes, chasse au trésor. Le module
conseil (délibérations) est réservé à élu et superadmin uniquement. Ceci s'ajoute au schéma
de modération standard (signalement → masquage immédiat → revue mairie) pour le contenu
soumis par les citoyens — voir règle 4 ci-dessous.

## Format des réponses code
- Toujours indiquer le chemin du fichier en commentaire en haut du bloc de code
- Pour un fichier existant, montrer uniquement le diff ou la section modifiée, pas le fichier
  entier (voir aussi la règle sur wrangler.toml et config.js plus bas)
- Schémas SQL : toujours inclure commune_id, created_at, et les contraintes UNIQUE nécessaires
- Nouvelle route Hono : toujours inclure middleware JWT, extraction de commune_id, validation
  Zod, gestion d'erreur
- Jamais de `SELECT *` : toujours lister les colonnes explicitement

## Stack technique
- Backend : Cloudflare Workers + Hono.js (TypeScript)
- Base de données : Supabase PostgreSQL — **REST uniquement, zéro SDK client, zéro RLS**
  (toute la sécurité est gérée dans le Worker via commune_id extrait du JWT)
- Stockage fichiers : Cloudflare R2, via URL présignées générées par le Worker
- Auth : JWT maison (@tsndr/cloudflare-worker-jwt), cookies httpOnly SameSite=None;Secure
- Frontend : HTML/CSS/JS vanilla, zéro framework, zéro build step
- Cartes : Leaflet.js + tuiles IGN Géoplateforme (pas OpenStreetMap, pas Google Maps)
- Notifications push : @pushforge/builder (Web Push natif, pas Firebase)
- Tests : Vitest + @cloudflare/vitest-pool-workers
- Déploiement : Git → GitHub → Cloudflare Pages/Workers Builds (déploiement automatique)

## Règles d'architecture NON NÉGOCIABLES
1. Le client ne connaît jamais Supabase — uniquement des fetch() vers l'API Worker
2. commune_id est TOUJOURS extrait du JWT côté serveur, jamais envoyé par le client
3. Zéro framework JS, zéro bibliothèque npm côté client, sauf exceptions explicitement
   validées et vendorées en local (pas de `npm install` client, pas de CDN externe non
   vendoré) : Leaflet.js (cartes) et jsQR (`frontend/js/vendor/jsQR.min.js`, décodage QR —
   nécessaire car Safari/iOS n'implémente pas l'API native BarcodeDetector). Toute nouvelle
   exception à cette règle doit être validée explicitement avec Léandre avant ajout, jamais
   décidée seule.
4. Toute action de modération suit le même schéma : signalement → masquage immédiat → revue mairie
5. Rôles : citoyen < admin < élu < maire < superadmin (maire ajouté le 2026-08-06 : hérite
   des pouvoirs d'élu + peut nommer/révoquer des élus + seul rôle avec élu à pouvoir
   uploader le logo de la commune ; un seul maire par commune par convention, jamais imposé
   techniquement). Le superadmin ne peut JAMAIS être attribué via l'interface, uniquement en
   base directement — maire non plus, réservé au superadmin.
6. Anti-farming systématique sur toute action à XP : une table "X_lus_par_utilisateur" ou
   équivalent, jamais d'XP en boucle (supprimer/recréer, revoter, etc.)
7. Variables du domaine métier en français (commune, citoyen, sondage...), technique en
   anglais (middleware, handler, token...)
8. Toute écriture en base passe par une validation Zod côté Worker au préalable
9. Jamais de framework JS (React, Vue, Next.js...) ni de service d'auth tiers (Firebase,
   Auth0, Clerk...) — ni côté client ni côté serveur
10. Jamais Supabase Realtime côté client

## Architecture worker/src/
Instantané pris le 2026-08-05 — peut avoir bougé depuis. Avant de s'y fier pour une tâche
précise, vérifier avec un `Glob worker/src/**/*.ts` plutôt que de faire confiance à cette
liste telle quelle (elle-même remplace une version antérieure devenue fausse).
```
worker/src/
├── index.ts              ← entrée, routage principal, CORS
├── auth.ts                ← login, inscription, JWT, refresh, RGPD (/moi, /mes-donnees)
├── cron.ts                ← purges planifiées (mur, photos du jour, énigmes, coups de main)
├── db.ts                  ← abstraction Supabase REST
├── storage.ts              ← abstraction R2 (URL présignées)
├── middleware/
│   ├── jwt.ts              ← vérification du token, extraction user/commune/role
│   ├── tenant.ts            ← résolution slug → commune_id
│   └── onglet.ts            ← vérifie qu'un module est actif pour la commune
├── lib/
│   ├── password.ts          ← hachage PBKDF2 (+ bascule silencieuse depuis SHA-256)
│   ├── permissions.ts        ← hiérarchie de rôles (peutGererRoles, peutAttribuerRole...)
│   ├── gamification.ts        ← XP, connexions quotidiennes, badges
│   ├── email.ts               ← envoi d'emails (reset mot de passe...)
│   ├── push.ts                 ← notifications Web Push
│   ├── geo.ts                   ← utilitaires géographiques (chasse au trésor)
│   ├── sanitize.ts               ← nettoyage des entrées utilisateur
│   ├── ics.ts                     ← export calendrier (agenda)
│   ├── qrcode.ts                   ← génération QR (chasse au trésor)
│   └── sync-lois.ts                 ← synchro RSS/Atom Parlement européen
└── routes/
    ├── actus.ts, alertes.ts, agenda.ts, mur.ts, coups_de_main.ts, chasses_tresor.ts,
    │   sondages.ts, deliberations.ts, lois.ts, annuaire.ts, bulletin.ts,
    │   photo_du_jour.ts, enigmes.ts, profil.ts, dechets.ts, push.ts
    ├── commune.ts            ← infos publiques de la commune (avant résolution tenant)
    ├── decouverte.ts          ← événements nationaux, hors résolution tenant
    └── moderation.ts           ← gestion des rôles, activation/désactivation des onglets
```

## Pièges déjà rencontrés — à ne PAS reproduire
- **Le générateur de QR maison (`worker/src/lib/qrcode.ts`) est plafonné à 42 caractères**
  (une seule version QR codée à la main, volontairement, pour tenir un UUID) — ne jamais
  essayer d'y faire tenir une URL complète ou tout texte plus long qu'un UUID sans réécrire
  une bonne partie du fichier (gestion multi-version + blocs Reed-Solomon multiples). Piège
  découvert en voulant encoder une URL cliquable pour permettre le scan via l'appareil photo
  natif d'iPhone (Safari n'implémentant pas `BarcodeDetector`) — solution retenue à la place :
  `frontend/js/vendor/jsQR.min.js` (décodeur QR client, jsQR v1.4.0, vendoré en local via
  `curl` depuis unpkg puis minifié avec `npx terser` — jamais un `<script>` pointant vers un
  CDN externe en direct). Voir `demarrerScannerQr` dans `frontend/js/utils.js` : bascule
  automatique BarcodeDetector → jsQR → saisie manuelle en dernier recours.
- **Les fichiers JS/CSS du frontend gardent toujours le même nom** (`agenda.js` reste
  `agenda.js` à chaque déploiement) — rien ne force un navigateur mobile à recharger la
  dernière version, même avec le service worker en "réseau d'abord" (le `fetch()` qu'il fait
  peut lui-même être satisfait par le cache HTTP du téléphone). Symptôme vécu : un citoyen
  sur mobile voit une fonctionnalité "à moitié" fonctionner (ex. un bouton présent dans un
  commit mais pas dans le suivant) alors que tout est correct côté serveur — seul un
  effacement manuel du cache du navigateur (pas juste réinstaller le raccourci PWA) le
  résout. Palliatif retenu, à appliquer à CHAQUE fois qu'un fichier `frontend/js/*.js` ou
  `frontend/css/*.css` change : bumper le paramètre `?v=AAAAMMJJ` sur TOUTES les balises
  `<script src="/js/...">` / `<link href="/css/...">` de TOUS les fichiers HTML
  (`index.html`, `connexion.html`, `decouverte.html`, `mentions-legales.html`,
  `confidentialite.html`, `reinitialiser.html`) — une URL différente est un cache différent,
  sans dépendre d'un comportement Cloudflare qu'on ne maîtrise pas (voir le piège
  `_redirects` ci-dessous, même catégorie de surprise sur ce domaine personnalisé).
  Nuance vécue le 2026-08-06 : le `?v=` ne suffit pas toujours à lui seul sur un appareil
  qui avait déjà l'app installée avant l'ajout de ce système — le service worker déjà en
  place peut mettre un moment à "comprendre" qu'il doit revalider. Si le bug persiste malgré
  un `?v=` à jour et que le code déployé est confirmé correct (vérifiable avec
  `curl https://plateforme-agora.fr/js/<fichier>.js?v=...`), le réflexe à proposer en premier
  reste d'effacer les données du site dans le navigateur (pas juste réinstaller le raccourci
  PWA) — ça a résolu le cas du volet "Logo de la commune" qui ne se dépliait pas alors que
  tout était pourtant correct côté serveur.
  **Ajout 2026-08-10 :** à CHAQUE déploiement front, bumper AUSSI `CACHE_NAME` dans
  `frontend/sw.js` (même token de date que le `?v=`, ex. `agora-shell-20260810-1`). Sans ça,
  `sw.js` reste identique d'un déploiement à l'autre → le navigateur ne détecte jamais de
  mise à jour du service worker → l'ancien cache n'est jamais purgé (l'événement `activate`
  ne supprime les vieux caches que si `CACHE_NAME` a changé). Symptôme vécu sur iPhone :
  l'app installée affichait une page d'accueil VIDE alors qu'un onglet Safari normal marchait
  et que le code déployé était confirmé sain — c'était le SW figé qui servait un cache cassé.
  Le changement de `CACHE_NAME` force la ré-installation du SW (`skipWaiting`) + purge des
  anciens caches (`activate`) + prise de contrôle immédiate (`clients.claim`).
- **Cloudflare Pages `_redirects` s'est montré incohérent** sur le domaine personnalisé
  (plateforme-agora.fr) — une simple règle catch-all y interceptait à tort les fichiers
  statiques (css/js), alors que la même règle fonctionnait sur l'adresse .pages.dev.
  Solution actuelle : une Pages Function (`frontend/functions/[[path]].js`) fait le routage
  par commune à la main, avec un contrôle total — voir ce fichier avant de retoucher au
  routage multi-commune.
- **wrangler.toml ne doit jamais être écrasé en entier** par un fichier généré — il contient
  des valeurs réelles (R2_PUBLIC_BASE, etc.) qui diffèrent de tout exemple. Donner des
  instructions de ligne précise à ajouter/modifier, pas le fichier complet.
- **frontend/js/config.js** contient l'URL réelle du Worker en prod — ne jamais l'écraser
  avec une valeur de test (localhost:8787) sans vérifier d'abord la valeur réelle actuelle.
- **Safari/iOS bloquait les cookies tiers par défaut**, dans tous les modes de navigation,
  depuis 2020 (Intelligent Tracking Prevention). Comme le frontend (plateforme-agora.fr) et
  l'API (agora-worker....workers.dev) étaient sur des domaines différents, les cookies de
  session étaient bloqués sur iPhone/Safari — connexion qui semblait réussir puis revenait
  aussitôt à l'écran de connexion. RÉSOLU : l'API est désormais appelée en same-origin via
  `/api/...`, relayée en coulisses vers le vrai Worker par `frontend/functions/[[path]].js`
  (fonction `relayerVersWorker`). `window.API_BASE` (frontend/js/config.js) vaut donc `/api`
  et non plus l'URL `.workers.dev`. Piège associé à ce changement : tout code qui fait
  `new URL(API_BASE + ...)` sans passer `window.location.origin` en base plante
  ("Invalid URL"), car API_BASE n'est plus une URL absolue — voir articles.js, annuaire.js,
  agenda.js, coups-de-main.js pour le bon pattern.
- **Le service worker (`frontend/sw.js`) doit explicitement exclure `/api/`** de son cache
  réseau-d'abord, par chemin et pas seulement par origine. Avant le proxy same-origin
  ci-dessus, un test sur `url.origin !== self.location.origin` suffisait à exclure l'API
  (autre domaine). Depuis le proxy, l'API est same-origin : ce test ne l'exclut plus, et le
  SW s'est mis à mettre en cache les réponses de l'API — sur mobile, un article publié
  pouvait sembler ne pas apparaître si le SW retombait sur une réponse en cache antérieure à
  la publication. Toujours garder le test explicite `url.pathname.startsWith('/api/')` en
  plus du test d'origine si ce fichier est retouché.
- Le hachage des mots de passe est passé de SHA-256 simple à PBKDF2 salé (100k itérations)
  — voir worker/src/lib/password.ts — avec bascule automatique silencieuse à la connexion
  pour les comptes encore sur l'ancien format. Ne jamais casser cette rétrocompatibilité.

## Commandes de déploiement
```powershell
cd C:\Users\Leand\Downloads\agora
git add .
git commit -m "description"
git push
```
Cloudflare déploie automatiquement Worker ET Pages depuis GitHub. Le déploiement du Worker
exécute `npm test && npx wrangler deploy` — les tests bloquent le déploiement s'ils échouent.

## Adresses actuelles
- Frontend : https://plateforme-agora.fr/eaucourt/ (et /newappcitoyenne.pages.dev/eaucourt/ en secours)
- Worker : https://agora-worker.juicy-agency-formation.workers.dev
- Commune de test : eaucourt (compte test@eaucourt.fr)
- Commune "nationale" : Plateforme-Agora (niveau_national=true, événements visibles par
  toutes les communes via /decouverte/evenements)

## Avant toute modification de fichier existant
Toujours lire le fichier réel avant d'éditer — ne jamais halluciner son contenu de mémoire.
Ce projet a déjà souffert d'une reconstruction de fichiers "de mémoire" ayant fait
disparaître une fonction (initFormulaireAlerte) — vérifier systématiquement.
