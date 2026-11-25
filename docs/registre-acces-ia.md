# Registre des accès d'une IA aux données de Plateforme-Agora

Tenu par Léandre Sallé (SALLE), entrepreneur individuel, éditeur de Plateforme-Agora — SIREN 882 992 472.
Créé le 25 novembre 2026. Ce registre est versionné dans git : chaque ajout est daté et ne peut pas
être réécrit sans laisser de trace.

## Pourquoi ce registre

Léandre développe Plateforme-Agora avec l'aide de Claude Code, un assistant de programmation d'IA édité
par **Anthropic PBC** (États-Unis). Pour vérifier une panne ou appliquer un réglage, Claude Code peut
interroger directement la base de données de production, avec la clé technique du serveur. Les données
lues passent alors par les serveurs d'Anthropic : Anthropic agit comme **sous-traitant ultérieur** au
sens de l'article 28 du RGPD. Ce registre trace chacun de ces accès.

## Règles appliquées depuis le 25 novembre 2026

1. **Plus aucun accès de l'IA aux données d'habitants** (décision de Léandre le 25 novembre 2026).
   Claude Code ne lit ni ne modifie plus ces données en production ; les diagnostics se font sur le
   code, les tests et la commune de démonstration Bonvivre (habitants fictifs). Anthropic n'est
   donc pas déclaré comme sous-traitant pour ces données.
2. **Pour les données sans habitants**, l'accès reste possible, toujours annoncé avant d'agir.
   Préférer ces données : Réglages, barème, textes, communes, prospects
   (coordonnées professionnelles des mairies) plutôt que comptes d'habitants ou contenus publiés.
3. **Lire le minimum.** Seules les colonnes utiles, sur le nombre de lignes utile ; jamais d'export
   complet d'une table d'habitants.
4. **Ne rien garder.** Aucune donnée d'habitant copiée dans un fichier du projet ou dans un document.
5. **Inscrire ici tout accès exceptionnel** qui toucherait malgré tout des données d'habitants
   (par exemple une urgence de sécurité), avec l'accord écrit de Léandre : date, opération, données,
   finalité.

« Données d'habitants » : tables `users`, `refresh_tokens`, `push_subscriptions`, contenus publiés
(`articles`, `posts`, `alertes`, `coups_de_main`, `photos_du_jour`, `souvenirs`, `comments`,
`reactions`, `votes`), participations (`event_attendees`, `enigme_reussites`, `progressions_chasse`).

## Accès passés retrouvés dans l'historique (avant ce registre)

Reconstitués le 25 novembre 2026 à partir de l'historique des sessions de Claude Code. Tous ont eu lieu
à la demande de Léandre, pour le développement ou le support. Ils sont antérieurs à la déclaration
d'Anthropic comme sous-traitant.

| Date | Opération | Données d'habitants concernées | Finalité (demande de Léandre) |
|---|---|---|---|
| 2026-10-16 | Lecture | `users`, `articles`, `alertes`, `coups_de_main`, `photos_du_jour`, `enigme_reussites`, `posts`, `votes`, `comments`, `reactions`, `event_attendees` | Analyse du rapport d'activité et des statistiques de lecture des actualités |
| 2026-10-17 | Lecture | `users`, `posts` | Masquer des réglages selon les rôles ; liste des communes ayant des utilisateurs |
| 2026-10-23 | Lecture | `users` | Vérification de la vigilance météo ; tri de la liste des utilisateurs ; demande d'inscription de la mairie de Salouel ; correction d'un changement de rôle |
| 2026-10-24 | Lecture | `users`, `photos_du_jour` | Test de la modération automatique des photos (choix de la commune de test, sans toucher aux vrais habitants d'Eaucourt) |
| 2026-10-26 | Lecture et écriture | `users` | Annonces de la plateforme ; comptes supprimés encore visibles dans la gestion des rôles |
| 2026-10-27 | Lecture | `users`, `articles`, `alertes`, `votes` | Chiffres réels pour la page d'accueil du site (totaux, jamais de commune nommée) |
| 2026-11-03 | Lecture | `users`, `articles`, `alertes` | Passage de Conseil et Lois hors du gratuit (communes déjà utilisées) |
| 2026-11-05 | Lecture et écriture | `users`, `refresh_tokens` | Création d'un compte, avec l'autorisation explicite de Léandre |
| 2026-11-06 | Lecture et écriture | `users`, `articles` | Tests d'inscription (Explorateurs, habitants), puis suppression des comptes de test à sa demande ; contenu de la démo Bonvivre |
| 2026-11-14 | Lecture | `users` | Diagnostic d'un problème d'affichage sur iPhone |
| 2026-11-19 | Lecture | `users`, `push_subscriptions` | Vérification de l'arrivée des notifications de vigilance (démo Bonvivre) |
| 2026-11-20 | Lecture | `users` | Vérifications de conformité RGPD (guide CNIL) |
| 2026-11-22 | Lecture | `users` | Diagnostic à partir d'une capture d'écran |

Les autres accès de la même période ne portaient que sur des données sans habitants (réglages,
barème, textes des emails, communes, prospects, conventions, factures).

Le 23 novembre 2026, une tentative de lecture (communes et conventions de Fay-les-Étangs et de
Tourly) a été **bloquée** par le garde-fou de Claude Code : aucune donnée n'a été lue.

## Accès depuis la création du registre

| Date | Opération | Données | Finalité | Accord de Léandre |
|---|---|---|---|---|
| — | — | — | — | — |
