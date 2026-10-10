// worker/test/decouverte.test.ts
// Couvre l'inscription CITOYENNE en self-service (worker/src/routes/decouverte.ts, voir
// frontend/rejoindre.html) : recherche publique dans les prospects, demande d'accès par email
// (aucun compte créé à ce stade), confirmation par le lien reçu puis création réelle du compte
// — toujours role='citoyen', avec le prénom/nom/mot de passe choisis par la personne. Un compte
// citoyen n'ayant aucun pouvoir, pas de "garde-fou anti-détournement" à tester ici (contrairement
// à une 1re version qui créait un compte admin) — seul le dédoublonnage par email compte. Fausse
// base Supabase pilotée par fetch(), même esprit que test/emails-recus.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import decouverte from '../src/routes/decouverte';
import { hasherToken } from '../src/auth';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let emailsEnvoyes: Array<{ to: string; subject: string; html: string }>;

function reinitialiser() {
  db = {
    prospects: [], communes: [], users: [], refresh_tokens: [], activations_libres: [],
    onglets_gratuits: [{ cle: 'actualites' }, { cle: 'agenda' }],
    onglets_config: [],
  };
  emailsEnvoyes = [];
}

// Le token n'apparaît qu'en clair dans le lien de l'email (jamais stocké en clair en base,
// voir token_hash) — on le récupère là où un vrai utilisateur le récupérerait.
function tokenDepuisEmail(html: string): string {
  const match = html.match(/[?&]token=([^"&\s]+)/);
  if (!match) throw new Error('Aucun token trouvé dans l\'email : ' + html);
  return match[1];
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre === 'not.is.null') return valeur !== null && valeur !== undefined;
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre.startsWith('ilike.') || filtre.startsWith('like.')) {
    const motif = filtre.slice(filtre.indexOf('.') + 1).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + motif + '$', 'i').test(String(valeur ?? ''));
  }
  return true;
}

function appliquerRequete(table: Ligne[], params: URLSearchParams): Ligne[] {
  let lignes = [...table];
  for (const [cle, valeur] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  return lignes;
}

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  if (url.hostname === 'api.resend.com') {
    const corps = JSON.parse(String(init.body));
    emailsEnvoyes.push({ to: corps.to, subject: corps.subject, html: corps.html });
    return Promise.resolve(new Response(JSON.stringify({ id: 'email-fake' }), { status: 200 }));
  }

  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';

  if (methode === 'GET') {
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    const headers: Record<string, string> = {};
    if (init?.headers?.Prefer === 'count=exact') headers['content-range'] = `0-0/${lignes.length}`;
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200, headers }));
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init.body));
    const inserees = (Array.isArray(corps) ? corps : [corps]).map((l: Ligne) => ({ id: crypto.randomUUID(), ...l }));
    (db[table] ??= []).push(...inserees);
    return Promise.resolve(new Response(JSON.stringify(inserees), { status: 201 }));
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init.body));
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    for (const l of lignes) Object.assign(l, corps);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  RESEND_API_KEY: 'fake-resend-key',
  JWT_SECRET: 'fake-jwt-secret-suffisamment-long',
};

function ajouterProspect(overrides: Partial<Ligne> = {}): Ligne {
  const p = { id: crypto.randomUUID(), nom: 'Testville', code_postal: '80000', departement: '80', commune_id: null, ...overrides };
  db.prospects.push(p);
  return p;
}

