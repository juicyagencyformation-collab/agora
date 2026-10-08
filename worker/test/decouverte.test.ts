// worker/test/decouverte.test.ts
// Couvre l'inscription en self-service (worker/src/routes/decouverte.ts, voir
// frontend/rejoindre.html) : recherche publique dans les prospects, création de compte avec
// connexion automatique, et surtout le garde-fou de sécurité — une commune déjà réclamée par un
// vrai utilisateur ne doit JAMAIS pouvoir être reprise par un visiteur anonyme. Fausse base
// Supabase pilotée par fetch(), même esprit que test/emails-recus.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import decouverte from '../src/routes/decouverte';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
let emailsEnvoyes: Array<{ to: string; subject: string; html: string }>;

function reinitialiser() {
  db = {
    prospects: [], communes: [], users: [], refresh_tokens: [], login_tokens: [],
    onglets_gratuits: [{ cle: 'actualites' }, { cle: 'agenda' }],
    onglets_config: [],
  };
  emailsEnvoyes = [];
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

  it('trouve une commune jamais activée : peut_demander_acces = true', async () => {
    ajouterProspect({ nom: 'Testville' });
    const res = await decouverte.request('/communes/rechercher?q=testville', {}, ENV);
    const { resultats } = await res.json();
    expect(resultats).toHaveLength(1);
    expect(resultats[0].peut_demander_acces).toBe(true);
  });

  it('trouve une commune activée mais jamais réclamée : peut_demander_acces = true', async () => {
    db.communes.push({ id: 'commune-1', nom: 'Testville', slug: 'testville' });
    db.users.push({ id: 'u1', commune_id: 'commune-1', role: 'admin', compte_provisionne: true });
    ajouterProspect({ nom: 'Testville', commune_id: 'commune-1' });
    const res = await decouverte.request('/communes/rechercher?q=testville', {}, ENV);
    const { resultats } = await res.json();
    expect(resultats[0].peut_demander_acces).toBe(true);
  });

  it('trouve une commune déjà réclamée par un vrai compte : peut_demander_acces = false', async () => {
    db.communes.push({ id: 'commune-1', nom: 'Testville', slug: 'testville' });
    db.users.push({ id: 'u1', commune_id: 'commune-1', role: 'admin', compte_provisionne: false });
    ajouterProspect({ nom: 'Testville', commune_id: 'commune-1' });
    const res = await decouverte.request('/communes/rechercher?q=testville', {}, ENV);
    const { resultats } = await res.json();
    expect(resultats[0].peut_demander_acces).toBe(false);
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

  it('crée la commune + le compte, n\'ouvre AUCUNE session (pas de cookie) et envoie un email avec un lien de connexion', async () => {
    const prospect = ajouterProspect({ nom: 'Testville' });
    const res = await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsValide),
    }, ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toBeNull();

    expect(db.communes).toHaveLength(1);
    expect(db.communes[0].forfait).toBe('Gratuit');
    expect(db.users).toHaveLength(1);
    expect(db.users[0].email).toBe('jean@testville.fr');
    // compte_provisionne doit basculer à false DÈS cette demande (pas seulement à la connexion),
    // sinon rien n'empêche un second visiteur de refaire la même demande et d'écraser le premier.
    expect(db.users[0].compte_provisionne).toBe(false);
    expect(db.login_tokens).toHaveLength(1); // lien de connexion directe généré

    expect(emailsEnvoyes).toHaveLength(1);
    expect(emailsEnvoyes[0].to).toBe('jean@testville.fr');
    expect(emailsEnvoyes[0].html).toContain('Installez l\'application');
  });

  it('réutilise le compte générique provisionné plutôt que d\'en créer un second', async () => {
    db.communes.push({ id: 'commune-1', nom: 'Testville', slug: 'testville' });
    db.users.push({ id: 'u1', commune_id: 'commune-1', role: 'admin', compte_provisionne: true, email: 'generique@testville.fr' });
    const prospect = ajouterProspect({ nom: 'Testville', commune_id: 'commune-1' });

    const res = await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsValide),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.users).toHaveLength(1); // toujours un seul compte, pas de doublon
    expect(db.users[0].email).toBe('jean@testville.fr');
    expect(db.users[0].compte_provisionne).toBe(false);
  });

  it('refuse (409) si la commune est déjà réclamée par un vrai compte — garde-fou anti-détournement', async () => {
    db.communes.push({ id: 'commune-1', nom: 'Testville', slug: 'testville' });
    db.users.push({ id: 'u1', commune_id: 'commune-1', role: 'maire', compte_provisionne: false, email: 'vrai-maire@testville.fr' });
    const prospect = ajouterProspect({ nom: 'Testville', commune_id: 'commune-1' });

    const res = await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsValide),
    }, ENV);
    expect(res.status).toBe(409);
    expect(db.users).toHaveLength(1); // aucun compte supplémentaire créé
    expect(emailsEnvoyes).toHaveLength(0);
  });

  it('une 2e demande sur la même commune échoue aussi (déjà réclamée par la 1re demande)', async () => {
    const prospect = ajouterProspect({ nom: 'Testville' });
    await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpsValide),
    }, ENV);

    const res2 = await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'intrus@autre-domaine.fr', consentement_rgpd: true }),
    }, ENV);
    expect(res2.status).toBe(409);
    expect(db.users[0].email).toBe('jean@testville.fr'); // jamais écrasé par l'intrus
  });

  it('piège à robots (honeypot) : faux succès, rien n\'est créé', async () => {
    const prospect = ajouterProspect({ nom: 'Testville' });
    const res = await decouverte.request(`/communes/${prospect.id}/demander-acces`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...corpsValide, site_web: 'http://spam.example' }),
    }, ENV);
    expect(res.status).toBe(200);
    expect(db.communes).toHaveLength(0);
    expect(db.users).toHaveLength(0);
    expect(emailsEnvoyes).toHaveLength(0);
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
