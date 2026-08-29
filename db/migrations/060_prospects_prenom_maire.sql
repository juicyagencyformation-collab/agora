-- db/migrations/060_prospects_prenom_maire.sql
-- Prénom du maire, stocké séparément du nom_maire déjà combiné ("Prénom Nom", voir
-- formaterNomMaire dans prospection.ts) — nécessaire pour créer un compte maire avec son VRAI
-- prénom/nom (colonnes users.prenom/users.nom) plutôt que le placeholder "Maire de {commune}"
-- utilisé jusqu'ici quand la commune est activée automatiquement à l'envoi de la présentation.
-- Le nom de famille seul se déduit de nom_maire en retirant ce préfixe (voir activerCommuneGratuite
-- et synchroniser-maires dans prospection.ts) : pas besoin d'une colonne de plus pour ça.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS prenom_maire TEXT;
