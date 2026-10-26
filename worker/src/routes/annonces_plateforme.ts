// worker/src/routes/annonces_plateforme.ts
// Côté application : l'annonce de la plateforme à afficher en bandeau sur l'accueil (voir
// migration 087 et backoffice/annonces-plateforme.ts). Une seule à la fois, la plus importante,
// jamais une déjà lue : on informe sans saturer.
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseInsert } from '../db';
import { regionDeLaCommune } from '../lib/regions';

const app = new Hono();
app.use('*', jwtMiddleware);

const PRIORITE: Record<string, number> = { maintenance: 0, nouveaute: 1, info: 2, astuce: 3 };

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const role = c.get('role');
  try {
    const maintenant = new Date().toISOString();
    // Cas le plus fréquent : aucune annonce en cours → une seule requête, rien d'autre.
    const annonces = await supabaseSelect(c.env, 'annonces_plateforme', {
      select: 'id,type,texte,action,cible,communes_ids,regions,destinataires,created_at',
      debut_le: `lte.${maintenant}`, fin_le: `gt.${maintenant}`,
    });
    if (!annonces.length) return c.json({ annonce: null });

    const region = annonces.some((a: any) => a.cible === 'regions') ? await regionDeLaCommune(c.env, commune_id) : null;
    let visibles = annonces.filter((a: any) =>
      (a.cible === 'toutes'
        || (a.cible === 'communes' && (a.communes_ids ?? []).includes(commune_id))
        || (a.cible === 'regions' && region !== null && (a.regions ?? []).includes(region)))
      && (a.destinataires === 'tous' || estGestionnaire(role)));
    if (!visibles.length) return c.json({ annonce: null });

    const lues = await supabaseSelect(c.env, 'annonces_plateforme_lues', {
      select: 'annonce_id', user_id: `eq.${user_id}`, annonce_id: `in.(${visibles.map((a: any) => a.id).join(',')})`,
    });
    const idsLus = new Set(lues.map((l: any) => l.annonce_id));
    visibles = visibles.filter((a: any) => !idsLus.has(a.id));

    // Inutile d'inviter à noter l'application quelqu'un qui l'a déjà fait.
    if (visibles.some((a: any) => a.action === 'avis')) {
      const avis = await supabaseSelect(c.env, 'avis_application', {
        select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, limit: '1',
      }).catch(() => []);
      if (avis.length) visibles = visibles.filter((a: any) => a.action !== 'avis');
    }
    if (!visibles.length) return c.json({ annonce: null });

    visibles.sort((a: any, b: any) => (PRIORITE[a.type] - PRIORITE[b.type]) || String(b.created_at).localeCompare(String(a.created_at)));
    const { id, type, texte, action } = visibles[0];
    return c.json({ annonce: { id, type, texte, action } });
  } catch (e) {
    console.error('Lecture annonces_plateforme', e);
    return c.json({ annonce: null });
  }
});

// Fermée ou bouton d'action cliqué : ne plus jamais la montrer à cet habitant.
app.post('/:id/lu', async (c) => {
  const id = z.string().uuid().safeParse(c.req.param('id'));
  if (!id.success) return c.json({ erreur: 'Annonce invalide' }, 400);
  try {
    await supabaseInsert(c.env, 'annonces_plateforme_lues', {
      commune_id: c.get('commune_id'), annonce_id: id.data, user_id: c.get('user_id'),
    });
  } catch (e) {
    // Déjà marquée comme lue (contrainte UNIQUE) : le résultat voulu est atteint.
    const msg = String(e);
    if (!msg.includes('23505') && !msg.includes('duplicate') && !msg.includes('409')) console.error('annonces_plateforme_lues', e);
  }
  return c.json({ ok: true });
});

export default app;
