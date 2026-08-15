// worker/src/auth.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { sign, verify } from '@tsndr/cloudflare-worker-jwt';
import { supabaseSelect, supabaseInsert, supabaseUpdate, supabaseDelete } from './db';
import { jwtMiddleware } from './middleware/jwt';
import { gererConnexionQuotidienne, verifierBadges } from './lib/gamification';
import { envoyerEmail } from './lib/email';
import { hasherMotDePasse, verifierMotDePasse } from './lib/password';

const app = new Hono();

async function hasherToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function genererRefreshToken(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  nom: z.string().min(1).max(100),
  prenom: z.string().min(1).max(100),
  consentement_rgpd: z.literal(true),
  site_web: z.string().optional(), // piège à robots (honeypot) — doit toujours rester vide
});

app.post('/register', async (c) => {
  const body = registerSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  const data = body.data;

  // Un vrai utilisateur ne voit ni ne remplit jamais ce champ (masqué en CSS) : s'il est
  // rempli, c'est un robot. On répond succès factice pour ne pas l'alerter, sans rien créer.
  if (data.site_web) return c.json({ ok: true }, 201);

  const commune_id = c.get('commune_id_resolue');

  const [existant] = await supabaseSelect(c.env, 'users', {
    select: 'id', commune_id: `eq.${commune_id}`, email: `eq.${data.email}`,
  });
  if (existant) return c.json({ erreur: 'Un compte existe déjà avec cet email' }, 400);

  const password_hash = await hasherMotDePasse(data.password);
  const [user] = await supabaseInsert(c.env, 'users', {
    commune_id, email: data.email, password_hash, nom: data.nom, prenom: data.prenom,
    role: 'citoyen', consentement_rgpd_le: new Date().toISOString(),
  });

  // Connexion automatique après inscription, comme pour /login
  const accessToken = await sign(
    { user_id: user.id, commune_id, role: 'citoyen', exp: Math.floor(Date.now() / 1000) + 900 },
    c.env.JWT_SECRET,
  );
  const refreshToken = genererRefreshToken();
  await supabaseInsert(c.env, 'refresh_tokens', {
    commune_id, user_id: user.id,
    token_hash: await hasherToken(refreshToken),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });

  setCookie(c, 'agora_access', accessToken, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 900 });
  setCookie(c, 'agora_refresh', refreshToken, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 30 * 24 * 3600 });

  return c.json({ ok: true, role: 'citoyen' }, 201);
});

app.post('/login', async (c) => {
  const body = loginSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const commune_id = c.get('commune_id_resolue');

  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'id,role,password_hash',
    commune_id: `eq.${commune_id}`,
    email: `eq.${body.data.email}`,
  });

  if (!user || !(await verifierMotDePasse(body.data.password, user.password_hash))) {
    return c.json({ erreur: 'Email ou mot de passe incorrect' }, 401);
  }

  // Bascule silencieuse vers le nouveau format si le compte utilisait encore l'ancien
  // (SHA-256 sans sel) — l'utilisateur ne voit rien, aucune action de sa part requise.
  if (!user.password_hash.startsWith('pbkdf2$')) {
    const nouveauHash = await hasherMotDePasse(body.data.password);
    await supabaseUpdate(c.env, 'users', { password_hash: nouveauHash }, { id: `eq.${user.id}` });
  }

  const accessToken = await sign(
    { user_id: user.id, commune_id, role: user.role, exp: Math.floor(Date.now() / 1000) + 900 },
    c.env.JWT_SECRET,
  );

  const refreshToken = genererRefreshToken();
  await supabaseInsert(c.env, 'refresh_tokens', {
    commune_id, user_id: user.id,
    token_hash: await hasherToken(refreshToken),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });

  setCookie(c, 'agora_access', accessToken, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 900 });
  setCookie(c, 'agora_refresh', refreshToken, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 30 * 24 * 3600 });

  const resultatConnexion = await gererConnexionQuotidienne(c.env, commune_id, user.id);
  // Filet de sécurité (badges non liés à l'XP quotidien) — idempotent, ne re-débloque rien.
  const autresBadges = await verifierBadges(c.env, commune_id, user.id);
  const nouveauxBadges = [...new Set([...resultatConnexion.nouveaux_badges, ...autresBadges])];

  // Remontés au client pour être célébrés une fois l'app chargée (voir connexion.html →
  // sessionStorage → navigation.js), car la page de connexion n'a pas l'UI d'animation.
  return c.json({
    ok: true, role: user.role,
    nouveaux_badges: nouveauxBadges,
    niveau: resultatConnexion.niveau,
    monte_de_niveau: resultatConnexion.monte_de_niveau,
    streak_actuel: resultatConnexion.streak_actuel,
    streak_du_jour: resultatConnexion.streak_du_jour,
  });
});

