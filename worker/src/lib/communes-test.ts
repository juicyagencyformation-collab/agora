// worker/src/lib/communes-test.ts
// Communes de test de Léandre : elles ne sont pas des clientes et ne doivent pas apparaître là
// où un vrai public les verrait.
// - « Commune de démonstration » = decouverte-gratuite (confirmé le 2026-11-04).
// - eaucourt-sur-somme = sa commune d'essai (confirmé le 2026-11-05). À ne JAMAIS confondre avec
//   eaucourt, l'application réelle de son village, utilisée par de vrais habitants.
// Utilisée par :
// - backoffice/suivi-communes.ts : ni suivi, ni anomalies, ni comptage des places fondatrices ;
// - routes/jeux_ailleurs.ts : absentes de la liste « Villages avec des jeux » (sauf exception
//   ci-dessous). Elles restent jouables par lien direct ou par QR, pour que Léandre puisse tester
//   tout le parcours.
export const SLUGS_COMMUNES_TEST = ['test', 'decouverte-gratuite', 'eaucourt-sur-somme'];

// TEMPORAIRE (demandé par Léandre le 2026-11-05, « on la retirera plus tard ») : sa commune d'essai
// reste visible dans la liste des villages avec des jeux, pour qu'il puisse essayer la liste et
// la carte. À VIDER ([]) quand les vraies communes auront leurs propres jeux.
export const SLUGS_TEST_VISIBLES_DANS_LES_JEUX = ['eaucourt-sur-somme'];
