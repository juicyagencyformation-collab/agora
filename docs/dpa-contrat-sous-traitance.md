# Contrat de sous-traitance de données personnelles (article 28 RGPD)

> ⚠️ **Modèle de travail, pas un document juridique finalisé.** Rédigé à partir de l'architecture
> réelle d'Agora (voir CLAUDE.md) et de la documentation publique des sous-traitants ultérieurs
> (Cloudflare, Supabase, Resend). Les champs entre crochets sont à compléter commune par commune.
> **À faire relire par un avocat avant tout envoi signature à une vraie commune** — en particulier
> les articles 6 (responsabilité) et 9 (droit applicable), et pour confirmer la forme juridique
> exacte de Juicy Solutions (SIRET, forme sociale) à faire figurer en en-tête.

---

## Entre les soussignés

**La commune de [NOM DE LA COMMUNE]**, représentée par [M./Mme Prénom NOM], en sa qualité de
maire, dûment habilité(e) à signer les présentes,
ci-après dénommée « **le Responsable du traitement** »,

**ET**

**Juicy Solutions**, [forme juridique à compléter — ex. entreprise individuelle / EI], représentée
par Léandre Sallé, [SIRET à compléter], éditeur et exploitant de la plateforme Agora,
ci-après dénommé « **le Sous-traitant** »,

ci-après ensemble « les Parties ».

## Préambule

Le Responsable du traitement a souscrit à la plateforme citoyenne Agora, éditée et hébergée par
le Sous-traitant, afin d'informer, alerter et faire participer les habitants de la commune. Dans
ce cadre, le Sous-traitant traite des données à caractère personnel pour le compte du Responsable
du traitement. Conformément à l'article 28 du Règlement (UE) 2016/679 (« RGPD »), les Parties
conviennent des dispositions suivantes.

## Article 1 — Objet

Le présent contrat a pour objet de définir les conditions dans lesquelles le Sous-traitant
s'engage à effectuer, pour le compte du Responsable du traitement, les opérations de traitement
de données à caractère personnel décrites à l'article 2.

## Article 2 — Description du traitement confié

| | |
|---|---|
| **Nature des opérations** | Hébergement, collecte, stockage, consultation, modification, envoi d'emails/notifications, suppression — réalisées par l'application Agora |
| **Finalité** | Fonctionnement des services activés par la commune (actualités, alertes, agenda, mur des voisins, coups de main, signalements, sondages, chasse au trésor, annuaire, bulletin, conseil municipal le cas échéant) |
| **Durée** | Durée de l'abonnement de la commune à Agora, augmentée de la durée nécessaire à l'export ou la suppression des données (article 7) |
| **Catégories de personnes concernées** | Habitants et usagers inscrits sur la plateforme ; élus et agents municipaux utilisateurs du back-office |
| **Catégories de données** | Identité (nom, prénom, email, mot de passe haché), contenus publiés (messages, photos, articles, votes, signalements), géolocalisation ponctuelle avec consentement (signalements, jeux), données de connexion |

## Article 3 — Obligations du Sous-traitant

Le Sous-traitant s'engage à :

1. Ne traiter les données que sur instruction documentée du Responsable du traitement, y compris
   en ce qui concerne les transferts de données vers un pays tiers, sauf obligation légale contraire.
2. Garantir la confidentialité des données traitées : accès restreint aux personnes habilitées,
   soumises à une obligation de confidentialité.
3. Mettre en œuvre les mesures techniques et organisationnelles appropriées (art. 32 RGPD), en
   particulier : cloisonnement applicatif strict des données entre communes, hachage des mots de
   passe (PBKDF2, 100 000 itérations), cookies de session sécurisés (httpOnly, chiffrés en
   transit via HTTPS), schéma de modération systématique sur les contenus soumis par les
   habitants (signalement → masquage immédiat → revue de la mairie).
4. Ne recourir à un autre sous-traitant (« sous-traitant ultérieur ») qu'avec l'autorisation écrite,
   préalable et spécifique ou générale du Responsable du traitement — la liste à jour des
   sous-traitants ultérieurs autorisés figure à l'article 5 — et imposer contractuellement à ce
   sous-traitant ultérieur les mêmes obligations de protection des données.