const emailSchema = z.object({ email: z.string().email() });

app.post('/mot-de-passe-oublie', async (c) => {
  const body = emailSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const commune_id = c.get('commune_id_resolue');
  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'id,prenom', commune_id: `eq.${commune_id}`, email: `eq.${body.data.email}`,
  });

  // Toujours la même réponse, que le compte existe ou non — évite de révéler
  // à un attaquant si un email donné correspond à un compte existant.
  if (user) {
    const token = crypto.randomUUID() + crypto.randomUUID();
    await supabaseInsert(c.env, 'password_reset_tokens', {
      commune_id, user_id: user.id,
      token_hash: await hasherToken(token),
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    });

    const slug = c.req.param('slug');
    const lien = `${c.env.FRONTEND_URL}/reinitialiser.html?token=${token}&slug=${slug}`;

    await envoyerEmail(c.env, body.data.email, 'Réinitialisation de votre mot de passe — Agora', `
      <p>Bonjour ${user.prenom},</p>
      <p>Vous avez demandé la réinitialisation de votre mot de passe sur Agora.</p>
      <p><a href="${lien}">Cliquez ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p>
      <p>Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
    `);
  }

  return c.json({ ok: true, message: 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.' });
});

const resetSchema = z.object({
  token: z.string().min(10),
  nouveau_mot_de_passe: z.string().min(6),
});

app.post('/reinitialiser-mot-de-passe', async (c) => {
  const body = resetSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const hash = await hasherToken(body.data.token);
  const [enregistrement] = await supabaseSelect(c.env, 'password_reset_tokens', {
    select: 'id,user_id,expires_at,utilise', token_hash: `eq.${hash}`,
  });

  if (!enregistrement || enregistrement.utilise || new Date(enregistrement.expires_at) < new Date()) {
    return c.json({ erreur: 'Lien invalide ou expiré. Refaites une demande de réinitialisation.' }, 400);
  }

  const password_hash = await hasherMotDePasse(body.data.nouveau_mot_de_passe);
  await supabaseUpdate(c.env, 'users', { password_hash }, { id: `eq.${enregistrement.user_id}` });
  await supabaseUpdate(c.env, 'password_reset_tokens', { utilise: true }, { id: `eq.${enregistrement.id}` });

  // Un reset de mot de passe doit invalider toute session déjà ouverte ailleurs (navigateur
  // oublié, accès non désiré...) — sinon l'ancien mot de passe suffit encore à rester connecté
  // partout où une session tournait déjà. Les accès déjà émis (JWT courte durée, 15 min) ne
  // peuvent pas être révoqués individuellement, mais expirent vite d'eux-mêmes.
  await supabaseUpdate(c.env, 'refresh_tokens', { revoked: true }, { user_id: `eq.${enregistrement.user_id}` });

  return c.json({ ok: true });
});

