// worker/test/jeux-ailleurs.test.ts
// Couvre routes/jeux_ailleurs.ts : la SEULE exception à la règle « commune_id toujours extrait
// du JWT » (validée par Léandre le 2026-11-03). Ce qu'on verrouille ici : rien ne sort d'autre
// que les jeux actifs (ni qr_token, ni réponse, ni position d'énigme non trouvée) ; seules les
// communes visitables le sont (pas la sienne, pas la démo, pas une suspendue, pas un module
// coupé) ; la réussite est enregistrée chez la commune visitée et l'XP sur le compte du joueur.
// Fausse base Supabase pilotée par fetch(), même esprit que test/decouverte.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import jeuxAilleurs from '../src/routes/jeux_ailleurs';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  JWT_SECRET: 'fake-jwt-secret-suffisamment-long',
};

const QR_FAY = '11111111-1111-4111-8111-111111111111';
const QR_TOURLY = '22222222-2222-4222-8222-222222222222';
const ETAPE_BALADE = '33333333-3333-4333-8333-333333333333';
// Position du joueur au pied de l'étape QR de Fay (le serveur exige d'être à moins de 200 m).
const SUR_PLACE_FAY = { lat: 49.5005, lng: 1.9 };

function reinitialiser() {
  db = {
    communes: [
      { id: 'c-tourly', nom: 'Tourly', slug: 'tourly', statut_client: 'active', rayon_validation_enigme: 40 },
      { id: 'c-fay', nom: 'Fay-les-Étangs', slug: 'fay', statut_client: 'active', departement: '60', rayon_validation_enigme: 40 },
      { id: 'c-demo', nom: 'Bonvivre', slug: 'bonvivre', statut_client: 'active', acces_libre: true },
      { id: 'c-susp', nom: 'Suspendue', slug: 'suspendue', statut_client: 'suspendue' },
      { id: 'c-ferme', nom: 'Fermeville', slug: 'fermeville', statut_client: 'active' },
    ],
    onglets_config: [
      { commune_id: 'c-ferme', cle: 'chasse_tresor', actif: false },
      { commune_id: 'c-ferme', cle: 'enigmes', actif: false },
    ],
    users: [
      { id: 'joueur', commune_id: 'c-tourly', prenom: 'Jean', nom: 'Dupont', affichage_nom: 'initiale', xp: 0, etapes_chasse_validees: 0, enigmes_trouvees: 0 },
      { id: 'habitant-fay', commune_id: 'c-fay', prenom: 'Marie', nom: 'Martin', affichage_nom: 'anonyme', xp: 0 },
    ],
    chasses_tresor: [
      { id: 'ch-fay', commune_id: 'c-fay', titre: 'Le lavoir', actif: true, mode: 'chasse', rayon_metres: 50, created_at: '2026-11-01' },
      { id: 'ch-balade', commune_id: 'c-fay', titre: 'Balade', actif: true, mode: 'balade', rayon_metres: 50, created_at: '2026-11-02' },
      { id: 'ch-tourly', commune_id: 'c-tourly', titre: 'Chez moi', actif: true, mode: 'chasse', rayon_metres: 50, created_at: '2026-11-01' },
    ],
    etapes_chasse: [
      { id: 'et-fay', commune_id: 'c-fay', chasse_id: 'ch-fay', ordre: 0, titre: 'Lavoir', indice: 'Près de l’eau', lat: 49.5, lng: 1.9, qr_token: QR_FAY, type_contenu: 'texte', contenu: 'Construit en 1850', photo_url: 'https://cdn/lavoir.jpg', enigme_reponse: null },
      { id: ETAPE_BALADE, commune_id: 'c-fay', chasse_id: 'ch-balade', ordre: 0, titre: 'Église', indice: 'Le clocher', lat: 49.6, lng: 1.8, qr_token: crypto.randomUUID(), type_contenu: 'enigme', contenu: 'Combien de cloches ?', enigme_reponse: 'trois' },
      { id: 'et-tourly', commune_id: 'c-tourly', chasse_id: 'ch-tourly', ordre: 0, titre: 'Mairie', indice: 'x', lat: 49.1, lng: 1.1, qr_token: QR_TOURLY, type_contenu: 'aucun' },
    ],
    progressions_chasse: [],
    photos_enigmes: [
      { id: 'en-fay', commune_id: 'c-fay', user_id: 'habitant-fay', url: 'https://cdn/x.jpg', indice: 'Un vieux mur', lat: 49.5, lng: 1.9, statut: 'active', created_at: '2026-11-01' },
      { id: 'en-ferme', commune_id: 'c-ferme', user_id: 'x', url: 'https://cdn/y.jpg', lat: 48, lng: 2, statut: 'active', created_at: '2026-11-01' },
    ],
    enigme_reussites: [],
    enigme_signalements: [],
  };
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre === 'not.is.true') return valeur !== true;
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  if (filtre.startsWith('lt.')) return Number(valeur) < Number(filtre.slice(3));
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre.startsWith('not.in.(')) return !filtre.slice(8, -1).split(',').includes(String(valeur));
  if (filtre.startsWith('imatch.')) return new RegExp(filtre.slice(7), 'i').test(String(valeur ?? ''));
  if (filtre.startsWith('ilike.')) {
    const motif = filtre.slice(6).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + motif + '$', 'i').test(String(valeur ?? ''));
  }
  return true;
}

