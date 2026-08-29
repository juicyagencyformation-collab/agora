// worker/src/routes/profil.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseSelect, supabaseUpdate, supabaseInsert } from '../db';
import { hasherMotDePasse, verifierMotDePasse } from '../lib/password';
import { uploaderFichier, deleteObject } from '../storage';
import { xpRequisPourNiveau } from '../lib/gamification';
import { calculerPalierCourant } from '../lib/points-citoyens';

const app = new Hono();
app.use('*', jwtMiddleware);

// Tables où un citoyen publie du contenu qui lui est attribué (user_id) — comptées telles
// quelles (pas de compteur persistant à part) : une ligne encore présente = une contribution
// encore active, le contenu éphémère/expiré déjà purgé (mur, photo du jour, coups de main...)
// disparaît donc de lui-même du total, sans logique supplémentaire à maintenir.
const TABLES_CONTRIBUTIONS = ['alertes', 'posts', 'coups_de_main', 'events', 'annuaire', 'lois_commentaires', 'photos_du_jour', 'photos_enigmes'];

async function compterContributionsActives(env: any, commune_id: string, user_id: string): Promise<number> {
  const comptes = await Promise.all(TABLES_CONTRIBUTIONS.map((table) =>
    supabaseSelect(env, table, { select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}` })
  ));
  return comptes.reduce((total, rows) => total + rows.length, 0);
}

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'nom,prenom,email,role,xp,niveau,streak_actuel,streak_record,created_at,'
      + 'score_citoyen,streak_participation_actuel,streak_participation_record,streak_mensuel_citoyen_actuel,suspendu_jusqu_au,'
      + 'photo_profil_url,banniere_url',
    commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return c.json({ erreur: 'Utilisateur introuvable' }, 404);

  const [badges, contributions_total, avis] = await Promise.all([
    supabaseSelect(c.env, 'badges_obtenus', {
      select: 'cle_badge,obtenu_at',
      commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
      order: 'obtenu_at.asc',
    }),
    compterContributionsActives(c.env, commune_id, user_id),
    // Résilient : si la table avis_application n'existe pas encore (migration 016 non passée),
    // le profil doit quand même se charger (mon_avis = null) au lieu de renvoyer 500.
    supabaseSelect(c.env, 'avis_application', {
      select: 'note,commentaire', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
    }).catch(() => []),
  ]);

  const xpNiveauActuel = xpRequisPourNiveau(Math.max(0, user.niveau - 1));
  const xpNiveauSuivant = xpRequisPourNiveau(user.niveau);

  const participation = await construireBlocParticipation(c.env, commune_id, user_id, user);

  return c.json({
    ...user,
    xp_niveau_actuel: xpNiveauActuel,
    xp_niveau_suivant: xpNiveauSuivant,
    badges,
    contributions_total,
    participation,
    mon_avis: avis[0] ?? null,
  });
});

// PUT /avis — le citoyen note l'application (1 à 5) + commentaire optionnel, depuis son profil.
// Un seul avis par personne (mis à jour s'il existe déjà). Destiné au futur back-office.
app.put('/avis', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const schema = z.object({
    note: z.number().int().min(1).max(5),
    commentaire: z.string().max(1000).optional(),
  });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const commentaire = body.data.commentaire?.trim() || null;

  const [existant] = await supabaseSelect(c.env, 'avis_application', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
  });
  if (existant) {
    await supabaseUpdate(c.env, 'avis_application', {
      note: body.data.note, commentaire, updated_at: new Date().toISOString(),
    }, { id: `eq.${existant.id}`, commune_id: `eq.${commune_id}` });
  } else {
    await supabaseInsert(c.env, 'avis_application', {
      commune_id, user_id, note: body.data.note, commentaire,
    });
  }

  return c.json({ ok: true });
});

// PUT /identite — modifier son prénom et son nom. Ces champs sont lus en direct partout
// (auteur d'une alerte, d'un événement, d'un souvenir...), donc la mise à jour se répercute
// automatiquement sur tout le contenu déjà publié, sans dénormalisation à maintenir.
app.put('/identite', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const schema = z.object({
    prenom: z.string().min(1).max(80),
    nom: z.string().min(1).max(80),
  });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const prenom = body.data.prenom.trim();
  const nom = body.data.nom.trim();
  await supabaseUpdate(c.env, 'users', { prenom, nom }, {
    id: `eq.${user_id}`, commune_id: `eq.${commune_id}`,
  });
  return c.json({ ok: true, prenom, nom });
});

// PUT /mot-de-passe — changer son mot de passe en étant déjà connecté (contrairement à
// /auth/mot-de-passe-oublie + /auth/reinitialiser-mot-de-passe, qui couvrent le cas où on ne PEUT
// plus se connecter). Exige le mot de passe actuel pour éviter qu'une session laissée ouverte sur
// un appareil partagé suffise seule à en changer le mot de passe.
const motDePasseSchema = z.object({
  mot_de_passe_actuel: z.string().min(1),
  nouveau_mot_de_passe: z.string().min(6),
});

app.put('/mot-de-passe', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = motDePasseSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'password_hash', commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });
  if (!user) return c.json({ erreur: 'Utilisateur introuvable' }, 404);

  const actuelValide = await verifierMotDePasse(body.data.mot_de_passe_actuel, user.password_hash);
  if (!actuelValide) return c.json({ erreur: 'Mot de passe actuel incorrect' }, 400);

  const password_hash = await hasherMotDePasse(body.data.nouveau_mot_de_passe);
  await supabaseUpdate(c.env, 'users', { password_hash }, { id: `eq.${user_id}`, commune_id: `eq.${commune_id}` });
  return c.json({ ok: true });
});

// POST /photo — photo de profil personnelle. Remplace le logo de la commune au centre du
// badge XP (repli sur le logo de la commune si absente, comme avant) — voir frontend/js/profil.js.
app.post('/photo', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    return c.json({ erreur: 'Format non autorisé (JPEG, PNG ou WebP uniquement)' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 8 * 1024 * 1024) {
    return c.json({ erreur: 'Image trop lourde (8 Mo maximum)' }, 400);
  }

  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'photo_profil_r2_key', commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });

  const extension = contentType.split('/')[1];
  const key = `${commune_id}/profils/${user_id}/photo-${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);

  if (user?.photo_profil_r2_key) await deleteObject(c.env, user.photo_profil_r2_key);
  await supabaseUpdate(c.env, 'users', { photo_profil_url: url, photo_profil_r2_key: key }, { id: `eq.${user_id}` });

  return c.json({ url });
});

// POST /banniere — image de couverture personnelle, en haut de l'onglet Profil.
app.post('/banniere', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    return c.json({ erreur: 'Format non autorisé (JPEG, PNG ou WebP uniquement)' }, 400);
  }
  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 8 * 1024 * 1024) {
    return c.json({ erreur: 'Image trop lourde (8 Mo maximum)' }, 400);
  }

  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'banniere_r2_key', commune_id: `eq.${commune_id}`, id: `eq.${user_id}`,
  });

  const extension = contentType.split('/')[1];
  const key = `${commune_id}/profils/${user_id}/banniere-${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);

  if (user?.banniere_r2_key) await deleteObject(c.env, user.banniere_r2_key);
  await supabaseUpdate(c.env, 'users', { banniere_url: url, banniere_r2_key: key }, { id: `eq.${user_id}` });

  return c.json({ url });
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
