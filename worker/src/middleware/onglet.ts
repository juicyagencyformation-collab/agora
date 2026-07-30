// worker/src/middleware/onglet.ts
import { Context, Next } from 'hono';
import { supabaseSelect } from '../db';

export function requireOngletActif(cle: string) {
  return async (c: Context, next: Next) => {
    const commune_id = c.get('commune_id');
    const rows = await supabaseSelect(c.env, 'onglets_config', {
      select: 'actif',
      commune_id: `eq.${commune_id}`,
      cle: `eq.${cle}`,
    });
    if (rows[0]?.actif === false) {
      return c.json({ erreur: 'Onglet désactivé par la mairie' }, 403);
    }
    await next();
  };
}
