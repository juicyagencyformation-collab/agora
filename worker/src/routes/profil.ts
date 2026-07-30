// worker/src/routes/profil.ts
import { Hono } from 'hono';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect } from '../db';
import { xpRequisPourNiveau } from '../lib/gamification';

const app = new Hono();
app.use('*', jwtMiddleware);

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'nom,prenom,email,role,xp,niveau,streak_actuel,streak_record,created_at',
    commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return c.json({ erreur: 'Utilisateur introuvable' }, 404);

  const badges = await supabaseSelect(c.env, 'badges_obtenus', {
    select: 'cle_badge,obtenu_at',
    commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
    order: 'obtenu_at.asc',
  });

  const xpNiveauActuel = xpRequisPourNiveau(Math.max(0, user.niveau - 1));
  const xpNiveauSuivant = xpRequisPourNiveau(user.niveau);

  return c.json({
    ...user,
    xp_niveau_actuel: xpNiveauActuel,
    xp_niveau_suivant: xpNiveauSuivant,
    badges,
  });
});

export default app;
