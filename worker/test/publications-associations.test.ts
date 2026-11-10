// worker/test/publications-associations.test.ts
// Espace des associations, lot 2 (migration 102) : un responsable actif publie actualités et
// événements au nom de son association ; personne d'autre ne le peut ; offre payante (annuaire
// actif) ; plafond sur 24 h ; règle n°4 (signalement → masquage → revue mairie) ; pas de points
// à la lecture ; partage « Autour de moi » des événements d'association, jamais des masqués.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import actus from '../src/routes/actus';
import agenda from '../src/routes/agenda';
import decouverte from '../src/routes/decouverte';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET, R2_PUBLIC_BASE: 'https://cdn.test' };
const FAUX_EXECUTION_CTX = { waitUntil: (p: Promise<any>) => { p.catch(() => {}); }, passThroughOnException: () => {} };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre === 'is.null') return valeur == null;
  if (filtre === 'not.is.null') return valeur != null;
  if (filtre.startsWith('gte.')) return new Date(valeur).getTime() >= new Date(filtre.slice(4)).getTime();
  if (filtre.startsWith('lt.')) return new Date(valeur).getTime() < new Date(filtre.slice(3)).getTime();
  return true;
}
// or=(col.op.valeur,col.op.valeur) — au moins une condition vraie.
function correspondOu(l: Ligne, expr: string): boolean {
  return expr.slice(1, -1).split(',').some((cond) => {
    const i = cond.indexOf('.');
    return correspond(l[cond.slice(0, i)], cond.slice(i + 1));
  });
}
const filtrer = (table: Ligne[], p: URLSearchParams) => table.filter((l) => [...p.entries()].every(([k, v]) =>
  ['select', 'order', 'limit', 'offset'].includes(k) || (k === 'or' ? correspondOu(l, v) : correspond(l[k], v))));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') return Promise.resolve(new Response(JSON.stringify(filtrer(db[table] || [], url.searchParams)), { status: 200 }));
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const lignes = (Array.isArray(corps) ? corps : [corps]).map((l) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), statut: 'visible', ...l }));
    (db[table] ??= []).push(...lignes);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const visees = filtrer(db[table] || [], url.searchParams);
    visees.forEach((l) => Object.assign(l, JSON.parse(String(init.body))));
    return Promise.resolve(new Response(JSON.stringify(visees), { status: 200 }));
  }
  if (methode === 'DELETE') {
    const visees = new Set(filtrer(db[table] || [], url.searchParams));
    db[table] = (db[table] || []).filter((l) => !visees.has(l));
    return Promise.resolve(new Response('[]', { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const cookie = async (user_id: string, role: string) => ({
  Cookie: `agora_access=${await sign({ user_id, commune_id: 'c1', role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
});
const appel = async (app: any, chemin: string, methode: string, user_id: string, role: string, corps?: object) =>
  app.request(chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(await cookie(user_id, role)) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  }, ENV, FAUX_EXECUTION_CTX);

const ARTICLE = { titre: 'Loto du comité', contenu_html: '<p>Samedi à 20 h</p>', fiche_id: 'f0000000-0000-4000-8000-000000000001' };
const FICHE = ARTICLE.fiche_id;
const dans = (h: number) => new Date(Date.now() + h * 3600000).toISOString();
const EVENT = { titre: 'Loto', date_debut: dans(48), date_fin: dans(52), fiche_id: FICHE };

beforeEach(() => {
  db = {
    annuaire: [{ id: FICHE, commune_id: 'c1', nom: 'Comité des fêtes', categorie: 'association', logo_url: null }],
    annuaire_responsables: [
      { id: 'r1', commune_id: 'c1', fiche_id: FICHE, user_id: 'u-resp', statut: 'actif' },
      { id: 'r2', commune_id: 'c1', fiche_id: FICHE, user_id: 'u-attente', statut: 'demande' },
      { id: 'r3', commune_id: 'c1', fiche_id: FICHE, user_id: 'u-resp2', statut: 'actif' },
    ],
    onglets_config: [],
    articles: [], article_images: [], article_sondages: [], article_sondage_choix: [], article_sondage_votes: [],
    articles_lus_par_utilisateur: [], events: [], event_attendees: [], participations_citoyennes: [],
    publications_signalements: [], activation_events: [],
    users: [{ id: 'u-resp', commune_id: 'c1', prenom: 'Paul', nom: 'M', xp: 0 }],
    communes: [{ id: 'c1', nom: 'Eaucourt', slug: 'eaucourt-test', lat: 50.06, lng: 1.88, partage_regional: true, niveau_national: false }],
    push_subscriptions: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Actualités au nom d\'une association', () => {
  it('un responsable actif publie, sans notification ni indicateur d\'activation de la mairie', async () => {
    expect((await appel(actus, '/', 'POST', 'u-resp', 'citoyen', ARTICLE)).status).toBe(201);
    expect(db.articles[0]).toMatchObject({ fiche_id: FICHE, auteur_id: 'u-resp', section: 'actualites' });
    expect(db.activation_events).toHaveLength(0);
  });
  it('refuse un habitant non responsable, ou dont la demande est en attente', async () => {
    expect((await appel(actus, '/', 'POST', 'u-autre', 'citoyen', ARTICLE)).status).toBe(403);
    expect((await appel(actus, '/', 'POST', 'u-attente', 'citoyen', ARTICLE)).status).toBe(403);
    expect((await appel(actus, '/', 'POST', 'u-resp', 'citoyen', { ...ARTICLE, fiche_id: undefined })).status).toBe(403);
    expect(db.articles).toHaveLength(0);
  });
  it('refuse si l\'annuaire n\'est pas actif (offre gratuite)', async () => {
    db.onglets_config.push({ commune_id: 'c1', cle: 'annuaire', actif: false });
    expect((await appel(actus, '/', 'POST', 'u-resp', 'citoyen', ARTICLE)).status).toBe(403);
  });
  it('jamais dans la section Conseil', async () => {
    expect((await appel(actus, '/', 'POST', 'u-resp', 'citoyen', { ...ARTICLE, section: 'conseil' })).status).toBe(400);
  });
  it('plafonne à 3 publications sur 24 h (actus + événements), pas pour la mairie', async () => {
    const maintenant = new Date().toISOString();
    db.articles.push({ id: 'a1', commune_id: 'c1', fiche_id: FICHE, created_at: maintenant }, { id: 'a2', commune_id: 'c1', fiche_id: FICHE, created_at: maintenant });
    db.events.push({ id: 'e1', commune_id: 'c1', fiche_id: FICHE, created_at: maintenant });
    expect((await appel(actus, '/', 'POST', 'u-resp', 'citoyen', ARTICLE)).status).toBe(429);
    expect((await appel(actus, '/', 'POST', 'u-maire', 'maire', ARTICLE)).status).toBe(201);
  });
  it('un responsable gère les articles de son association, jamais ceux de la mairie', async () => {
    db.articles.push(
      { id: 'a-asso', commune_id: 'c1', fiche_id: FICHE, auteur_id: 'u-resp2', statut: 'visible' },
      { id: 'a-mairie', commune_id: 'c1', fiche_id: null, auteur_id: 'u-maire', statut: 'visible' },
    );
    expect((await appel(actus, '/a-asso', 'PATCH', 'u-resp', 'citoyen', { titre: 'Nouveau titre' })).status).toBe(200);
    expect(db.articles[0].titre).toBe('Nouveau titre');
    expect((await appel(actus, '/a-mairie', 'PATCH', 'u-resp', 'citoyen', { titre: 'Piratage' })).status).toBe(403);
    expect((await appel(actus, '/a-mairie', 'DELETE', 'u-resp', 'citoyen')).status).toBe(403);
    expect((await appel(actus, '/a-asso', 'DELETE', 'u-autre', 'citoyen')).status).toBe(403);
    expect((await appel(actus, '/a-asso', 'DELETE', 'u-resp', 'citoyen')).status).toBe(200);
    expect(db.articles.map((a) => a.id)).toEqual(['a-mairie']);
  });
  it('signalement : masque aussitôt, la mairie voit et rétablit ; une actu de mairie ne se signale pas', async () => {
    db.articles.push(
      { id: 'a-asso', commune_id: 'c1', section: 'actualites', archive: false, fiche_id: FICHE, statut: 'visible', created_at: new Date().toISOString() },
      { id: 'a-mairie', commune_id: 'c1', section: 'actualites', archive: false, fiche_id: null, statut: 'visible', created_at: new Date().toISOString() },
    );
    expect((await appel(actus, '/a-mairie/signaler', 'POST', 'u-autre', 'citoyen')).status).toBe(400);
    expect((await appel(actus, '/a-asso/signaler', 'POST', 'u-autre', 'citoyen')).status).toBe(200);
    expect(db.articles[0].statut).toBe('masquee');
    expect(db.publications_signalements[0]).toMatchObject({ article_id: 'a-asso', user_id: 'u-autre' });

    const vuHabitant: any = await (await appel(actus, '/', 'GET', 'u-autre', 'citoyen')).json();
    expect(vuHabitant.articles.map((a: any) => a.id)).toEqual(['a-mairie']);
    const vuMairie: any = await (await appel(actus, '/', 'GET', 'u-maire', 'maire')).json();
    expect(vuMairie.articles.find((a: any) => a.id === 'a-asso')).toMatchObject({ statut: 'masquee', association: { nom: 'Comité des fêtes' } });

    expect((await appel(actus, '/a-asso/restaurer', 'PATCH', 'u-resp', 'citoyen')).status).toBe(403);
    expect((await appel(actus, '/a-asso/restaurer', 'PATCH', 'u-maire', 'maire')).status).toBe(200);
    expect(db.articles[0].statut).toBe('visible');
  });
  it('filtre Mairie / Associations', async () => {
    db.articles.push(
      { id: 'a-asso', commune_id: 'c1', section: 'actualites', archive: false, fiche_id: FICHE, statut: 'visible', created_at: new Date().toISOString() },
      { id: 'a-mairie', commune_id: 'c1', section: 'actualites', archive: false, fiche_id: null, statut: 'visible', created_at: new Date().toISOString() },
    );
    const asso: any = await (await appel(actus, '/?source=associations', 'GET', 'u-autre', 'citoyen')).json();
    expect(asso.articles.map((a: any) => a.id)).toEqual(['a-asso']);
    const mairie: any = await (await appel(actus, '/?source=mairie', 'GET', 'u-autre', 'citoyen')).json();
    expect(mairie.articles.map((a: any) => a.id)).toEqual(['a-mairie']);
  });
  it('lire une actualité d\'association ne rapporte aucun point', async () => {
    db.articles.push({ id: 'a-asso', commune_id: 'c1', fiche_id: FICHE, categorie: 'vie_village' });
    const corps: any = await (await appel(actus, '/a-asso/lu', 'POST', 'u-resp', 'citoyen')).json();
    expect(corps.xp_gagne ?? 0).toBe(0);
    expect(db.users[0].xp).toBe(0);
    expect(db.articles_lus_par_utilisateur).toHaveLength(1);
  });
});

describe('Événements au nom d\'une association', () => {
  it('un responsable publie ; un co-responsable le modifie ; un autre habitant non', async () => {
    expect((await appel(agenda, '/', 'POST', 'u-resp', 'citoyen', EVENT)).status).toBe(201);
    const event = db.events[0];
    expect(event).toMatchObject({ fiche_id: FICHE, officiel: false });
    expect((await appel(agenda, `/${event.id}`, 'PATCH', 'u-resp2', 'citoyen', { titre: 'Grand loto' })).status).toBe(200);
    expect((await appel(agenda, `/${event.id}`, 'PATCH', 'u-autre', 'citoyen', { titre: 'Piratage' })).status).toBe(403);
    expect(db.events[0].titre).toBe('Grand loto');
  });
  it('refuse de publier pour une association qu\'on ne gère pas', async () => {
    expect((await appel(agenda, '/', 'POST', 'u-autre', 'citoyen', EVENT)).status).toBe(403);
    expect(db.events).toHaveLength(0);
  });
  it('un événement de la mairie ne se signale pas ; celui d\'un habitant oui', async () => {
    db.events.push(
      { id: 'e-mairie', commune_id: 'c1', officiel: true, statut: 'visible' },
      { id: 'e-habitant', commune_id: 'c1', officiel: false, statut: 'visible' },
    );
    expect((await appel(agenda, '/e-mairie/signaler', 'POST', 'u-autre', 'citoyen')).status).toBe(400);
    expect((await appel(agenda, '/e-habitant/signaler', 'POST', 'u-autre', 'citoyen')).status).toBe(200);
    expect(db.events[1].statut).toBe('masquee');
  });
});

describe('Partage « Autour de moi »', () => {
  it('partage les événements de la mairie et des associations, jamais ceux d\'un habitant ni un masqué', async () => {
    const base = { commune_id: 'c1', partage_autour: true, date_debut: dans(24), date_fin: dans(26), statut: 'visible' };
    db.events.push(
      { ...base, id: 'e-mairie', officiel: true, fiche_id: null },
      { ...base, id: 'e-asso', officiel: false, fiche_id: FICHE },
      { ...base, id: 'e-habitant', officiel: false, fiche_id: null },
      { ...base, id: 'e-asso-masque', officiel: false, fiche_id: FICHE, statut: 'masquee' },
    );
    const res = await decouverte.request('/evenements?lat=50.07&lng=1.89&rayon=20', {}, ENV, FAUX_EXECUTION_CTX);
    const corps: any = await res.json();
    expect(corps.evenements.map((e: any) => e.id).sort()).toEqual(['e-asso', 'e-mairie']);
    expect(corps.evenements.find((e: any) => e.id === 'e-asso').association_nom).toBe('Comité des fêtes');
  });
});