beforeEach(() => {
  reinitialiser();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------

describe('GET /communes/rechercher', () => {
  it('ne recherche rien sous 2 caractères', async () => {
    const res = await decouverte.request('/communes/rechercher?q=t', {}, ENV);
    expect(await res.json()).toEqual({ resultats: [] });
  });

  it('trouve une commune par son nom, qu\'elle soit déjà active sur Agora ou non', async () => {
    db.communes.push({ id: 'commune-1', nom: 'Testville', slug: 'testville' });
    db.users.push({ id: 'u1', commune_id: 'commune-1', role: 'admin', compte_provisionne: false });
    ajouterProspect({ nom: 'Testville', commune_id: 'commune-1' });
    const res = await decouverte.request('/communes/rechercher?q=testville', {}, ENV);
    const { resultats } = await res.json();
    expect(resultats).toHaveLength(1);
    expect(resultats[0].nom).toBe('Testville');
  });
});

describe('POST /communes/:id/demander-acces', () => {
  const corpsValide = { email: 'jean@testville.fr', consentement_rgpd: true };

  it('404 si le prospect n\'existe pas', async () => {
    const res = await decouverte.request('/communes/inconnu/demander-acces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsValide),
    }, ENV);
    expect(res.status).toBe(404);
  });

  it('crée la commune mais AUCUN compte, n\'ouvre AUCUNE session, et envoie juste un email de confirmation', async () => {
    const prospect = ajouterProspect({ nom: 'Testville' });
    const res = await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsValide),
    }, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();

    expect(db.communes).toHaveLength(1);
    expect(db.communes[0].forfait).toBe('Gratuit');
    expect(db.users).toHaveLength(0); // le compte n'existe pas encore à ce stade
    expect(db.activations_libres).toHaveLength(1);
    expect(db.activations_libres[0].email).toBe('jean@testville.fr');

    expect(emailsEnvoyes).toHaveLength(1);
    expect(emailsEnvoyes[0].to).toBe('jean@testville.fr');
    expect(emailsEnvoyes[0].html).toContain('Créer mon compte'); // lien, pas d'identifiants
  });

  it('fonctionne aussi pour une commune qui a déjà un vrai compte (mairie active) — un citoyen de plus n\'a rien d\'anormal', async () => {
    db.communes.push({ id: 'commune-1', nom: 'Testville', slug: 'testville' });
    db.users.push({ id: 'u1', commune_id: 'commune-1', role: 'maire', compte_provisionne: false, email: 'vrai-maire@testville.fr' });
    const prospect = ajouterProspect({ nom: 'Testville', commune_id: 'commune-1' });

    const res = await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsValide),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.activations_libres).toHaveLength(1);
    expect(emailsEnvoyes).toHaveLength(1);
  });

  it('piège à robots (honeypot) : faux succès, rien n\'est créé', async () => {
    const prospect = ajouterProspect({ nom: 'Testville' });
    const res = await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...corpsValide, site_web: 'http://spam.example' }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.communes).toHaveLength(0);
    expect(db.activations_libres).toHaveLength(0);
    expect(emailsEnvoyes).toHaveLength(0);
  });
});

describe('GET /communes/activation/:token', () => {
  it('renvoie le nom de la commune pour un jeton valide', async () => {
    const prospect = ajouterProspect({ nom: 'Testville' });
    await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jean@testville.fr', consentement_rgpd: true }),
    }, ENV);
    const token = tokenDepuisEmail(emailsEnvoyes[0].html);

    const res = await decouverte.request(`/communes/activation/${token}`, {}, ENV);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.nom_commune).toBe('Testville');
  });

  it('410 pour un jeton inconnu', async () => {
    const res = await decouverte.request('/communes/activation/jeton-bidon', {}, ENV);
    expect(res.status).toBe(410);
  });

  it('410 pour un jeton expiré', async () => {
    db.activations_libres.push({
      id: 'a1', commune_id: 'c1', email: 'x@x.fr', token_hash: await hasherToken('mon-token'),
      expires_at: new Date(Date.now() - 1000).toISOString(), utilise_le: null,
    });
    const res = await decouverte.request('/communes/activation/mon-token', {}, ENV);
    expect(res.status).toBe(410);
  });
});

