// worker/src/middleware/explorateurs.ts
// Espace « Explorateurs » (migration 098, validé par Léandre le 2026-11-05) : les gens de passage
// s'y créent un compte puis jouent aux chasses et énigmes des villages via routes/jeux_ailleurs.ts.
// Ce verrou, appliqué à TOUTE requête /explorateurs/... (le JWT d'un Explorateur ne lui ouvre
// aucune autre URL, voir middleware/jwt.ts), refuse par défaut tout ce qui n'est pas listé ici :
// un module ajouté demain à l'app reste fermé aux Explorateurs sans qu'on y pense.
import { Context, Next } from 'hono';

export const SLUG_EXPLORATEURS = 'explorateurs';

// auth : inscription, connexion, RGPD (export, suppression) ; commune : nom et couleurs de
// l'espace ; profil et push : réglages du compte ; jeux-ailleurs : le seul accès aux villages.
const MODULES_AUTORISES = ['auth', 'commune', 'jeux-ailleurs', 'profil', 'push'];

export async function gardeEspaceExplorateurs(c: Context, next: Next) {
  if (c.get('slug_commune') !== SLUG_EXPLORATEURS) return next();
  const [, , module, ...reste] = c.req.path.split('/');
  // L'app lit la liste des onglets actifs au démarrage (lecture seule, aucune donnée de village).
  const lectureOnglets = module === 'moderation' && reste.join('/') === 'onglets' && c.req.method === 'GET';
  if (MODULES_AUTORISES.includes(module) || lectureOnglets) return next();
  return c.json({ erreur: 'Espace Explorateurs : seuls les jeux des villages sont accessibles.' }, 403);
}
