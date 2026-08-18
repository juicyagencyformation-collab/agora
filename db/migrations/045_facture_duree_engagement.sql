-- db/migrations/045_facture_duree_engagement.sql
-- Dénormalise duree_engagement_mois (déjà sur devis) sur factures, pour que marquer une
-- facture "payée" puisse avancer la prochaine échéance de la commune sans jointure vers le
-- devis d'origine (voir PATCH /administration/factures/:id) — corrige le fait que payer via
-- le circuit devis -> facture ne mettait jamais à jour communes.prochaine_echeance, laissant
-- la commune indéfiniment "en retard" dans le suivi (santé, "Facturation à traiter").
ALTER TABLE factures ADD COLUMN IF NOT EXISTS duree_engagement_mois INTEGER;
