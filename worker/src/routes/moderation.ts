// worker/src/routes/moderation.ts
import { peutGererRoles, peutAttribuerRole } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseUpdate, supabaseInsert } from '../db';

const app = new Hono();
app.use('*', jwtMiddleware);

const ONGLETS_VALIDES = [
  'actualites', 'alertes', 'thermometre', 'mur', 'agenda',
  'coups_de_main', 'chasse_tresor', 'conseil', 'profil', 'annuaire', 'bulletin', 'photo_du_jour', 'enigmes',
] as const;

app.get('/onglets', async (c) => {
  // Accessible à tout utilisateur connecté : savoir quels onglets sont actifs
  // n'est pas sensible, seule la capacité de les modifier l'est (PATCH ci-dessous).
  const commune_id = c.get('commune_id');
  const onglets = await supabaseSelect(c.env, 'onglets_config', {
    select: 'cle,actif',
    commune_id: `eq.${commune_id}`,
  });

  // Complète avec les onglets valides qui n'ont pas encore de ligne en base
  // (nouveaux modules ajoutés après la création de la commune) — actif par défaut.
  const clesExistantes = new Set(onglets.map((o: any) => o.cle));
  const completes = [
    ...onglets,
    ...ONGLETS_VALIDES.filter((cle) => !clesExistantes.has(cle)).map((cle) => ({ cle, actif: true })),
  ];

  return c.json({ onglets: completes });
});

app.patch('/onglets/:cle', async (c) => {
  const role = c.get('role');
  if (role !== 'superadmin') {
    return c.json({ erreur: 'Réservé au superadmin' }, 403);
  }
  const cle = c.req.param('cle');
  if (!ONGLETS_VALIDES.includes(cle as any)) {
    return c.json({ erreur: 'Onglet invalide ou non désactivable' }, 400);
  }
  const commune_id = c.get('commune_id');

  const schema = z.object({ actif: z.boolean() });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [existant] = await supabaseSelect(c.env, 'onglets_config', {
    select: 'id', commune_id: `eq.${commune_id}`, cle: `eq.${cle}`,
  });

  if (existant) {
    await supabaseUpdate(c.env, 'onglets_config', { actif: body.data.actif }, {
      commune_id: `eq.${commune_id}`, cle: `eq.${cle}`,
    });
  } else {
    // Aucune ligne encore créée pour cet onglet (nouveau module) : on la crée à la volée.
    await supabaseInsert(c.env, 'onglets_config', {
      commune_id, cle, actif: body.data.actif,
    });
  }

  return c.json({ ok: true });
});

// GET /moderation/utilisateurs — liste des membres de la commune (élu/superadmin uniquement)
app.get('/utilisateurs', async (c) => {
  const role = c.get('role');
  if (!peutGererRoles(role)) {
    return c.json({ erreur: 'Réservé aux élus et superadmin' }, 403);
  }
  const commune_id = c.get('commune_id');
  const utilisateurs = await supabaseSelect(c.env, 'users', {
    select: 'id,nom,prenom,email,role',
    commune_id: `eq.${commune_id}`,
    order: 'prenom.asc',
  });
  return c.json({ utilisateurs });
});

// PATCH /moderation/utilisateurs/:id/role — attribution de rôle, hiérarchie stricte
app.patch('/utilisateurs/:id/role', async (c) => {
  const roleAppelant = c.get('role');
  const appelantId = c.get('user_id');
  const commune_id = c.get('commune_id');
  const cibleId = c.req.param('id');

  if (!peutGererRoles(roleAppelant)) {
    return c.json({ erreur: 'Réservé aux élus et superadmin' }, 403);
  }
  if (cibleId === appelantId) {
    return c.json({ erreur: 'Impossible de modifier son propre rôle' }, 400);
  }

  const schema = z.object({ role: z.enum(['citoyen', 'admin', 'elu']) });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [cible] = await supabaseSelect(c.env, 'users', {
    select: 'id,role', commune_id: `eq.${commune_id}`, id: `eq.${cibleId}`,
  });
  if (!cible) return c.json({ erreur: 'Utilisateur introuvable' }, 404);

  const verification = peutAttribuerRole(roleAppelant, cible.role, body.data.role);
  if (!verification.ok) {
    return c.json({ erreur: verification.erreur }, 403);
  }

  await supabaseUpdate(c.env, 'users', { role: body.data.role }, {
    id: `eq.${cibleId}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
});

export default app;