app.post('/refresh', async (c) => {
  const refreshToken = getCookie(c, 'agora_refresh');
  if (!refreshToken) return c.json({ erreur: 'Session expirée' }, 401);

  const hash = await hasherToken(refreshToken);
  const [enregistrement] = await supabaseSelect(c.env, 'refresh_tokens', {
    select: 'id,commune_id,user_id,expires_at,revoked',
    token_hash: `eq.${hash}`,
  });

  if (!enregistrement || enregistrement.revoked || new Date(enregistrement.expires_at) < new Date()) {
    deleteCookie(c, 'agora_refresh', { path: '/' });
    return c.json({ erreur: 'Session expirée, reconnexion requise' }, 401);
  }

  await supabaseUpdate(c.env, 'refresh_tokens', { revoked: true }, { id: `eq.${enregistrement.id}` });

  const [user] = await supabaseSelect(c.env, 'users', {
    select: 'role', id: `eq.${enregistrement.user_id}`,
  });

  const nouvelAccessToken = await sign(
    { user_id: enregistrement.user_id, commune_id: enregistrement.commune_id, role: user.role, exp: Math.floor(Date.now() / 1000) + 900 },
    c.env.JWT_SECRET,
  );
  const nouveauRefreshToken = genererRefreshToken();
  await supabaseInsert(c.env, 'refresh_tokens', {
    commune_id: enregistrement.commune_id, user_id: enregistrement.user_id,
    token_hash: await hasherToken(nouveauRefreshToken),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  });

  setCookie(c, 'agora_access', nouvelAccessToken, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 900 });
  setCookie(c, 'agora_refresh', nouveauRefreshToken, { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 30 * 24 * 3600 });

  return c.json({ ok: true });
});

app.post('/logout', async (c) => {
  const refreshToken = getCookie(c, 'agora_refresh');
  if (refreshToken) {
    const hash = await hasherToken(refreshToken);
    await supabaseUpdate(c.env, 'refresh_tokens', { revoked: true }, { token_hash: `eq.${hash}` });
  }
  deleteCookie(c, 'agora_access', { path: '/' });
  deleteCookie(c, 'agora_refresh', { path: '/' });
  return c.json({ ok: true });
});

app.get('/me', jwtMiddleware, async (c) => {
  // Appelé à chaque ouverture de l'app (initUtilisateur) : c'est ici qu'on compte la série de
  // connexion quotidienne, pas seulement au login — sinon un citoyen qui reste connecté et
  // rouvre l'app chaque jour ne verrait jamais sa série avancer. Idempotent (1x/jour), donc
  // léger les fois suivantes. Les badges de palier éventuellement débloqués sont renvoyés pour
  // que l'app les célèbre.
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');
  const resultatConnexion = await gererConnexionQuotidienne(c.env, commune_id, user_id);

  return c.json({
    user_id,
    commune_id,
    role: c.get('role'),
    nouveaux_badges: resultatConnexion.nouveaux_badges,
    niveau: resultatConnexion.niveau,
    monte_de_niveau: resultatConnexion.monte_de_niveau,
    streak_actuel: resultatConnexion.streak_actuel,
    streak_du_jour: resultatConnexion.streak_du_jour,
  });
});

// DELETE /moi — droit à l'effacement (RGPD). Le compte est anonymisé plutôt que supprimé :
// les données strictement personnelles sont effacées, mais le contenu créé (articles,
// messages, chasses, votes...) reste intact — il n'est simplement plus rattaché à une
// identité réelle. Supprimer la ligne casserait les contenus communautaires utiles aux
// autres citoyens ; l'anonymisation irréversible est une pratique reconnue conforme au
// droit à l'effacement (recommandation CNIL).
app.delete('/moi', jwtMiddleware, async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  await supabaseDelete(c.env, 'push_subscriptions', { user_id: `eq.${user_id}` });
  await supabaseDelete(c.env, 'refresh_tokens', { user_id: `eq.${user_id}` });
  await supabaseDelete(c.env, 'annuaire', { user_id: `eq.${user_id}`, commune_id: `eq.${commune_id}` });

  // Coordonnées laissées lors d'inscriptions à des événements : effacées, la ligne de
  // participation reste (l'organisateur garde un compte de participants exact).
  await supabaseUpdate(c.env, 'event_attendees', { contact_telephone: null, contact_email: null }, {
    user_id: `eq.${user_id}`, commune_id: `eq.${commune_id}`,
  });

  await supabaseUpdate(c.env, 'users', {
    email: `supprime-${user_id}@anonyme.local`,
    password_hash: crypto.randomUUID(),
    nom: 'Compte',
    prenom: 'supprimé',
    compte_supprime_le: new Date().toISOString(),
  }, { id: `eq.${user_id}`, commune_id: `eq.${commune_id}` });

  deleteCookie(c, 'agora_access', { path: '/' });
  deleteCookie(c, 'agora_refresh', { path: '/' });

  return c.json({ ok: true });
});