function appliquer(table: Ligne[], params: URLSearchParams): Ligne[] {
  let lignes = [...table];
  for (const [cle, valeur] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  // Projection fidèle au select : un champ non demandé ne doit jamais « fuiter » par le mock.
  const select = params.get('select');
  if (!select || select === '*') return lignes;
  const champs = select.split(',');
  return lignes.map((l) => Object.fromEntries(champs.map((ch) => [ch, l[ch]])));
}

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  if (methode === 'GET') {
    return Promise.resolve(new Response(JSON.stringify(appliquer(db[table] || [], url.searchParams)), { status: 200 }));
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const inserees = (Array.isArray(corps) ? corps : [corps]).map((l: Ligne) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...inserees);
    return Promise.resolve(new Response(JSON.stringify(inserees), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init.body));
    let lignes = db[table] || [];
    for (const [cle, valeur] of url.searchParams.entries()) lignes = lignes.filter((l) => correspond(l[cle], valeur));
    for (const l of lignes) Object.assign(l, corps);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

async function requete(chemin: string, init: RequestInit = {}, user_id = 'joueur', commune_id = 'c-tourly') {
  const jeton = await sign({ user_id, commune_id, role: 'citoyen', exp: Math.floor(Date.now() / 1000) + 600 }, ENV.JWT_SECRET);
  const headers = { ...(init.headers as any), Cookie: `agora_access=${jeton}` };
  return jeuxAilleurs.request(chemin, { ...init, headers }, ENV, { waitUntil: () => {}, passThroughOnException: () => {} } as any);
}
const post = (chemin: string, corps: any) => requete(chemin, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
});

beforeEach(() => { reinitialiser(); vi.stubGlobal('fetch', fetchFake); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('jeux dans une autre commune', () => {
  it('exige d’être connecté', async () => {
    const res = await jeuxAilleurs.request('/fay', {}, ENV);
    expect(res.status).toBe(401);
  });

  it('ne livre que les jeux actifs, sans aucun secret', async () => {
    const res = await requete('/fay');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(['chasses', 'commune', 'enigmes', 'mon_nom_public']);
    expect(data.commune).toEqual({ nom: 'Fay-les-Étangs', slug: 'fay' });
    expect(data.mon_nom_public).toBe('Jean D.');
    const texte = JSON.stringify(data);
    expect(texte).not.toContain(QR_FAY);
    expect(texte).not.toContain('trois');            // réponse d'énigme d'étape
    expect(texte).not.toContain('Marie');            // aucun habitant de Fay
    expect(data.enigmes[0]).not.toHaveProperty('lat'); // position d'énigme non trouvée
    expect(data.chasses.map((c: any) => c.id).sort()).toEqual(['ch-balade', 'ch-fay']);
  });

  it('refuse sa propre commune, la démo, une commune suspendue ou aux jeux coupés', async () => {
    for (const slug of ['tourly', 'bonvivre', 'suspendue', 'fermeville', 'inconnue']) {
      expect((await requete(`/${slug}`)).status, slug).toBe(404);
    }
  });

  it('valide une étape par QR : réussite chez Fay, XP sur le compte de Tourly', async () => {
    const res = await post('/valider-qr', { qr_token: QR_FAY, ...SUR_PLACE_FAY });
    expect(res.status).toBe(200);
    expect((await res.json()).commune_nom).toBe('Fay-les-Étangs');
    expect(db.progressions_chasse).toHaveLength(1);
    expect(db.progressions_chasse[0]).toMatchObject({ commune_id: 'c-fay', user_id: 'joueur', etape_id: 'et-fay' });
    const joueur = db.users.find((u) => u.id === 'joueur')!;
    expect(joueur.xp).toBeGreaterThan(0);
    expect(joueur.etapes_chasse_validees).toBe(1);
    expect(joueur.commune_id).toBe('c-tourly');
  });

  it('ne livre le carnet de découvertes qu’après validation de l’étape, par ce joueur', async () => {
    const avant = await (await requete('/fay')).json();
    expect(JSON.stringify(avant)).not.toContain('Construit en 1850');
    expect(JSON.stringify(avant)).not.toContain('lavoir.jpg');
    expect(avant.chasses.find((c: any) => c.id === 'ch-fay').decouvertes).toEqual([]);
    const validation = await (await post('/valider-qr', { qr_token: QR_FAY, ...SUR_PLACE_FAY })).json();
    // Découverte = texte + photo, révélés ensemble sur place.
    expect(validation.contenu_revele).toEqual({ type: 'texte', texte: 'Construit en 1850', photo_url: 'https://cdn/lavoir.jpg' });
    const apres = (await (await requete('/fay')).json()).chasses.find((c: any) => c.id === 'ch-fay');
    expect(apres.decouvertes).toEqual([{ ordre: 0, titre: 'Lavoir', type: 'texte', texte: 'Construit en 1850', photo_url: 'https://cdn/lavoir.jpg' }]);
    // Balade : l'étape suivante ne transporte jamais le contenu à découvrir ni une réponse.
    const balade = apres && (await (await requete('/fay')).json()).chasses.find((c: any) => c.id === 'ch-balade');
    expect(Object.keys(balade.etape_suivante).sort()).toEqual(['id', 'indice', 'lat', 'lng', 'ordre', 'titre', 'type_contenu']);
  });

  it('point de passage : ne rapporte rien ; la fin du parcours rapporte le bonus', async () => {
    const GR1 = '44444444-4444-4444-8444-444444444441';
    const GR2 = '44444444-4444-4444-8444-444444444442';
    db.chasses_tresor.push({ id: 'ch-gr', commune_id: 'c-fay', titre: 'Sentier GR', actif: true, mode: 'balade', rayon_metres: 50, created_at: '2026-11-03' });
    db.etapes_chasse.push(
      { id: GR1, commune_id: 'c-fay', chasse_id: 'ch-gr', ordre: 0, titre: 'Carrefour', indice: 'Le croisement', lat: 49.7, lng: 1.7, qr_token: crypto.randomUUID(), type_contenu: 'aucun', contenu: 'Prenez le sentier à gauche' },
      { id: GR2, commune_id: 'c-fay', chasse_id: 'ch-gr', ordre: 1, titre: 'Moulin', indice: 'Au bord de l’eau', lat: 49.71, lng: 1.7, qr_token: crypto.randomUUID(), type_contenu: 'texte', contenu: 'Moulin de 1780' },
    );
    const joueur = () => db.users.find((u) => u.id === 'joueur')!;
    const passage = await (await post('/fay/chasses-tresor/valider-position', { etape_id: GR1, lat: 49.7, lng: 1.7 })).json();
    expect(passage).toMatchObject({ ok: true, point_de_passage: true, parcours_termine: false, contenu_revele: { type: 'consigne', texte: 'Prenez le sentier à gauche' } });
    expect(passage.xp_gagne).toBeUndefined();
    expect(joueur().xp).toBe(0);
    expect(joueur().etapes_chasse_validees).toBe(0);
    // La consigne n'entre jamais dans le carnet de découvertes.
    const gr = (await (await requete('/fay')).json()).chasses.find((c: any) => c.id === 'ch-gr');
    expect(gr.decouvertes).toEqual([]);

    const fin = await (await post('/fay/chasses-tresor/valider-position', { etape_id: GR2, lat: 49.71, lng: 1.7 })).json();
    expect(fin).toMatchObject({ ok: true, point_de_passage: false, parcours_termine: true, xp_gagne: 70 }); // 20 (étape) + 50 (fin)
    expect(joueur().etapes_chasse_validees).toBe(1);
    expect(joueur().chasses_terminees).toBe(1);
  });

  it('point de passage manqué (poche, réseau) : rattrapé avec l’étape suivante ; une découverte manquée bloque toujours', async () => {
    const P1 = '55555555-5555-4555-8555-555555555551';
    const D2 = '55555555-5555-4555-8555-555555555552';
    const D3 = '55555555-5555-4555-8555-555555555553';
    db.chasses_tresor.push({ id: 'ch-rando', commune_id: 'c-fay', titre: 'Rando', actif: true, mode: 'balade', rayon_metres: 50, created_at: '2026-11-04' });
    db.etapes_chasse.push(
      { id: P1, commune_id: 'c-fay', chasse_id: 'ch-rando', ordre: 0, titre: 'Carrefour', indice: 'x', lat: 49.8, lng: 1.6, type_contenu: 'aucun', qr_token: crypto.randomUUID() },
      { id: D2, commune_id: 'c-fay', chasse_id: 'ch-rando', ordre: 1, titre: 'Moulin', indice: 'y', lat: 49.81, lng: 1.6, type_contenu: 'texte', contenu: 'Moulin', qr_token: crypto.randomUUID() },
      { id: D3, commune_id: 'c-fay', chasse_id: 'ch-rando', ordre: 2, titre: 'Église', indice: 'z', lat: 49.82, lng: 1.6, type_contenu: 'texte', contenu: 'Église', qr_token: crypto.randomUUID() },
    );
    // L'église avant le moulin : refusée (une découverte manque).
    expect((await post('/fay/chasses-tresor/valider-position', { etape_id: D3, lat: 49.82, lng: 1.6 })).status).toBe(400);
    // Le moulin sans être passé par le carrefour : accepté, le carrefour est coché avec.
    const moulin = await (await post('/fay/chasses-tresor/valider-position', { etape_id: D2, lat: 49.81, lng: 1.6 })).json();
    expect(moulin).toMatchObject({ ok: true, passages_rattrapes: 1, xp_gagne: 20 });
    const validees = db.progressions_chasse.filter((pr) => pr.chasse_id === 'ch-rando').map((pr) => pr.etape_id).sort();
    expect(validees).toEqual([P1, D2].sort());
  });

  it('refuse un QR scanné loin de l’étape, ou sans position', async () => {
    const loin = await post('/valider-qr', { qr_token: QR_FAY, lat: 48.85, lng: 2.35 }); // depuis Paris
    expect(loin.status).toBe(400);
    expect((await loin.json()).erreur).toMatch(/se valide sur place/);
    const sansPosition = await post('/valider-qr', { qr_token: QR_FAY });
    expect(sansPosition.status).toBe(400);
    expect(db.progressions_chasse).toHaveLength(0);
  });

  it('ne livre en mode chasse que l’indice de l’étape suivante, ni titre ni coordonnées', async () => {
    const data = await (await requete('/fay')).json();
    const chasse = data.chasses.find((c: any) => c.id === 'ch-fay');
    expect(chasse.etape_suivante).toEqual({ id: 'et-fay', ordre: 0, indice: 'Près de l’eau', type_contenu: 'texte' });
    // En balade, la carte a besoin des points : ils restent fournis.
    const balade = data.chasses.find((c: any) => c.id === 'ch-balade');
    expect(balade.etape_suivante).toMatchObject({ lat: 49.6, lng: 1.8 });
  });

  it('renvoie un QR de sa propre commune vers le parcours normal', async () => {
    const res = await post('/valider-qr', { qr_token: QR_TOURLY, lat: 49.1, lng: 1.1 });
    expect(res.status).toBe(400);
    expect(db.progressions_chasse).toHaveLength(0);
  });

  it('ne valide pas une étape de balade énigme sans la bonne réponse, ni à distance', async () => {
    const loin = await post('/fay/chasses-tresor/valider-position', { etape_id: ETAPE_BALADE, lat: 49.0, lng: 1.0, reponse: 'trois' });
    expect((await loin.json()).reussi).toBe(false);
    const faux = await post('/fay/chasses-tresor/valider-position', { etape_id: ETAPE_BALADE, lat: 49.6, lng: 1.8, reponse: 'deux' });
    expect(faux.status).toBe(400);
    expect(db.progressions_chasse).toHaveLength(0);
  });

  it('valide une énigme sur place, chez Fay', async () => {
    const res = await post('/fay/enigmes/en-fay/valider', { lat: 49.5, lng: 1.9 });
    expect((await res.json()).reussi).toBe(true);
    expect(db.enigme_reussites[0]).toMatchObject({ commune_id: 'c-fay', enigme_id: 'en-fay', user_id: 'joueur' });
    expect(db.users.find((u) => u.id === 'joueur')!.enigmes_trouvees).toBe(1);
  });

  it('ne permet pas de viser l’énigme d’une autre commune via le slug de Fay', async () => {
    const res = await post('/fay/enigmes/en-ferme/valider', { lat: 48, lng: 2 });
    expect(res.status).toBe(404);
    expect(db.enigme_reussites).toHaveLength(0);
  });

  it('montre le visiteur dans le classement de la chasse, sous son nom public', async () => {
    await post('/valider-qr', { qr_token: QR_FAY, ...SUR_PLACE_FAY });
    const res = await requete('/fay/chasses-tresor/ch-fay/classement', {}, 'habitant-fay', 'c-fay');
    // Un habitant de Fay n'a rien à faire sur /jeux-ailleurs/fay : sa propre commune est refusée.
    expect(res.status).toBe(404);
    const vu = await requete('/fay/chasses-tresor/ch-fay/classement');
    expect((await vu.json()).classement[0].prenom).toBe('Jean D. (vous)');
  });

  it('liste seulement les villages qui ont des jeux actifs, triés par distance', async () => {
    Object.assign(db.communes.find((c) => c.id === 'c-fay')!, { lat: 49.5, lng: 1.9 });
    db.communes.push({ id: 'c-vide', nom: 'Sansjeux', slug: 'sansjeux', statut_client: 'active', lat: 49.4, lng: 1.9 });
    const { communes } = await (await requete('/communes?lat=49.4&lng=1.9')).json();
    // Ni sa propre commune (Tourly), ni un village sans jeu, ni Fermeville (jeux coupés par la mairie).
    expect(communes.map((c: any) => c.slug)).toEqual(['fay']);
    expect(communes[0]).toEqual({
      nom: 'Fay-les-Étangs', slug: 'fay', departement: '60', nb_chasses: 2, nb_enigmes: 1, lat: 49.5, lng: 1.9, distance_km: 11.1,
    });
    // Sans position : pas de distance, toujours aucun secret de jeu.
    const sansPosition = (await (await requete('/communes')).json()).communes;
    expect(sansPosition[0].distance_km).toBeNull();
    expect(JSON.stringify(sansPosition)).not.toContain(QR_FAY);
  });

  it('écarte les communes de test, sauf celle de Léandre laissée visible temporairement', async () => {
    db.communes.push(
      { id: 'c-test', nom: 'Commune de test', slug: 'test', statut_client: 'active' },
      { id: 'c-essai', nom: 'Eaucourt-sur-Somme', slug: 'eaucourt-sur-somme', statut_client: 'active' },
    );
    db.chasses_tresor.push(
      { id: 'ch-test', commune_id: 'c-test', titre: 'x', actif: true, mode: 'chasse' },
      { id: 'ch-essai', commune_id: 'c-essai', titre: 'y', actif: true, mode: 'balade' },
    );
    const { communes } = await (await requete('/communes')).json();
    expect(communes.map((c: any) => c.slug).sort()).toEqual(['eaucourt-sur-somme', 'fay']);
  });
});
