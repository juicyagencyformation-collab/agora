// worker/test/publications-commerces-moderation.test.ts
// 2026-11-26, migration 122 : un commerce (ou artisan) publie par son responsable validé, 2 fois
// par 7 jours ; la mairie retire une publication avec un motif (email à l'auteur, trace), suspend
// une fiche 7/30/90 jours ; les actualités partagées vont dans « Autour de moi » des communes
// voisines, qui peuvent les masquer chez elles sans rien toucher chez la commune d'origine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import actus from '../src/routes/actus';
import agenda from '../src/routes/agenda';
import annuaire from '../src/routes/annuaire';
import moderation from '../src/routes/moderation';
import decouverte from '../src/routes/decouverte';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let emails: any[];
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET,
  R2_PUBLIC_BASE: 'https://cdn.test', RESEND_API_KEY: 'cle-test', FRONTEND_URL: 'https://plateforme-agora.fr',
};
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
  if (url.host === 'api.resend.com') {
    emails.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify({ id: `email-${emails.length}` }), { status: 200 }));
  }
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

const cookie = async (user_id: string, role: string, commune_id = 'c1') => ({
  Cookie: `agora_access=${await sign({ user_id, commune_id, role, exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}`,
});
const appel = async (app: any, chemin: string, methode: string, user_id: string, role: string, corps?: object, commune_id = 'c1') =>
  app.request(chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(await cookie(user_id, role, commune_id)) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  }, ENV, FAUX_EXECUTION_CTX);

const COMMERCE = 'f0000000-0000-4000-8000-000000000002';
const ARTICLE = { titre: 'Galette des rois', contenu_html: '<p>En vente dès lundi</p>', fiche_id: COMMERCE };
const ilYa = (jours: number) => new Date(Date.now() - jours * 86400000).toISOString();
const P_PARTAGE = 'a0000000-0000-4000-8000-00000000000a';
const P_CHEZ_MOI = 'a0000000-0000-4000-8000-00000000000b';
const E_VOISIN = 'e0000000-0000-4000-8000-00000000000c';
const dans = (h: number) => new Date(Date.now() + h * 3600000).toISOString();

