// worker/src/routes/actus.ts
import { estGestionnaire } from '../lib/permissions';
import { Hono } from 'hono';
import { z } from 'zod';
import { jwtMiddleware } from '../middleware/jwt';
import { supabaseInsert, supabaseUpdate, supabaseDelete, supabaseSelect } from '../db';
import { uploaderFichier, deleteObject } from '../storage';
import { sanitizeHtml } from '../lib/sanitize';
import { attribuerXp, XP_ACTIONS, incrementerCompteurUtilisateur } from '../lib/gamification';
import { envoyerNotificationAUtilisateurs, utilisateursAbonnesA } from '../lib/push';

const app = new Hono();
app.use('*', jwtMiddleware);

// /actus dessert deux onglets distincts (Actualités et Conseil) selon le champ "section",
// donc le contrôle d'onglet actif se fait ici plutôt qu'en middleware générique.
async function ongletActifPourSection(env: any, commune_id: string, section: string): Promise<boolean> {
  const cle = section === 'conseil' ? 'conseil' : 'actualites';
  const [row] = await supabaseSelect(env, 'onglets_config', {
    select: 'actif', commune_id: `eq.${commune_id}`, cle: `eq.${cle}`,
  });
  return row?.actif !== false; // pas de ligne configurée = actif par défaut
}

const choixSchema = z.object({ label: z.string().min(1).max(120) });
const sondageSchema = z.object({
  question: z.string().min(1).max(200),
  multi_choix: z.boolean().default(false),
  choix: z.array(choixSchema).min(2).max(10),
  closes_at: z.string().datetime().optional(),
});
const CATEGORIES_VALIDES = ['vie_village', 'projets_travaux', 'environnement', 'agenda', 'info_pratique'] as const;

const articleSchema = z.object({
  section: z.enum(['actualites', 'conseil']).default('actualites'),
  categorie: z.enum(CATEGORIES_VALIDES).default('vie_village'),
  titre: z.string().min(1).max(200),
  contenu_html: z.string().min(1).max(20000),
  image_r2_keys: z.array(z.string()).max(10).optional(),
  image_ids_supprimees: z.array(z.string().uuid()).max(20).optional(),
  archive: z.boolean().optional(),
  sondage: sondageSchema.optional().nullable(),
  fichier_pv_url: z.string().url().optional(),
  fichier_pv_type: z.enum(['pdf', 'image']).optional(),
});

