-- db/migrations/008_participation_citoyenne.sql
-- Système de score de participation citoyenne, séparé de l'XP/niveau existant.
-- ⚠️ Le schéma Supabase réel est en avance sur les migrations commitées dans ce dépôt
-- (colonnes comme users.xp, event_attendees.actif n'apparaissent dans aucun fichier
-- précédent) — vérifier le schéma réel avant d'appliquer, pas seulement ces fichiers.

ALTER TABLE events ADD COLUMN IF NOT EXISTS type_action TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS qr_token UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE events ADD COLUMN IF NOT EXISTS necessite_validation_presence BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users ADD COLUMN IF NOT EXISTS score_citoyen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_participation_actuel INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_participation_record INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_mensuel_citoyen_actuel INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dernier_mois_action_citoyenne TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspendu_jusqu_au DATE;

-- Suivi de la présence vérifiée (scan QR + validation humaine), distinct de la simple
-- inscription "je participe" (event_attendees) qui reste inchangée pour les événements
-- sociaux classiques.
CREATE TABLE IF NOT EXISTS participations_citoyennes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  statut TEXT NOT NULL DEFAULT 'inscrit', -- inscrit|scanne|confirme|non_confirme|no_show|desiste_a_temps|desiste_tardif
  scan_le TIMESTAMPTZ,
  scan_lat DOUBLE PRECISION,
  scan_lng DOUBLE PRECISION,
  hors_geofence BOOLEAN NOT NULL DEFAULT false,
  valide_par UUID REFERENCES users(id),
  valide_le TIMESTAMPTZ,
  contestee_le TIMESTAMPTZ,
  points_attribues INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, user_id)
);

-- Source de vérité pour toute logique en fenêtre glissante (dégressivité anti-farming,
-- plafond hebdomadaire signalements, suspension no-show) — toujours interrogée par
-- comptage, jamais un compteur mis en cache qui ne saurait pas se réinitialiser seul.
CREATE TABLE IF NOT EXISTS points_citoyens_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  event_id UUID REFERENCES events(id),
  alerte_id UUID REFERENCES alertes(id),
  type_mouvement TEXT NOT NULL, -- gain|penalite|bonus
  type_action TEXT,
  montant INTEGER NOT NULL, -- signé : positif pour gain/bonus, négatif pour pénalité
  raison TEXT NOT NULL,
  valide_par UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_points_citoyens_history_user ON points_citoyens_history(commune_id, user_id, type_action, created_at);

-- Badges pilotés en base, gérés exclusivement par le superadmin (distinct du système
-- de badges existant, codé en dur dans worker/src/lib/gamification.ts, qui reste inchangé).
CREATE TABLE IF NOT EXISTS badges_citoyens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  cle TEXT NOT NULL,
  nom TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL, -- seuil|evenement
  declencheur TEXT NOT NULL, -- score_citoyen|streak_participation|premier_signalement_resolu|premiere_action_organisee|valide_par_elu|streak_5_consecutives|streak_mensuel_6
  valeur_seuil INTEGER,
  visuel_url TEXT,
  r2_key TEXT,
  actif BOOLEAN NOT NULL DEFAULT true,
  ordre INTEGER NOT NULL DEFAULT 0,
  cree_par UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(commune_id, cle)
);

CREATE TABLE IF NOT EXISTS user_badges_citoyens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  user_id UUID NOT NULL REFERENCES users(id),
  badge_id UUID NOT NULL REFERENCES badges_citoyens(id),
  debloque_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

-- Paliers de score, seuils modifiables par le superadmin.
CREATE TABLE IF NOT EXISTS paliers_citoyens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commune_id UUID NOT NULL REFERENCES communes(id),
  seuil INTEGER NOT NULL,
  nom TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(commune_id, seuil)
);

-- Seed : paliers par défaut pour chaque commune existante.
INSERT INTO paliers_citoyens (commune_id, seuil, nom, ordre)
SELECT c.id, p.seuil, p.nom, p.ordre
FROM communes c, (VALUES
  (1, 'Premier pas citoyen', 0),
  (150, 'Citoyen engagé', 1),
  (400, 'Citoyen actif', 2),
  (800, 'Pilier de quartier', 3),
  (1500, 'Force motrice', 4),
  (2500, 'Relais citoyen', 5),
  (4000, 'Figure locale', 6),
  (6000, 'Bâtisseur de ville', 7),
  (9000, 'Ambassadeur', 8),
  (13000, 'Voix de la cité', 9),
  (20000, 'Légende citoyenne', 10)
) AS p(seuil, nom, ordre)
ON CONFLICT (commune_id, seuil) DO NOTHING;

-- Seed : badges "événement" système, visuel à uploader ensuite par le superadmin
-- (le design des visuels est explicitement hors du scope technique de cette fonctionnalité).
INSERT INTO badges_citoyens (commune_id, cle, nom, description, type, declencheur, actif, ordre)
SELECT c.id, b.cle, b.nom, b.description, 'evenement', b.declencheur, true, b.ordre
FROM communes c, (VALUES
  ('premier_signalement_resolu', 'Premier signalement résolu', 'Un signalement que tu as fait a été résolu par la mairie.', 'premier_signalement_resolu', 0),
  ('premiere_action_organisee', 'Première action organisée', 'Tu as organisé une action citoyenne menée à son terme.', 'premiere_action_organisee', 1),
  ('valide_par_elu', 'Validé par un élu', 'Ta présence a été validée directement par un élu.', 'valide_par_elu', 2),
  ('serie_5_consecutives', 'Série de 5 actions consécutives', '5 actions validées d''affilée, sans désistement.', 'streak_5_consecutives', 3)
) AS b(cle, nom, description, declencheur, ordre)
ON CONFLICT (commune_id, cle) DO NOTHING;
