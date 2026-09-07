-- db/migrations/062_communes_formule.sql
-- Formule tarifaire retenue pour la commune (autonomie/accompagne/premium/personnalise) —
-- demandé par Léandre le 2026-09-03 pour remplacer l'ancienne grille par tranches (grille_tarifaire)
-- comme source de suggestion de prix sur la fiche commune et dans le formulaire de devis, au
-- profit du nouveau barème au nombre d'habitants (voir worker/src/backoffice/tarification.ts).
-- Valeurs validées côté Worker (Zod), pas de CHECK ici — même convention que statut sur prospects.
ALTER TABLE communes ADD COLUMN IF NOT EXISTS formule TEXT;