app.get('/', async (c) => {
  const commune_id = c.get('commune_id');
  const curseur = c.req.query('curseur');
  const section = c.req.query('section') ?? 'actualites';

  if (!(await ongletActifPourSection(c.env, commune_id, section))) {
    return c.json({ erreur: 'Onglet désactivé par la mairie' }, 403);
  }

  const filtres: Record<string, string> = {
    select: 'id,titre,contenu_html,categorie,auteur_id,created_at,updated_at,fichier_pv_url,fichier_pv_type,archive',
    commune_id: `eq.${commune_id}`,
    section: `eq.${section}`,
    order: 'created_at.desc',
    limit: '20',
  };
  // Par défaut : le fil principal (archive=false). ?archives=true : la section Archives,
  // consultable par tous (les actus archivées restent lisibles, juste hors du fil courant).
  filtres.archive = c.req.query('archives') === 'true' ? 'eq.true' : 'eq.false';
  if (curseur) filtres.created_at = `lt.${curseur}`;
  const categorieFiltre = c.req.query('categorie');
  if (categorieFiltre && CATEGORIES_VALIDES.includes(categorieFiltre as any)) filtres.categorie = `eq.${categorieFiltre}`;

  const articles = await supabaseSelect(c.env, 'articles', filtres);
  const ids = articles.map((a: any) => a.id);
  const [images, sondages] = await Promise.all([
    ids.length ? supabaseSelect(c.env, 'article_images', {
      select: 'id,article_id,url,ordre',
      commune_id: `eq.${commune_id}`,
      article_id: `in.(${ids.join(',')})`,
      order: 'ordre.asc',
    }) : [],
    ids.length ? supabaseSelect(c.env, 'article_sondages', {
      select: 'id,article_id,question,multi_choix,closes_at',
      commune_id: `eq.${commune_id}`,
      article_id: `in.(${ids.join(',')})`,
    }) : [],
  ]);

  const sondageIds = sondages.map((s: any) => s.id);
  const [choix, votes] = await Promise.all([
    sondageIds.length ? supabaseSelect(c.env, 'article_sondage_choix', {
      select: 'id,sondage_id,label,ordre',
      commune_id: `eq.${commune_id}`,
      sondage_id: `in.(${sondageIds.join(',')})`,
      order: 'ordre.asc',
    }) : [],
    sondageIds.length ? supabaseSelect(c.env, 'article_sondage_votes', {
      select: 'sondage_id,choix_id,user_id',
      commune_id: `eq.${commune_id}`,
      sondage_id: `in.(${sondageIds.join(',')})`,
    }) : [],
  ]);

  const user_id = c.get('user_id');
  const sondagesComplets = sondages.map((s: any) => {
    const choixSondage = choix.filter((ch: any) => ch.sondage_id === s.id);
    const votesSondage = votes.filter((v: any) => v.sondage_id === s.id);
    return {
      ...s,
      choix: choixSondage.map((ch: any) => ({
        id: ch.id, label: ch.label,
        total: votesSondage.filter((v: any) => v.choix_id === ch.id).length,
      })),
      total_votes: votesSondage.length,
      mes_votes: votesSondage.filter((v: any) => v.user_id === user_id).map((v: any) => v.choix_id),
    };
  });

  const user_id_lecteur = c.get('user_id');
  const mesLectures = ids.length ? await supabaseSelect(c.env, 'articles_lus_par_utilisateur', {
    select: 'article_id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id_lecteur}`,
    article_id: `in.(${ids.join(',')})`,
  }) : [];
  const idsArticlesLus = new Set(mesLectures.map((l: any) => l.article_id));

  const result = articles.map((a: any) => ({
    ...a,
    images: images.filter((i: any) => i.article_id === a.id),
    sondage: sondagesComplets.find((s: any) => s.article_id === a.id) ?? null,
    deja_lu: idsArticlesLus.has(a.id),
  }));

  return c.json({ articles: result, commune_id });
});

app.post('/', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  const body = articleSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  if (!(await ongletActifPourSection(c.env, commune_id, data.section))) {
    return c.json({ erreur: 'Onglet désactivé par la mairie' }, 403);
  }

  const contenu_html = sanitizeHtml(data.contenu_html);

  const [article] = await supabaseInsert(c.env, 'articles', {
    commune_id, auteur_id: user_id, section: data.section, categorie: data.categorie,
    titre: data.titre, contenu_html,
    fichier_pv_url: data.fichier_pv_url ?? null,
    fichier_pv_type: data.fichier_pv_type ?? null,
  });

  if (data.image_r2_keys?.length) {
    await supabaseInsert(c.env, 'article_images', data.image_r2_keys.map((key, i) => ({
      commune_id, article_id: article.id, r2_key: key,
      url: `${c.env.R2_PUBLIC_BASE}/${key}`, ordre: i,
    })));
  }

  if (data.sondage) {
    const [sondage] = await supabaseInsert(c.env, 'article_sondages', {
      commune_id, article_id: article.id,
      question: data.sondage.question,
      multi_choix: data.sondage.multi_choix,
      closes_at: data.sondage.closes_at ?? null,
    });
    await supabaseInsert(c.env, 'article_sondage_choix', data.sondage.choix.map((ch, i) => ({
      commune_id, sondage_id: sondage.id, label: ch.label, ordre: i,
    })));
  }

  if (data.section === 'actualites') {
    c.executionCtx.waitUntil((async () => {
      const abonnes = await utilisateursAbonnesA(c.env, commune_id, 'notif_articles');
      await envoyerNotificationAUtilisateurs(
        c.env, commune_id, abonnes.filter((id: string) => id !== user_id),
        '📰 Nouvel article', data.titre, `/index.html?onglet=actualites&type=article&id=${article.id}`,
      );
    })());
  }

  return c.json({ article_id: article.id }, 201);
});