describe('POST /communes/activation/:token/creer-compte', () => {
  async function demanderEtRecupererToken(nomCommune = 'Testville', email = 'jean@testville.fr') {
    const prospect = ajouterProspect({ nom: nomCommune });
    await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, consentement_rgpd: true }),
    }, ENV);
    return tokenDepuisEmail(emailsEnvoyes[emailsEnvoyes.length - 1].html);
  }

  const corpsCreation = { prenom: 'Jean', nom: 'Dupont', mot_de_passe: 'motdepasse123', consentement_rgpd: true, age_minimum: true };

  it('crée le vrai compte CITOYEN (prénom/nom/mot de passe choisis), connecte automatiquement, et le jeton devient inutilisable', async () => {
    const token = await demanderEtRecupererToken();
    const res = await decouverte.request(`/communes/activation/${token}/creer-compte`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsCreation),
    }, ENV);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.slug).toBeTruthy();
    expect(res.headers.get('set-cookie')).toContain('agora_access');

    expect(db.users).toHaveLength(1);
    expect(db.users[0].role).toBe('citoyen');
    expect(db.users[0].prenom).toBe('Jean');
    expect(db.users[0].nom).toBe('Dupont');
    expect(db.users[0].email).toBe('jean@testville.fr');
    expect(db.activations_libres[0].utilise_le).toBeTruthy();

    // Rejouer le même jeton doit maintenant échouer.
    const res2 = await decouverte.request(`/communes/activation/${token}/creer-compte`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsCreation),
    }, ENV);
    expect(res2.status).toBe(410);
  });

  it('fonctionne aussi quand la commune a déjà un vrai compte admin (mairie active)', async () => {
    db.communes.push({ id: 'commune-1', nom: 'Testville', slug: 'testville' });
    db.users.push({ id: 'u1', commune_id: 'commune-1', role: 'maire', compte_provisionne: false, email: 'vrai-maire@testville.fr' });
    const token = await demanderEtRecupererToken();
    db.activations_libres[db.activations_libres.length - 1].commune_id = 'commune-1';

    const res = await decouverte.request(`/communes/activation/${token}/creer-compte`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsCreation),
    }, ENV);
    expect(res.status).toBe(201);
    expect(db.users).toHaveLength(2); // le maire existant + le nouveau citoyen
    expect(db.users.find((u: any) => u.id !== 'u1').role).toBe('citoyen');
  });

  it('refuse (400) si un compte existe déjà avec cet email sur cette commune', async () => {
    const token = await demanderEtRecupererToken();
    const communeId = db.activations_libres[0].commune_id;
    db.users.push({ id: 'existant', commune_id: communeId, role: 'citoyen', email: 'jean@testville.fr' });

    const res = await decouverte.request(`/communes/activation/${token}/creer-compte`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsCreation),
    }, ENV);
    expect(res.status).toBe(400);
    expect(db.users).toHaveLength(1); // rien ajouté
  });

  it('410 pour un jeton inconnu ou déjà utilisé', async () => {
    const res = await decouverte.request('/communes/activation/jeton-bidon/creer-compte', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsCreation),
    }, ENV);
    expect(res.status).toBe(410);
  });

  it('piège à robots (honeypot) : faux succès, rien n\'est créé', async () => {
    const token = await demanderEtRecupererToken();
    const res = await decouverte.request(`/communes/activation/${token}/creer-compte`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...corpsCreation, site_web: 'http://spam.example' }),
    }, ENV);
    expect(res.status).toBe(201);
    expect(db.users).toHaveLength(0);
  });
});

describe('POST /communes/demande-manquante', () => {
  it('envoie un email à contact@plateforme-agora.fr avec le nom de la commune', async () => {
    const res = await decouverte.request('/communes/demande-manquante', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom_commune: 'Petiteville', email_demandeur: 'moi@petiteville.fr' }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(emailsEnvoyes).toHaveLength(1);
    expect(emailsEnvoyes[0].to).toBe('contact@plateforme-agora.fr');
    expect(emailsEnvoyes[0].subject).toContain('Petiteville');
    expect(emailsEnvoyes[0].html).toContain('moi@petiteville.fr');
  });

  it('échappe le nom de la commune contre l\'injection HTML', async () => {
    await decouverte.request('/communes/demande-manquante', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom_commune: '<script>x</script>' }),
    }, ENV);
    expect(emailsEnvoyes[0].html).not.toContain('<script>x</script>');
    expect(emailsEnvoyes[0].html).toContain('&lt;script&gt;');
  });

  it('piège à robots : rien envoyé', async () => {
    await decouverte.request('/communes/demande-manquante', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nom_commune: 'Testville', site_web: 'http://spam.example' }),
    }, ENV);
    expect(emailsEnvoyes).toHaveLength(0);
  });
});