5. Aider le Responsable du traitement, dans la mesure du possible, à répondre aux demandes
   d'exercice des droits des personnes concernées (accès, rectification, effacement, portabilité)
   — Agora fournit à cet effet des fonctionnalités en libre-service (export JSON et suppression
   de compte accessibles depuis le profil de l'habitant).
6. Notifier au Responsable du traitement toute violation de données à caractère personnel dans
   un délai maximal de 72 heures après en avoir pris connaissance.
7. Aider le Responsable du traitement à réaliser les analyses d'impact relatives à la protection
   des données (AIPD) lorsque celles-ci sont requises.
8. Mettre à la disposition du Responsable du traitement les informations nécessaires pour
   démontrer le respect des obligations du présent article, et permettre la réalisation d'audits,
   y compris des inspections, raisonnablement notifiés et dans une mesure proportionnée.

## Article 4 — Obligations du Responsable du traitement

Le Responsable du traitement s'engage à :

1. Fournir au Sous-traitant les données nécessaires à la réalisation des services demandés.
2. Documenter par écrit toute instruction concernant le traitement des données par le
   Sous-traitant.
3. Veiller, préalablement et pendant toute la durée du traitement, au respect des obligations
   prévues par le RGPD de son côté (information des habitants, recueil du consentement lorsque
   requis, détermination de la base légale de chaque traitement).
4. Désigner, le cas échéant, un délégué à la protection des données (DPO) et en transmettre les
   coordonnées au Sous-traitant.

## Article 5 — Sous-traitants ultérieurs autorisés

Le Responsable du traitement autorise expressément le Sous-traitant à recourir aux sous-traitants
ultérieurs suivants, chacun agissant dans les conditions résumées ci-dessous (vérifié en octobre
2026 ; voir les DPA publics de chaque prestataire pour le détail contractuel) :

| Sous-traitant ultérieur | Rôle | Localisation des données | Garantie de transfert |
|---|---|---|---|
| Cloudflare, Inc. | Hébergement applicatif (Workers, Pages), stockage de fichiers (R2) | Réseau mondial (edge) ; traitement transitoire possible hors UE | DPA Cloudflare (SCC + certification EU-US Data Privacy Framework) |
| Supabase Inc. | Base de données | Région UE (Frankfurt, eu-central-1) | DPA Supabase ; hébergement pinné en UE |
| Resend | Envoi d'emails (confirmation de compte, notifications, bilans d'activité) | États-Unis | DPA Resend avec clauses contractuelles types (SCC) |
| Cloudflare Workers AI | Modération automatique des photos par IA (communes en formule Accompagné/Premium ayant activé l'option) | Réseau mondial (edge) ; aucune conservation de l'image après analyse, aucun usage pour l'entraînement de modèles | DPA Cloudflare (même cadre que ci-dessus) |

Le Sous-traitant informe le Responsable du traitement de tout changement prévu concernant
l'ajout ou le remplacement d'un sous-traitant ultérieur, lui donnant ainsi la possibilité
d'émettre des objections.

## Article 6 — Transferts hors Union européenne

Les données personnelles sont, par défaut, stockées dans l'Union européenne (base de données
Supabase hébergée en région Frankfurt). Certains traitements transitoires ou techniques
(délivrance applicative via le réseau Cloudflare, envoi d'emails via Resend) peuvent impliquer un
traitement ou un stockage hors UE, dans les conditions encadrées par les clauses contractuelles
types de la Commission européenne et/ou une certification au Data Privacy Framework, conformément
aux DPA publics des prestataires concernés. Ces traitements ne constituent pas un partage des
données à des fins commerciales ou d'entraînement de modèles tiers.

## Article 7 — Sort des données à l'issue du contrat

Au terme du contrat d'abonnement, quelle qu'en soit la cause, le Sous-traitant, au choix du
Responsable du traitement :

- restitue l'intégralité des données dans un format structuré et couramment utilisé (export
  disponible depuis le back-office ou sur demande), puis les supprime de ses systèmes et de ceux
  de ses sous-traitants ultérieurs dans un délai de [30] jours ; ou
- procède directement à leur suppression/anonymisation dans les mêmes délais,

sauf obligation légale contraire imposant leur conservation.

## Article 8 — Responsabilité

[À compléter avec un avocat — répartition de responsabilité en cas de manquement de l'une des
Parties à ses obligations respectives au titre du RGPD et du présent contrat.]

## Article 9 — Durée, droit applicable et juridiction

Le présent contrat prend effet à la date de signature et pour la durée de l'abonnement de la
commune à Agora. Il est soumis au droit français. [Juridiction compétente à confirmer avec un
avocat.]

---

Fait en deux exemplaires,

À [lieu], le [date]

| Pour la commune de [NOM] | Pour Juicy Solutions |
|---|---|
| [Nom, qualité, signature] | Léandre Sallé, signature |