app.patch('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const article_id = c.req.param('id');

  const partialSchema = articleSchema.partial();
  const body = partialSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const patch: Record<string, unknown> = {};
  if (body.data.titre) patch.titre = body.data.titre;
  if (body.data.contenu_html) patch.contenu_html = sanitizeHtml(body.data.contenu_html);
  if (body.data.categorie) patch.categorie = body.data.categorie;
  if (body.data.archive !== undefined) patch.archive = body.data.archive;
  patch.updated_at = new Date().toISOString();

  await supabaseUpdate(c.env, 'articles', patch, {
    id: `eq.${article_id}`, commune_id: `eq.${commune_id}`,
  });

  // Suppression des photos retirées : l'objet R2 puis la ligne (filtrée aussi par
  // article_id/commune_id pour ne jamais toucher les images d'un autre article/tenant).
  const idsSupprimes = body.data.image_ids_supprimees ?? [];
  if (idsSupprimes.length) {
    const aSupprimer = await supabaseSelect(c.env, 'article_images', {
      select: 'id,r2_key', commune_id: `eq.${commune_id}`,
      article_id: `eq.${article_id}`, id: `in.(${idsSupprimes.join(',')})`,
    });
    await Promise.all(aSupprimer.map((img: any) => deleteObject(c.env, img.r2_key)));
    if (aSupprimer.length) {
      await supabaseDelete(c.env, 'article_images', {
        id: `in.(${aSupprimer.map((img: any) => img.id).join(',')})`,
        article_id: `eq.${article_id}`, commune_id: `eq.${commune_id}`,
      });
    }
  }

  // Ajout des nouvelles photos, à la suite des existantes (ordre incrémental).
  if (body.data.image_r2_keys?.length) {
    const existantes = await supabaseSelect(c.env, 'article_images', {
      select: 'ordre', commune_id: `eq.${commune_id}`, article_id: `eq.${article_id}`,
    });
    const ordreDepart = existantes.length ? Math.max(...existantes.map((i: any) => i.ordre ?? 0)) + 1 : 0;
    await supabaseInsert(c.env, 'article_images', body.data.image_r2_keys.map((key, i) => ({
      commune_id, article_id, r2_key: key,
      url: `${c.env.R2_PUBLIC_BASE}/${key}`, ordre: ordreDepart + i,
    })));
  }

  return c.json({ ok: true });
});

app.delete('/:id', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const article_id = c.req.param('id');

  const images = await supabaseSelect(c.env, 'article_images', {
    select: 'r2_key',
    commune_id: `eq.${commune_id}`,
    article_id: `eq.${article_id}`,
  });
  await Promise.all(images.map((img: any) => deleteObject(c.env, img.r2_key)));

  await supabaseDelete(c.env, 'articles', {
    id: `eq.${article_id}`, commune_id: `eq.${commune_id}`,
  });

  return c.json({ ok: true });
});

