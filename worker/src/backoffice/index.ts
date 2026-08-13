// worker/src/backoffice/index.ts
// Point d'entrée du backoffice interne Juicy Solutions. Monté sur /backoffice, AVANT la
// résolution de tenant (/:slug/*) dans worker/src/index.ts — sinon "backoffice" serait pris
// pour un slug de commune. Aucune route ici ne dépend d'un commune_id : périmètre transverse.
import { Hono } from 'hono';
import auth from './auth';
import administration from './administration';

const app = new Hono();

app.route('/auth', auth);
app.route('/administration', administration);

export default app;
