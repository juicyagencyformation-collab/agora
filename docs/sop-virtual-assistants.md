# Mode d'emploi du backoffice Agora — SOP Virtual Assistants

> Document vivant : à mettre à jour à chaque nouveauté livrée sur le backoffice. Dernière mise à jour : **2026-09-08**.
> Destiné aux Virtual Assistants (VA) de Juicy Solutions qui opèrent le backoffice au quotidien (prospection, onboarding, facturation, support). Version "grand public" (mairies) : voir `guide-communes.md`.

## ⚠️ Règle d'or à lire avant tout

**Il n'existe qu'un seul niveau d'accès staff.** La table des comptes backoffice n'a pas de notion de rôle : un compte VA a un accès **strictement identique et complet** à tout le backoffice — prospection, fiches communes, devis/facturation, ET les réglages tarifaires globaux qui s'appliquent à toute la plateforme. Il n'y a **aucune restriction technique** possible.

Concrètement :
- Le périmètre d'un VA se définit **par consigne humaine**, jamais par un réglage. Ce document sert justement à fixer ce périmètre.
- **Ne jamais toucher aux Réglages** (barème tarifaire, palier gratuit, comptes staff, informations légales de l'entreprise) sans validation explicite de Léandre — un changement là-bas est **global et rétroactif** sur toutes les communes.
- Un compte staff **ne peut pas être créé depuis l'interface** — demander à Léandre.

## Se connecter

- URL : `/backoffice/connexion` (email + mot de passe fournis par Léandre).
- Session courte (15 min) mais renouvelée automatiquement tant que tu restes actif — pas besoin de te reconnecter en cours de journée.
- Déconnexion : lien en bas du menu de gauche.
- **Ctrl/Cmd+K** ouvre une recherche rapide (communes + prospects) — plus rapide que de naviguer dans les listes.

---

## 1. Routine quotidienne : le tableau de bord "🎯 Aujourd'hui"

C'est l'écran par lequel commencer chaque journée. Il regroupe tout ce qui attend une action, en 6 blocs toujours dépliés (pas de clic pour les ouvrir).

| Bloc | Ce que c'est | Comment le traiter |
|---|---|---|
| 📞 Prospects à relancer | Prospects dont la relance programmée est due aujourd'hui ou en retard | Bouton **"Tout traiter"** (max 40 par clic — au-delà, reclique) envoie automatiquement le bon email (présentation si jamais activé, relance J+3 si déjà activé) |
| 🕓 Refus à relancer | Prospects "perdus" dont la relance (~10 mois après refus) arrive à échéance | **Jamais en lot.** Ouvre chaque fiche individuellement, retravaille le contact à la main |
| 📥 Réponses reçues à traiter | Emails entrants des mairies non encore traités | Voir §3 ci-dessous |
| 💰 Facturation à traiter | Échéances d'abonnement à 60 jours + factures non soldées | Voir §6.4 (Devis & facturation) |
| ⚠ Onboarding bloqué | Communes actives avec de l'activité mais aucun contact joignable par email | Va dans "Gérer les utilisateurs" de la commune et promeus le bon citoyen en admin/élu (voir §6.5) |
| ✉ Emails rejetés (bounces) | Adresses ayant rejeté un envoi | Bouton **"Corriger via l'annuaire"** relance l'enrichissement officiel (service-public.fr) pour tenter de réparer l'adresse automatiquement |

---

## 2. Prospection commerciale

### 2.1 Importer de nouvelles communes

Formulaire "Département" (ex. `80`) + "Population max" (optionnel) → source officielle `geo.api.gouv.fr`. **Sans risque à relancer** : un prospect déjà travaillé (statut, notes, relances) n'est jamais écrasé, seuls les codes INSEE absents sont ajoutés.

### 2.2 Synchroniser les noms des maires

Bouton **"👤 Synchroniser les noms des maires"** — télécharge le Répertoire National des Élus (RNE, data.gouv.fr) et met à jour le nom du maire sur tous les prospects importés. Corrige aussi automatiquement les comptes maire déjà créés qui portent encore le nom générique "Maire de {commune}" — **jamais** si le nom a déjà été corrigé à la main.

### 2.3 Filtrer et trier la liste

Filtres disponibles : statut, département, recherche texte, tri (nom/département/population), et deux signaux d'intérêt à surveiller en priorité :
- 🔥 **"S'est inscrit"** — un citoyen s'est inscrit lui-même (signal fort).
- 🔑 **"Le maire s'est connecté"** — le signal le plus fiable de tous, à privilégier pour prioriser les relances.

Trois vues : **Liste** (tableau), **Carte** (Leaflet, prospects géolocalisés), **Réponses reçues** (voir §3).

### 2.4 Envoyer une présentation

- **Unitaire** (fiche prospect) : bouton **"✉ Envoyer la présentation"** — active automatiquement une commune gratuite si elle n'existe pas encore (crée la commune + un compte maire provisoire), envoie l'email avec identifiants, passe le statut en "contacté", programme une relance à +7 jours.
- **En lot** (sélection multiple dans la liste) : **max 40 par envoi**, traités un par un pour qu'un échec isolé n'interrompe pas les suivants. ⚠️ Aucun renvoi automatique aux prospects déjà contactés — utilise plutôt le bouton unitaire ✉ ou "Activer et renvoyer" (§2.6) pour ceux-là.
- En cas d'échecs sur un envoi groupé : bouton **"↻ Relancer les échecs"** ne reprend que les échecs.

### 2.5 Cycle de vie d'un prospect

```
à contacter → contacté → relance → rdv → gagné
                                        ↘ perdu
                                        ↘ ne plus contacter
```

- Passage à "contacté" automatique dès le premier envoi.
- Passage à "gagné" uniquement via la conversion manuelle en commune cliente (§4).
- Un prospect "gagné", "perdu" ou "ne plus contacter" ne peut plus recevoir d'envoi automatique **ni** de relance manuelle (bouton "🔁 Relancer" désactivé sur sa fiche).

### 2.6 Gérer un refus — deux statuts, pas un seul

⚠️ Deux cas bien différents, à ne pas confondre :

| Le prospect dit... | Statut à utiliser | Effet |
|---|---|---|
| "Pas maintenant", "on n'a pas le budget cette année", pas de réponse claire | **Perdu** | Date du refus posée automatiquement, relance reprogrammée à ~10 mois (ajustable). **Précise toujours la raison invoquée** sur la fiche — utile dans 10 mois. Visible dans le tiroir "🕓 Pipeline de refus". |
| "Nous ne sommes pas intéressés, merci de ne plus nous relancer" (demande explicite) | **Ne plus contacter** | **Aucune relance, jamais** — ni automatique ni manuelle. Note le contexte de la demande (qui, quand, comment) dans les Notes de la fiche. |

Passer par erreur un refus définitif en "Perdu" au lieu de "Ne plus contacter" reprogrammerait une relance dans 10 mois — à éviter, la demande de ne plus être contacté doit être respectée durablement.

### 2.7 Rattrapage

Prospects déjà contactés (statut contacté/relancé/rdv) mais sans commune réellement activée (reliquat d'avant le 2026-08-17). Bouton **"Activer et renvoyer"** — traite **un par un**, jamais en lot (volontaire, plus fiable).

### 2.8 Lire les statistiques de prospection

Tiroir "Entonnoir de prospection (par variante)" : envoyés → ouverts → cliqués → rejetés → **connectés** (le signal le plus fiable — le maire s'est réellement connecté, contrairement à "ouvert" qui peut être faussé par Apple Mail).

---

## 3. Traiter une réponse reçue

La boîte "Réponses reçues" trie automatiquement par mots-clés (pas d'IA — décision volontaire, aucune action n'est jamais prise automatiquement sur le prospect). 4 catégories :

| Catégorie | Action prioritaire |
|---|---|
| 🔒 Vérification anti-spam | **La plus urgente** — la vraie présentation n'est pas encore délivrée tant que le lien de déblocage (type Mailinblack) n'est pas ouvert |
| 🏛 Fermeture (mairie fermée/absente) | Utilise le raccourci qui reprogramme automatiquement la relance |
| 📧 Changement d'adresse | Enregistre la nouvelle adresse directement depuis l'email |
| ❓ Autre | À traiter au cas par cas |

Actions disponibles : **"✉️ Répondre"** (réponse threadée, apparaît comme une vraie réponse dans la boîte du destinataire), **"✓ Marquer traité"**, lien direct vers la fiche prospect. Bouton **"🔄 Synchroniser avec Resend"** si un email semble manquant (comble les trous quand le webhook ne s'est pas déclenché).

---

## 4. Convertir un prospect en commune cliente

Depuis la fiche prospect (si pas déjà cliente) → **"Convertir en commune cliente"** :
1. Renseigne nom, slug d'URL, email/prénom/nom du maire, mot de passe temporaire.
2. Coche "Envoyer les accès par email" si le maire doit recevoir ses identifiants tout de suite.
3. Valide → la commune est créée (forfait Gratuit par défaut), le compte maire est créé, le prospect passe en statut "gagné".

---

## 5. Séquence d'onboarding automatique — à connaître, jamais à casser

Un cron quotidien envoie automatiquement jusqu'à 5 emails à toute commune gratuite active éligible :

1. **Bienvenue** — 1ère inscription citoyenne.
2. **Relance douce** — inscrit puis inactif 5 à 9 jours.
3. **Relance J+3** — commune créée depuis 3 jours, aucune activité.
4. **Check-in humain J+7** — 7 jours, toujours aucune activité (volontairement sans bouton — l'objectif est une réponse humaine, pas un clic).
5. **Encouragement J+7** — 7 jours, au moins une activité détectée.
6. **Upsell** — **règle dure : jamais sur un critère de date**, uniquement quand la commune a réalisé 3 types d'événements distincts (article + calendrier déchets + clic module verrouillé). Jamais envoyé à un simple citoyen.

⚠️ Le bouton **"▶ Lancer la séquence maintenant"** (sur une fiche commune) traite **toutes** les communes éligibles à cet instant, pas seulement celle affichée — de vrais emails partent. **Ne jamais l'utiliser en dehors d'un test avec une commune de test dédiée**, sauf instruction explicite de Léandre.

---

## 6. Gérer une commune cliente

### 6.1 Ouvrir une fiche

Depuis "Communes clientes" ou Ctrl/Cmd+K.

### 6.2 Forfait et modules

Boutons rapides "🆓 Passer en Gratuit" / "💶 Passer en Version complète", ou case par case (14 modules). Passer en Gratuit vide automatiquement le prix et l'échéance.

### 6.3 Abonnement et formule tarifaire

Choisis une formule (Autonomie/Accompagné/Premium) → le prix suggéré se calcule en direct selon la population de la commune → **"Appliquer ce tarif"** ne fait que préremplir le champ, le prix réellement facturé (`Prix TTC/an`) reste **toujours modifiable à la main**. Pour Premium, coche "1re année" seulement si c'est une création (chasse au trésor incluse) — décoche pour un renouvellement.

### 6.4 Devis & facturation

Cycle complet, intégré dans la fiche commune :

```
Devis : envoyé → accepté → (bon de commande reçu) → Facturer
Facture : émise → déposée sur Chorus Pro → payée
```

1. **Créer un devis** : le bloc "Préremplir depuis une formule" calcule objet + montant automatiquement (modifiable ensuite).
2. Une fois le devis **accepté**, marque le **bon de commande comme reçu** avant de pouvoir facturer.
3. **"Facturer"** n'apparaît que si : accepté + bon de commande reçu + pas déjà facturé.
4. Une facture "**payée**" avance automatiquement la prochaine échéance d'abonnement de la commune — pas besoin de le refaire à la main dans l'onglet Abonnement.
5. **Le dépôt du PDF sur Chorus Pro reste entièrement manuel** — aucune intégration automatique (obligatoire pour toute administration publique depuis 2020).

### 6.5 Gérer les utilisateurs d'une commune

Bouton "👥 Gérer les utilisateurs" sur la fiche.

- **+ Ajouter un utilisateur** : rôles possibles = citoyen / admin / élu / maire (jamais superadmin, exclu du formulaire).
- **Réinitialiser le mot de passe** : affiché une seule fois à l'écran, jamais envoyé par email — à communiquer toi-même à la personne.
- **🗑 Supprimer un compte** : ceci **anonymise** le compte (RGPD), ce n'est **pas réversible**. Le contenu déjà publié reste, mais l'identité est effacée.

### 6.6 Les trois façons d'accéder au compte d'une commune — ne pas les confondre

| Action | Effet | Quand l'utiliser |
|---|---|---|
| 🔑 Se connecter en tant que | Ouvre une session sans toucher au mot de passe du maire | Cas général, réutilisable à volonté |
| Renvoyer les accès | **Écrase le mot de passe actuel** du maire | Uniquement si la personne a vraiment perdu ses accès |
| 🔗 Lien de connexion directe | Lien à usage unique, valable 48h | Pour l'envoyer par email à quelqu'un qui n'a pas encore de mot de passe en tête |

### 6.7 Statut client

`active` / `suspendue` / `résiliée`. ⚠️ Résilier une commune qui payait réellement génère un événement de churn suivi dans les stats — jamais si elle était déjà gratuite.

### 6.8 RGPD

Section dédiée sur la fiche : nombre d'exports de données demandés, comptes anonymisés, détail des 8 derniers exports.

---

## 7. Suivi commercial (lecture seule pour un VA sauf instruction contraire)

- **Activité** : flux de toutes les inscriptions/publications citoyennes, toutes communes confondues.
- **Chiffre d'affaires** : distingue strictement le **Réel encaissé** (factures payées) de la **Projection** (abonnements actifs théoriques) — jamais additionnés. Le **Churn** ne suit que les vraies pertes (communes qui payaient avant).

---

## 8. Réglages — ce qui est routine vs ce qui nécessite validation de Léandre

| Tiroir | Peut être touché en routine ? |
|---|---|
| 🔧 Diagnostic email (tests d'envoi) | ✅ Oui, sans risque (marqué "test", exclu des stats) |
| 📝 Textes de l'app (popup module verrouillé, checklist) | ✅ Oui si demandé |
| ✉️ Modèles d'email (A/B testing) | ⚠️ Modifier le texte oui, mais **ne jamais changer la variante active** sans validation |
| 🆓 Palier gratuit | ❌ **Jamais sans validation** — rétroactif sur toutes les communes gratuites |
| 💶 Mois offerts / grille legacy | ❌ Jamais sans validation |
| 📐 Tarification de la landing (barème + textes des offres) | ❌ Jamais sans validation — visible publiquement |
| 🧾 Informations légales entreprise | ❌ Jamais sans validation — apparaît sur chaque facture |
| 🧑‍💼 Comptes staff | ❌ Jamais — demande à Léandre |

---

## 9. Les règles à ne jamais enfreindre — checklist condensée

- ☐ Jamais de relance en lot pour un prospect "perdu" — toujours en direct, personnalisé.
- ☐ Une demande explicite de "ne plus être contacté" va au statut **"Ne plus contacter"**, pas "Perdu" (qui reprogrammerait une relance dans 10 mois).
- ☐ Jamais "Lancer la séquence maintenant" hors test, sauf instruction explicite.
- ☐ "Renvoyer les accès" écrase le mot de passe — vérifier que c'est vraiment nécessaire avant de cliquer.
- ☐ Jamais toucher au Palier gratuit / à la Tarification / aux Comptes staff sans validation de Léandre.
- ☐ Un bounce générique (souvent un filtrage anti-spam ponctuel, ex. Orange/Wanadoo) n'est pas forcément une adresse morte — ne pas la considérer comme définitivement invalide sans vérifier.
- ☐ La suppression d'un utilisateur est une anonymisation **irréversible**.
- ☐ Le prix suggéré par une formule tarifaire n'est qu'indicatif — toujours vérifier le prix réellement enregistré avant de facturer.

---

## Glossaire des statuts

**Prospect** : à_contacter · contacté · relance · rdv · gagné · perdu · ne_plus_contacter
**Devis** : envoyé · accepté · refusé · expiré
**Facture** : émise · déposée_chorus · payée
**Commune** : statut client = active · suspendue · résiliée ; forfait = Gratuit · Version complète (ou personnalisé module par module)