app.post('/upload', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  if (!/^image\/(jpeg|png|webp)$/.test(contentType)) {
    return c.json({ erreur: 'Type de fichier non autorisé (jpeg/png/webp uniquement)' }, 400);
  }

  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 8 * 1024 * 1024) {
    return c.json({ erreur: 'Image trop lourde (max 8 Mo)' }, 400);
  }

  const extension = contentType.split('/')[1];
  const key = `${commune_id}/articles/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);
  return c.json({ key, url });
});

app.post('/pv-upload', async (c) => {
  const role = c.get('role');
  if (!estGestionnaire(role)) {
    return c.json({ erreur: 'Réservé aux administrateurs' }, 403);
  }
  const commune_id = c.get('commune_id');
  const contentType = c.req.header('Content-Type') || '';
  const typesAutorises = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  if (!typesAutorises.includes(contentType)) {
    return c.json({ erreur: 'Seuls les fichiers PDF, JPEG et PNG sont acceptés' }, 400);
  }

  const donnees = await c.req.arrayBuffer();
  if (donnees.byteLength > 15 * 1024 * 1024) {
    return c.json({ erreur: 'Fichier trop volumineux (15 Mo maximum)' }, 400);
  }

  const extension = contentType === 'application/pdf' ? 'pdf' : (contentType === 'image/png' ? 'png' : 'jpg');
  const key = `${commune_id}/pv/${crypto.randomUUID()}.${extension}`;
  const url = await uploaderFichier(c.env, key, donnees, contentType);

  return c.json({ url, type: contentType === 'application/pdf' ? 'pdf' : 'image' });
});

app.post('/:id/vote', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const article_id = c.req.param('id');

  const schema = z.object({ choix_ids: z.array(z.string().uuid()).min(1) });
  const body = schema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [sondage] = await supabaseSelect(c.env, 'article_sondages', {
    select: 'id,multi_choix',
    commune_id: `eq.${commune_id}`, article_id: `eq.${article_id}`,
  });
  if (!sondage) return c.json({ erreur: 'Sondage introuvable' }, 404);
  if (!sondage.multi_choix && body.data.choix_ids.length > 1) {
    return c.json({ erreur: 'Une seule réponse autorisée pour ce sondage' }, 400);
  }

  await supabaseInsert(c.env, 'article_sondage_votes', body.data.choix_ids.map((choix_id) => ({
    commune_id, sondage_id: sondage.id, choix_id, user_id,
  })));

  return c.json({ ok: true });
});

// POST /:id/lu — marque un article comme lu (première fois uniquement). +1 XP, et vérifie
// en plus (logique spécifique, hors du mécanisme générique de badges) si l'utilisateur a
// désormais lu au moins un article dans CHACUNE des 5 catégories.
app.post('/:id/lu', async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const article_id = c.req.param('id');

  const [dejaLu] = await supabaseSelect(c.env, 'articles_lus_par_utilisateur', {
    select: 'id', commune_id: `eq.${commune_id}`, article_id: `eq.${article_id}`, user_id: `eq.${user_id}`,
  });
  if (dejaLu) return c.json({ ok: true, deja_lu: true });

  await supabaseInsert(c.env, 'articles_lus_par_utilisateur', { commune_id, article_id, user_id });
  await incrementerCompteurUtilisateur(c.env, commune_id, user_id, 'articles_lus');
  const resultatXp = await attribuerXp(c.env, commune_id, user_id, XP_ACTIONS.lire_article);

  // Badge "Citoyen éclairé" : au moins un article lu dans chacune des 5 catégories.
  const [dejaBadgeComplet] = await supabaseSelect(c.env, 'badges_obtenus', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, cle_badge: 'eq.citoyen_eclaire',
  });
  if (!dejaBadgeComplet) {
    const mesLectures = await supabaseSelect(c.env, 'articles_lus_par_utilisateur', {
      select: 'article_id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`,
    });
    const idsLus = mesLectures.map((l: any) => l.article_id);
    const articlesLus = idsLus.length ? await supabaseSelect(c.env, 'articles', {
      select: 'categorie', commune_id: `eq.${commune_id}`, id: `in.(${idsLus.join(',')})`,
    }) : [];
    const categoriesDistinctes = new Set(articlesLus.map((a: any) => a.categorie));
    if (categoriesDistinctes.size >= CATEGORIES_VALIDES.length) {
      await supabaseInsert(c.env, 'badges_obtenus', { commune_id, user_id, cle_badge: 'citoyen_eclaire' });
      resultatXp.nouveaux_badges = [...resultatXp.nouveaux_badges, 'citoyen_eclaire'];
    }
  }

  return c.json({ ok: true, ...resultatXp });
});

export default app;
