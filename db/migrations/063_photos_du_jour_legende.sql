-- db/migrations/063_photos_du_jour_legende.sql
-- Légende optionnelle sur une photo du jour (demandé par Léandre le 2026-09-09). Courte,
-- plafonnée à 140 caractères côté Worker (Zod) — pas de CHECK ici, même convention que le
-- reste du projet.
ALTER TABLE photos_du_jour ADD COLUMN IF NOT EXISTS legende TEXT;
