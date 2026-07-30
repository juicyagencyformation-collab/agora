# Agora — Guide de déploiement (à faire toi-même, étape par étape)

Tout le code est déjà écrit et assemblé. Il ne reste que les actions qui
nécessitent TON compte (Cloudflare, Supabase) — je ne peux pas les faire à ta place.

## Étape 1 — Créer le projet Supabase de test

1. Va sur https://supabase.com → New Project → nomme-le `agora-test`.
2. Une fois créé : **Project Settings → API** → note `Project URL` et `service_role key` (secret !).
3. **SQL Editor** → colle et exécute CHAQUE fichier de `db/migrations/` **dans l'ordre numérique** (001 → 007) :
   - 001_schema_initial.sql
   - 002_articles_onglets.sql
   - 003_alerte_images.sql
   - 004_communes_coords.sql
   - 005_mur_cascade.sql
   - 006_refresh_tokens.sql
   - 007_donnees_test.sql (crée la commune "eaucourt" + un compte de test)

Compte de test créé : `test@eaucourt.fr` / mot de passe `test1234`.

## Étape 2 — Installer les outils sur ton PC

```bash
npm install -g wrangler
```

## Étape 3 — Configurer les secrets du Worker

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
```

Ouvre `.dev.vars` dans VS Code et remplace les 3 valeurs par les tiennes :
```
JWT_SECRET=invente-une-longue-phrase-aleatoire-ici
SUPABASE_URL=https://TON-PROJET.supabase.co
SUPABASE_SERVICE_ROLE_KEY=colle-ta-cle-service-role
```

## Étape 4 — Se connecter à Cloudflare (obligatoire, c'est TON compte)

```bash
wrangler login
```

Ça ouvre ton navigateur — connecte-toi ou crée un compte Cloudflare gratuit.

## Étape 5 — Déployer le Worker

```bash
cd worker
wrangler secret put JWT_SECRET
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler deploy
```

Note l'URL affichée à la fin, du type :
`https://agora-worker.TON-SOUS-DOMAINE.workers.dev`

## Étape 6 — Connecter le frontend au Worker déployé

Ouvre `frontend/js/config.js` et remplace la première ligne :
```javascript
window.API_BASE = 'https://agora-worker.TON-SOUS-DOMAINE.workers.dev';
```
(colle l'URL notée à l'étape 5)

## Étape 7 — Déployer le frontend

```bash
cd frontend
npx wrangler pages deploy . --project-name=agora-test
```

Tu obtiens une URL du type `https://agora-test.pages.dev`.

## Étape 8 — Tester depuis ton mobile

Ouvre `https://agora-test.pages.dev` sur ton téléphone (n'importe quel réseau).
Le scan QR (Chasse au trésor) fonctionnera directement puisque c'est déjà en HTTPS.

## Si ça ne marche pas

- **Page blanche** : ouvre les outils développeur du navigateur (mobile : relie ton
  téléphone à ton PC et utilise `chrome://inspect`) et regarde l'erreur dans la Console.
- **Erreur 404 "Commune introuvable"** : vérifie que la migration 007 a bien été exécutée
  dans Supabase (Table Editor → `communes` → tu dois voir la ligne `eaucourt`).
- **Erreur CORS** : vérifie que l'URL de `frontend/js/config.js` correspond exactement
  à celle affichée après `wrangler deploy`.
- **Connexion refusée** : il n'y a pas encore de page de connexion HTML — pour l'instant,
  utilise Thunder Client (extension VS Code) pour appeler `POST /eaucourt/auth/login`
  avec `{ "email": "test@eaucourt.fr", "password": "test1234" }`, ce qui pose le cookie
  de session dans Thunder Client uniquement (pas dans le navigateur mobile — une vraie
  page de connexion HTML reste à faire, dis-le-moi si tu veux que je la fasse maintenant).

## Redéployer après une modification

Chaque fois que tu changes un fichier :
```bash
# si tu as touché worker/src/*
cd worker && wrangler deploy

# si tu as touché frontend/*
cd frontend && npx wrangler pages deploy . --project-name=agora-test
```
