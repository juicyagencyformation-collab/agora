// worker/src/lib/communes-test.ts
// Communes de test de Léandre : elles ne sont pas des clientes et ne doivent pas apparaître là
// où un vrai public les verrait.
// - « Commune de démonstration » = decouverte-gratuite (confirmé le 2026-11-04).
// - eaucourt-sur-somme = sa commune d'essai (confirmé le 2026-11-05). À ne JAMAIS confondre avec
//   eaucourt, l'application réelle de son village, utilisée par de vrais habitants.
// Utilisée par :
// - backoffice/suivi-communes.ts : ni suivi, ni anomalies, ni comptage des places fondatrices ;
// - routes/jeux_ailleurs.ts : absentes de la recherche de village. Elles restent jouables par lien
//   direct ou par QR, pour que Léandre puisse tester tout le parcours.
export const SLUGS_COMMUNES_TEST = ['test', 'decouverte-gratuite', 'eaucourt-sur-somme'];
