// worker/src/routes/profil.ts
import { Hono } from 'hono';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect } from '../db';
import { xpRequisPourNiveau } from '../lib/gamification';
import { calculerPalierCourant } from '../lib/points-citoyens';

const app = new Hono();
app.use('*', jwtMiddleware);

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'nom,prenom,email,role,xp,niveau,streak_actuel,streak_record,created_at,'
      + 'score_citoyen,streak_participation_actuel,streak_participation_record,streak_mensuel_citoyen_actuel,suspendu_jusqu_au',
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

  const participation = await construireBlocParticipation(c.env, commune_id, user_id, user);

  return c.json({
    ...user,
    xp_niveau_actuel: xpNiveauActuel,
    xp_niveau_suivant: xpNiveauSuivant,
    badges,
    participation,
  });
});

// Score de participation citoyenne — système séparé de l'XP/niveau ci-dessus (voir
// worker/src/lib/points-citoyens.ts). Purement additif : n'affecte aucun champ existant.
async function construireBlocParticipation(env: any, commune_id: string, user_id: string, user: any) {
  const [palier, badgesCitoyens, historique, debloques] = await Promise.all([
    calculerPalierCourant(env, commune_id, user.score_citoyen ?? 0),
    supabaseSelect(env, 'badges_citoyens', {
      select: 'id,cle,nom,description,visuel_url', commune_id: `eq.${commune_id}`, actif: 'eq.true', order: 'ordre.asc',
    }),
    supabaseSelect(env, 'points_citoyens_history', {
      select: 'raison,montant,type_mouvement,created_at,valide_par',
      commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, order: 'created_at.desc', limit: '30',
    }),
    supabaseSelect(env, 'user_badges_citoyens', {
      select: 'badge_id,debloque_le', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
    }),
  ]);

  const debloqueLePar = new Map(debloques.map((d: any) => [d.badge_id, d.debloque_le]));

  const idsValideurs = [...new Set(historique.map((h: any) => h.valide_par).filter(Boolean))];
  const valideurs = idsValideurs.length ? await supabaseSelect(env, 'users', {
    select: 'id,prenom,nom', commune_id: `eq.${commune_id}`, id: `in.(${idsValideurs.join(',')})`,
  }) : [];
  const nomValideur = (id: string | null) => {
    if (!id) return null;
    const v = valideurs.find((u: any) => u.id === id);
    return v ? `${v.prenom} ${v.nom}` : null;
  };

  return {
    score_citoyen: user.score_citoyen ?? 0,
    streak_actuel: user.streak_participation_actuel ?? 0,
    streak_record: user.streak_participation_record ?? 0,
    streak_mensuel_actuel: user.streak_mensuel_citoyen_actuel ?? 0,
    palier_actuel: palier.actuel,
    palier_suivant: palier.suivant,
    progression_pct: palier.progression_pct,
    suspendu_jusqu_au: user.suspendu_jusqu_au ?? null,
    badges: badgesCitoyens.map((b: any) => ({
      cle: b.cle, nom: b.nom, description: b.description, visuel_url: b.visuel_url,
      debloque: debloqueLePar.has(b.id), debloque_le: debloqueLePar.get(b.id) ?? null,
    })),
    historique_recent: historique.map((h: any) => ({
      raison: h.raison, montant: h.montant, type_mouvement: h.type_mouvement, created_at: h.created_at,
      valide_par_nom: nomValideur(h.valide_par),
    })),
  };
}

export default app;