// GET /mes-donnees — droit à la portabilité (RGPD) : export structuré de toutes les
// données personnelles et contenus liés au compte, dans un format lisible (JSON).
app.get('/mes-donnees', jwtMiddleware, async (c) => {
  const commune_id = c.get('commune_id');
  const user_id = c.get('user_id');

  // Journal (backoffice) des demandes d'export — purement statistique, ne doit jamais faire
  // échouer l'export lui-même si la table est absente ou l'insert échoue.
  try { await supabaseInsert(c.env, 'exports_rgpd_donnees', { commune_id, user_id }); } catch { /* non bloquant */ }

  // Résilient : une table absente ou une colonne renommée ne doit jamais faire échouer TOUT
  // l'export RGPD (droit à la portabilité). La section concernée revient vide, le reste passe.
  const requete = async (table: string, champs: string) => {
    try {
      return await supabaseSelect(c.env, table, {
        select: champs, user_id: `eq.${user_id}`, commune_id: `eq.${commune_id}`,
      });
    } catch (err) {
      console.warn(`Export RGPD : lecture de "${table}" échouée`, err);
      return [];
    }
  };

  const [profil] = await supabaseSelect(c.env, 'users', {
    select: 'nom,prenom,email,role,xp,niveau,created_at',
    id: `eq.${user_id}`, commune_id: `eq.${commune_id}`,
  });

  const [
    badges, articles, posts, comments, alertes, coupsDeMain, chassesCreees,
    progressionsChasse, enigmesCreees, enigmesTrouvees, photosDuJour,
    events, participationsEvents, votesDeliberation, votesSondage, bulletins, ficheAnnuaire,
  ] = await Promise.all([
    requete('badges_obtenus', 'cle_badge,obtenu_at'),
    requete('articles', 'id,titre,categorie,created_at'),
    requete('posts', 'id,contenu,created_at'),
    requete('comments', 'id,contenu,created_at'),
    requete('alertes', 'id,titre,description,statut,urgent,created_at'),
    requete('coups_de_main', 'id,type,titre,description,created_at'),
    requete('chasses_tresor', 'id,titre,description,created_at'),
    requete('progressions_chasse', 'chasse_id,etape_id,validee_at'),
    requete('photos_enigmes', 'id,indice,created_at'),
    requete('enigme_reussites', 'enigme_id,distance_metres'),
    requete('photos_du_jour', 'id,created_at,libre_de_droit'),
    requete('events', 'id,titre,date_debut,created_at'),
    requete('event_attendees', 'event_id,actif,created_at'),
    requete('votes_deliberation', 'deliberation_id,choix,created_at'),
    requete('votes', 'sondage_id,choix_id,created_at'),
    requete('bulletin_municipal', 'id,titre,statut,created_at'),
    requete('annuaire', 'id,nom,categorie,created_at'),
  ]);

  return c.json({
    export_genere_le: new Date().toISOString(),
    profil,
    badges,
    contenu_publie: {
      articles, posts, comments, alertes,
      coups_de_main: coupsDeMain, chasses_creees: chassesCreees,
      enigmes_creees: enigmesCreees, bulletins, fiche_annuaire: ficheAnnuaire,
    },
    participation: {
      progressions_chasse: progressionsChasse, enigmes_trouvees: enigmesTrouvees,
      photos_du_jour: photosDuJour, events_crees: events,
      participations_evenements: participationsEvents,
      votes_deliberation: votesDeliberation, votes_sondage: votesSondage,
    },
  });
});

export default app;