beforeEach(() => {
  emails = [];
  db = {
    annuaire: [{ id: COMMERCE, commune_id: 'c1', user_id: null, nom: 'Boulangerie Martin', categorie: 'commerce', logo_url: null }],
    annuaire_responsables: [{ id: 'r1', commune_id: 'c1', fiche_id: COMMERCE, user_id: 'u-boulanger', statut: 'actif' }],
    annuaire_documents: [],
    onglets_config: [],
    articles: [], article_images: [], article_sondages: [], article_sondage_choix: [], article_sondage_votes: [],
    articles_lus_par_utilisateur: [], events: [], event_attendees: [], participations_citoyennes: [],
    publications_signalements: [], activation_events: [], moderation_decisions: [], partages_masques: [], chartes_lues: [],
    users: [
      { id: 'u-boulanger', commune_id: 'c1', prenom: 'Jean', nom: 'Martin', email: 'jean@boulangerie.test', xp: 0 },
      { id: 'u-habitant', commune_id: 'c1', prenom: 'Lucie', nom: 'D', email: 'lucie@test.fr', xp: 0 },
    ],
    communes: [
      { id: 'c1', nom: 'Eaucourt', slug: 'eaucourt-test', lat: 50.06, lng: 1.88, partage_regional: true, niveau_national: false, email_mairie: 'mairie@eaucourt.test' },
      { id: 'c2', nom: 'Pont-Remy', slug: 'pont-remy', lat: 50.05, lng: 1.91, partage_regional: true, niveau_national: false },
      { id: 'c-nat', nom: 'Plateforme-Agora', slug: 'plateforme-agora', lat: null, lng: null, partage_regional: true, niveau_national: true },
    ],
    push_subscriptions: [],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('Publications d\'un commerce', () => {
  it('le responsable validé publie, sans partage par défaut ; partage si la case est cochée', async () => {
    expect((await appel(actus, '/', 'POST', 'u-boulanger', 'citoyen', ARTICLE)).status).toBe(201);
    expect(db.articles[0]).toMatchObject({ fiche_id: COMMERCE, partage_autour: false });
    expect((await appel(actus, '/', 'POST', 'u-boulanger', 'citoyen', { ...ARTICLE, partage_autour: true })).status).toBe(201);
    expect(db.articles[1].partage_autour).toBe(true);
  });
  it('plafonne à 2 publications sur 7 jours (actus + événements) ; plus ancien ne compte pas ; pas pour la mairie', async () => {
    db.articles.push({ id: 'a-vieux', commune_id: 'c1', fiche_id: COMMERCE, created_at: ilYa(8) });
    db.articles.push({ id: 'a1', commune_id: 'c1', fiche_id: COMMERCE, created_at: ilYa(5) });
    expect((await appel(actus, '/', 'POST', 'u-boulanger', 'citoyen', ARTICLE)).status).toBe(201);
    const refus = await appel(agenda, '/', 'POST', 'u-boulanger', 'citoyen', { titre: 'Dégustation', date_debut: dans(24), date_fin: dans(26), fiche_id: COMMERCE });
    expect(refus.status).toBe(429);
    expect(((await refus.json()) as any).erreur).toContain('2 publications par commerce sur 7 jours');
    expect((await appel(actus, '/', 'POST', 'u-maire', 'maire', ARTICLE)).status).toBe(201);
  });
  it('une fiche de service public ne publie pas', async () => {
    db.annuaire[0].categorie = 'service_public';
    expect((await appel(actus, '/', 'POST', 'u-boulanger', 'citoyen', ARTICLE)).status).toBe(403);
  });
});

describe('Suspension par la mairie', () => {
  it('suspend 7 jours avec motif : email au responsable, trace, publication refusée ; levée ensuite', async () => {
    expect((await appel(annuaire, `/${COMMERCE}/suspendre`, 'POST', 'u-habitant', 'citoyen', { jours: 7, motif: 'publicite' })).status).toBe(403);
    expect((await appel(annuaire, `/${COMMERCE}/suspendre`, 'POST', 'u-maire', 'maire', { jours: 10, motif: 'publicite' })).status).toBe(400);
    expect((await appel(annuaire, `/${COMMERCE}/suspendre`, 'POST', 'u-maire', 'maire', { jours: 7, motif: 'publicite' })).status).toBe(200);

    expect(db.annuaire[0].publications_suspendues_jusqu).toBe(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('jean@boulangerie.test');
    expect(emails[0].reply_to).toBe('mairie@eaucourt.test');
    expect(emails[0].html).toContain('Publicité excessive');
    expect(db.moderation_decisions[0]).toMatchObject({ type: 'suspension', fiche_id: COMMERCE, motif: 'publicite', auteur_prevenu: true });

    expect((await appel(actus, '/', 'POST', 'u-boulanger', 'citoyen', ARTICLE)).status).toBe(403);
    const menu: any = await (await appel(annuaire, '/publier-pour', 'GET', 'u-boulanger', 'citoyen')).json();
    expect(menu.associations).toHaveLength(0);
    const liste: any = await (await appel(annuaire, '/', 'GET', 'u-habitant', 'citoyen')).json();
    expect(liste.fiches[0].suspendue_jusqu).toBeNull(); // jamais affiché aux autres habitants

    expect((await appel(annuaire, `/${COMMERCE}/suspendre`, 'DELETE', 'u-maire', 'maire')).status).toBe(200);
    expect((await appel(actus, '/', 'POST', 'u-boulanger', 'citoyen', ARTICLE)).status).toBe(201);
    expect(db.moderation_decisions.map((d) => d.type)).toEqual(['suspension', 'fin_suspension']);
  });
});

describe('Retrait motivé', () => {
  beforeEach(() => {
    db.articles.push(
      { id: 'a-com', commune_id: 'c1', section: 'actualites', archive: false, titre: 'Promo', fiche_id: COMMERCE, auteur_id: 'u-boulanger', statut: 'visible', created_at: new Date().toISOString() },
      { id: 'a-mairie', commune_id: 'c1', section: 'actualites', archive: false, titre: 'Voirie', fiche_id: null, auteur_id: 'u-maire', statut: 'visible', created_at: new Date().toISOString() },
    );
  });
  it('masque, prévient l\'auteur avec le motif et la charte, trace ; la mairie voit le motif', async () => {
    expect((await appel(actus, '/a-com/retirer', 'POST', 'u-habitant', 'citoyen', { motif: 'publicite' })).status).toBe(403);
    expect((await appel(actus, '/a-com/retirer', 'POST', 'u-maire', 'maire', { motif: 'inconnu' })).status).toBe(400);
    expect((await appel(actus, '/a-com/retirer', 'POST', 'u-maire', 'maire', { motif: 'autre' })).status).toBe(400);
    const res = await appel(actus, '/a-com/retirer', 'POST', 'u-maire', 'maire', { motif: 'publicite', precision: 'Troisième promo cette semaine' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).auteur_prevenu).toBe(true);

    expect(db.articles[0].statut).toBe('masquee');
    expect(emails).toHaveLength(1); // auteur = responsable : un seul email
    expect(emails[0].html).toContain('charte-publication.html#article-3');
    expect(emails[0].html).toContain('Troisième promo cette semaine');
    expect(db.moderation_decisions[0]).toMatchObject({ type: 'retrait', article_id: 'a-com', motif: 'publicite', auteur_prevenu: true });

    const vuMairie: any = await (await appel(actus, '/', 'GET', 'u-maire', 'maire')).json();
    expect(vuMairie.articles.find((a: any) => a.id === 'a-com').motif_retrait).toBe('Publicité excessive ou répétée');
    const vuHabitant: any = await (await appel(actus, '/', 'GET', 'u-habitant', 'citoyen')).json();
    expect(vuHabitant.articles.map((a: any) => a.id)).toEqual(['a-mairie']);

    expect((await appel(actus, '/a-com/restaurer', 'PATCH', 'u-maire', 'maire')).status).toBe(200);
    expect(db.moderation_decisions.map((d) => d.type)).toEqual(['retrait', 'restauration']);
    const histo: any = await (await appel(moderation, '/publications/decisions', 'GET', 'u-maire', 'maire')).json();
    expect(histo.decisions[0]).toMatchObject({ titre: 'Promo' });
  });
  it('une publication de la mairie ne se « retire » pas (elle se modifie)', async () => {
    expect((await appel(actus, '/a-mairie/retirer', 'POST', 'u-maire', 'maire', { motif: 'doublon' })).status).toBe(400);
  });
  it('une autre commune ne peut pas retirer (cloisonnement)', async () => {
    expect((await appel(actus, '/a-com/retirer', 'POST', 'u-maire2', 'maire', { motif: 'publicite' }, 'c2')).status).toBe(404);
    expect(db.articles[0].statut).toBe('visible');
  });
  it('fonctionne aussi pour un événement d\'habitant', async () => {
    db.events.push({ id: 'e-hab', commune_id: 'c1', titre: 'Vide-grenier', officiel: false, user_id: 'u-habitant', fiche_id: null, statut: 'visible' });
    expect((await appel(agenda, '/e-hab/retirer', 'POST', 'u-maire', 'maire', { motif: 'hors_sujet' })).status).toBe(200);
    expect(db.events[0].statut).toBe('masquee');
    expect(emails[0].to).toBe('lucie@test.fr');
  });
});

describe('Actualités partagées « Autour de moi »', () => {
  const base = { section: 'actualites', archive: false, statut: 'visible', created_at: new Date().toISOString(), contenu_html: '<p>Bonjour <b>à tous</b></p>', fiche_id: null };
  beforeEach(() => {
    db.articles.push(
      { ...base, id: P_PARTAGE, commune_id: 'c2', titre: 'Fête du village', partage_autour: true },
      { ...base, id: 'p-prive', commune_id: 'c2', titre: 'Conseil interne', partage_autour: false },
      { ...base, id: 'p-masquee', commune_id: 'c2', titre: 'Signalée', partage_autour: true, statut: 'masquee' },
      { ...base, id: 'p-vieille', commune_id: 'c2', titre: 'Ancienne', partage_autour: true, created_at: ilYa(40) },
      { ...base, id: 'p-nationale', commune_id: 'c-nat', titre: 'Article éditorial', partage_autour: true },
      { ...base, id: P_CHEZ_MOI, commune_id: 'c1', titre: 'Chez moi', partage_autour: true },
    );
  });
  const lire = async () => (await (await decouverte.request('/actualites?lat=50.06&lng=1.88&exclure=eaucourt-test', {}, ENV, FAUX_EXECUTION_CTX)).json()) as any;

  it('seules les actualités partagées, visibles, récentes, d\'une commune voisine non nationale', async () => {
    const r = await lire();
    expect(r.actualites.map((a: any) => a.id)).toEqual([P_PARTAGE]);
    expect(r.actualites[0]).toMatchObject({ commune_nom: 'Pont-Remy', extrait: 'Bonjour à tous' });
    expect(r.actualites[0].contenu_html).toBeUndefined();
  });
  it('« Masquer chez nous » : disparaît pour la commune qui masque, rien ne change chez l\'autre', async () => {
    expect((await appel(moderation, '/publications/partages-masques', 'POST', 'u-habitant', 'citoyen', { article_id: P_PARTAGE })).status).toBe(403);
    expect((await appel(moderation, '/publications/partages-masques', 'POST', 'u-maire', 'maire', { article_id: P_CHEZ_MOI })).status).toBe(400);
    expect((await appel(moderation, '/publications/partages-masques', 'POST', 'u-maire', 'maire', { article_id: P_PARTAGE })).status).toBe(200);
    expect((await lire()).actualites).toHaveLength(0);
    expect(db.articles.find((a) => a.id === P_PARTAGE)!.statut).toBe('visible');
    const vuAilleurs: any = await (await decouverte.request('/actualites?lat=50.06&lng=1.88', {}, ENV, FAUX_EXECUTION_CTX)).json();
    expect(vuAilleurs.actualites.map((a: any) => a.id)).toContain(P_PARTAGE);

    expect((await appel(moderation, '/publications/partages-masques', 'DELETE', 'u-maire', 'maire', { article_id: P_PARTAGE })).status).toBe(200);
    expect((await lire()).actualites).toHaveLength(1);
  });
  it('masquer un événement partagé l\'exclut aussi de /evenements', async () => {
    db.events.push({ id: E_VOISIN, commune_id: 'c2', titre: 'Brocante', officiel: true, partage_autour: true, statut: 'visible', date_debut: dans(24), date_fin: dans(26) });
    const avant: any = await (await decouverte.request('/evenements?lat=50.06&lng=1.88&exclure=eaucourt-test', {}, ENV, FAUX_EXECUTION_CTX)).json();
    expect(avant.evenements.map((e: any) => e.id)).toEqual([E_VOISIN]);
    expect((await appel(moderation, '/publications/partages-masques', 'POST', 'u-maire', 'maire', { event_id: E_VOISIN })).status).toBe(200);
    const apres: any = await (await decouverte.request('/evenements?lat=50.06&lng=1.88&exclure=eaucourt-test', {}, ENV, FAUX_EXECUTION_CTX)).json();
    expect(apres.evenements).toHaveLength(0);
  });
});

describe('Charte de publication lue (migration 123)', () => {
  it('à lire pour un responsable et la mairie, jamais pour un simple habitant ; « J\'ai lu » fait preuve', async () => {
    const etat = async (u: string, role: string) => ((await (await appel(annuaire, '/charte', 'GET', u, role)).json()) as any).a_lire;
    expect(await etat('u-boulanger', 'citoyen')).toBe(true);
    expect(await etat('u-habitant', 'citoyen')).toBe(false);
    expect(await etat('u-maire', 'maire')).toBe(true);

    expect((await appel(annuaire, '/charte/lue', 'POST', 'u-boulanger', 'citoyen')).status).toBe(200);
    expect((await appel(annuaire, '/charte/lue', 'POST', 'u-boulanger', 'citoyen')).status).toBe(200);
    expect(db.chartes_lues).toHaveLength(1); // une seule preuve par version
    expect(db.chartes_lues[0]).toMatchObject({ commune_id: 'c1', user_id: 'u-boulanger', version: '2026-11-26' });
    expect(await etat('u-boulanger', 'citoyen')).toBe(false);

    const liste: any = await (await appel(annuaire, `/${COMMERCE}/responsables`, 'GET', 'u-maire', 'maire')).json();
    expect(liste.responsables[0].charte_lue_le).toBeTruthy();
  });
});
