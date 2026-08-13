// worker/src/backoffice/index.ts
// Point d'entrée du backoffice interne Juicy Solutions. Monté sur /backoffice, AVANT la
// résolution de tenant (/:slug/*) dans worker/src/index.ts — sinon "backoffice" serait pris
// pour un slug de commune. Aucune route ici ne dépend d'un commune_id : périmètre transverse.
import { Hono } from 'hono';
import auth from './auth';
import administration from './administration';
import prospection from './prospection';
import onboarding from './onboarding';
import { chargerFiche } from './modele-fiche';

const app = new Hono();

// Contenu de la fiche de présentation — PUBLIC (pas d'auth) : la fiche est consultable par les
// communes via le lien de l'email. Contenu marketing uniquement, rien de sensible. L'édition,
// elle, passe par /administration/modele-fiche (protégée).
app.get('/fiche-contenu', async (c) => {
  return c.json(await chargerFiche(c.env));
});

app.route('/auth', auth);
app.route('/administration', administration);
app.route('/prospection', prospection);
app.route('/onboarding', onboarding);

export default app;
