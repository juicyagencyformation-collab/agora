// worker/test/onboarding-drip.test.ts
// Couvre tous les angles de la séquence d'onboarding/upsell (voir le commentaire d'en-tête de
// src/backoffice/onboarding-drip.ts pour la logique métier telle que fournie par Léandre) :
//   - fenêtres de date J+3 / J+7 (email_2/3/4), et la règle "jamais par date" de l'email_5
//   - sélection du destinataire (maire connecté > gestionnaire le plus actif > citoyen en dernier
//     recours pour 2/3/4 uniquement, jamais pour l'email_5)
//   - garde-fou anti-doublon (sequence_emails_sent)
//   - cas limites : aucun contact joignable, commune repassée payante en cours de séquence,
//     échec d'envoi Resend
// Aucun appel réseau réel : fetch() est remplacé par une fausse base Supabase en mémoire + un
// faux Resend, dans le même esprit que les autres tests (aucun test existant n'exerçait encore
// les fonctions branchées sur Supabase avant celui-ci).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verifierSequenceOnboarding, destinataireCommune, communesSansContactJoignable } from '../src/backoffice/onboarding-drip';

// --- Fausse base Supabase, pilotée par fetch() ------------------------------------------------
type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;

function reinitialiserDb() {
  db = { communes: [], users: [], activation_events: [], sequence_emails_sent: [], modeles_email: [] };
}

function correspond(valeur: any, filtre: string): boolean {
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre === 'not.is.null') return valeur !== null && valeur !== undefined;
  if (filtre === 'not.is.true') return valeur !== true;
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('gte.')) return valeur != null && String(valeur) >= filtre.slice(4);
  if (filtre.startsWith('lte.')) return valeur != null && String(valeur) <= filtre.slice(4);
  if (filtre.startsWith('in.(') && filtre.endsWith(')')) {
    const ids = filtre.slice(4, -1).split(',');
    return ids.includes(String(valeur));
  }
  return true;
}

function appliquerRequete(table: Ligne[], params: URLSearchParams): Ligne[] {
  let lignes = [...table];
  for (const [cle, valeur] of params.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(cle)) continue;
    lignes = lignes.filter((l) => correspond(l[cle], valeur));
  }
  const order = params.get('order');
  if (order) {
    const [champ, sens] = order.split('.');
    lignes.sort((a, b) => {
      const va = a[champ], vb = b[champ];
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const cmp = va < vb ? -1 : 1;
      return sens === 'desc' ? -cmp : cmp;
    });
  }
  const offset = parseInt(params.get('offset') || '0', 10);
  const limit = params.get('limit');
  if (limit) lignes = lignes.slice(offset, offset + parseInt(limit, 10));
  else if (offset) lignes = lignes.slice(offset);
  return lignes;
}

function fetchFake(input: any, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const methode = init?.method || 'GET';

  if (url.hostname === 'api.resend.com') {
    return Promise.resolve(new Response(JSON.stringify({ id: 'resend-test-id' }), { status: 200 }));
  }

  const table = url.pathname.replace('/rest/v1/', '');
  if (methode === 'GET') {
    const lignes = appliquerRequete(db[table] || [], url.searchParams);
    return Promise.resolve(new Response(JSON.stringify(lignes), { status: 200 }));
  }
  if (methode === 'POST') {
    const corps = JSON.parse(String(init!.body));
    if (table === 'sequence_emails_sent') {
      const doublon = (db.sequence_emails_sent || []).some(
        (l) => l.commune_id === corps.commune_id && l.email_type === corps.email_type,
      );
      if (doublon) {
        return Promise.resolve(new Response(
          JSON.stringify({ message: 'duplicate key value violates unique constraint "sequence_emails_sent_commune_id_email_type_key"' }),
          { status: 409 },
        ));
      }
    }
    const ligne = { id: crypto.randomUUID(), ...corps };
    (db[table] ??= []).push(ligne);
    return Promise.resolve(new Response(JSON.stringify([ligne]), { status: 201 }));
  }
  return Promise.reject(new Error('méthode non gérée dans le mock : ' + methode));
}

const ENV: any = {
  SUPABASE_URL: 'https://fake.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-key',
  RESEND_API_KEY: 'fake-resend-key',
  EMAIL_FROM: 'Agora <test@plateforme-agora.fr>',
  FRONTEND_URL: 'https://plateforme-agora.fr',
};

// --- Fabriques de données de test --------------------------------------------------------------
// Milieu de journée UTC : à coup sûr dans la fenêtre "créée il y a exactement N jours" quelle que
// soit l'heure à laquelle les tests tournent (fenêtre = minuit à minuit, voir fenetreJour).
function ilYAJours(jours: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - jours);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

function ajouterCommune(overrides: Partial<Ligne> = {}): Ligne {
  const c = {
    id: crypto.randomUUID(), nom: 'Testville', slug: 'testville', forfait: 'Gratuit',
    statut_client: 'active', niveau_national: false, created_at: ilYAJours(3),
    ...overrides,
  };
  db.communes.push(c);
  return c;
}

function ajouterUtilisateur(communeId: string, overrides: Partial<Ligne> = {}): Ligne {
  const u = {
    id: crypto.randomUUID(), commune_id: communeId, role: 'citoyen',
    email: 'defaut@example.fr', derniere_connexion_streak: null,
    ...overrides,
  };
  db.users.push(u);
  return u;
}

function ajouterEvenement(communeId: string, type: string) {
  db.activation_events.push({ id: crypto.randomUUID(), commune_id: communeId, event_type: type });
}

function emailsEnvoyes(): Ligne[] {
  return db.sequence_emails_sent;
}

beforeEach(() => {
  reinitialiserDb();
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------

describe('email_2 — J+3 sans événement d\'activation', () => {
  it('envoie à une commune gratuite créée il y a exactement 3 jours, sans événement', async () => {
    const c = ajouterCommune({ created_at: ilYAJours(3) });
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: '2026-08-15' });

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_2.candidates).toBe(1);
    expect(rapport.email_2.eligibles).toBe(1);
    expect(rapport.email_2.lignes[0].resultat).toBe('envoyé à maire@testville.fr');
    expect(emailsEnvoyes()).toEqual([{ id: expect.any(String), commune_id: c.id, email_type: 'email_2' }]);
  });

  it('n\'envoie pas si la commune a déjà au moins un événement (bascule vers email_3/4)', async () => {
    const c = ajouterCommune({ created_at: ilYAJours(3) });
    ajouterUtilisateur(c.id, { role: 'maire', derniere_connexion_streak: '2026-08-15' });
    ajouterEvenement(c.id, 'article_publie');

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_2.candidates).toBe(1);
    expect(rapport.email_2.eligibles).toBe(0);
    expect(rapport.email_2.lignes[0].resultat).toContain('a déjà au moins un événement');
    expect(emailsEnvoyes()).toEqual([]);
  });

  it('ignore une commune créée il y a 2 ou 4 jours (hors fenêtre J+3)', async () => {
    ajouterCommune({ created_at: ilYAJours(2) });
    ajouterCommune({ created_at: ilYAJours(4) });

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_2.candidates).toBe(0);
  });

  it('ignore une commune déjà payante, même créée il y a 3 jours', async () => {
    ajouterCommune({ created_at: ilYAJours(3), forfait: 'Version complète' });

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_2.candidates).toBe(0);
  });

  it('ignore une commune suspendue ou résiliée', async () => {
    ajouterCommune({ created_at: ilYAJours(3), statut_client: 'suspendue' });
    ajouterCommune({ created_at: ilYAJours(3), statut_client: 'resiliee' });

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_2.candidates).toBe(0);
  });
});

describe('email_3 — J+7 sans événement, email_4 — J+7 avec événement', () => {
  it('email_3 pour une commune créée il y a 7 jours sans aucun événement', async () => {
    const c = ajouterCommune({ created_at: ilYAJours(7) });
    ajouterUtilisateur(c.id, { role: 'maire', derniere_connexion_streak: '2026-08-15' });

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_3.eligibles).toBe(1);
    expect(rapport.email_4.eligibles).toBe(0);
  });

  it('email_4 (pas email_3) pour une commune créée il y a 7 jours avec au moins un événement', async () => {
    const c = ajouterCommune({ created_at: ilYAJours(7) });
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: '2026-08-15' });
    ajouterEvenement(c.id, 'calendrier_dechets_rempli');

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_3.eligibles).toBe(0);
    expect(rapport.email_3.lignes[0].resultat).toContain('candidat pour email_4 à la place');
    expect(rapport.email_4.eligibles).toBe(1);
    expect(rapport.email_4.lignes[0].resultat).toBe('envoyé à maire@testville.fr');
  });
});

describe('email_5 — signal fort (règle dure : jamais par date, seulement 3 types d\'événements distincts)', () => {
  const TYPES = ['article_publie', 'calendrier_dechets_rempli', 'module_verrouille_clique'];

  it('envoie dès que 3 types distincts sont atteints, quelle que soit l\'ancienneté de la commune', async () => {
    const c = ajouterCommune({ created_at: ilYAJours(200) }); // très ancienne, aucun rapport avec J+3/J+7
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: '2026-08-15' });
    for (const t of TYPES) ajouterEvenement(c.id, t);

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_5.eligibles).toBe(1);
    expect(rapport.email_5.lignes[0].resultat).toBe('envoyé à maire@testville.fr');
  });

  it('n\'envoie pas avec seulement 2 types distincts, même avec beaucoup d\'événements', async () => {
    const c = ajouterCommune();
    ajouterUtilisateur(c.id, { role: 'maire', derniere_connexion_streak: '2026-08-15' });
    ajouterEvenement(c.id, 'article_publie');
    ajouterEvenement(c.id, 'article_publie');
    ajouterEvenement(c.id, 'calendrier_dechets_rempli');

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_5.candidates).toBe(0);
  });

  it('écarte une commune repassée payante en cours de séquence, même avec 3 types atteints', async () => {
    const c = ajouterCommune({ forfait: 'Version complète' });
    ajouterUtilisateur(c.id, { role: 'maire', derniere_connexion_streak: '2026-08-15' });
    for (const t of TYPES) ajouterEvenement(c.id, t);

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_5.candidates).toBe(1);
    expect(rapport.email_5.eligibles).toBe(0);
    expect(rapport.email_5.lignes[0].resultat).toContain('Version complète');
    expect(emailsEnvoyes()).toEqual([]);
  });

  it('écarte une commune suspendue/résiliée, même avec 3 types atteints', async () => {
    const c = ajouterCommune({ statut_client: 'suspendue' });
    ajouterUtilisateur(c.id, { role: 'maire', derniere_connexion_streak: '2026-08-15' });
    for (const t of TYPES) ajouterEvenement(c.id, t);

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_5.eligibles).toBe(0);
    expect(rapport.email_5.lignes[0].resultat).toContain('suspendue');
  });

  it('n\'envoie jamais deux fois (anti-doublon), même si de nouveaux événements arrivent ensuite', async () => {
    const c = ajouterCommune();
    ajouterUtilisateur(c.id, { role: 'maire', derniere_connexion_streak: '2026-08-15' });
    for (const t of TYPES) ajouterEvenement(c.id, t);
    db.sequence_emails_sent.push({ id: crypto.randomUUID(), commune_id: c.id, email_type: 'email_5' });

    ajouterEvenement(c.id, 'article_publie'); // un événement de plus, ne doit rien changer
    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_5.eligibles).toBe(0);
    expect(rapport.email_5.lignes[0].resultat).toBe('écarté — déjà envoyé précédemment');
    expect(emailsEnvoyes()).toHaveLength(1); // toujours la seule ligne pré-existante, aucun doublon inséré
  });

  it('ne plante pas si la commune source des événements a été supprimée entre-temps', async () => {
    // Événements orphelins : la commune n'existe plus dans `communes`.
    for (const t of TYPES) ajouterEvenement('commune-fantome', t);

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_5.candidates).toBe(1);
    expect(rapport.email_5.eligibles).toBe(0);
    expect(rapport.email_5.lignes[0].resultat).toContain('introuvable');
  });
});

describe('destinataireCommune — sélection du destinataire', () => {
  it('choisit le maire s\'il s\'est déjà connecté', async () => {
    const c = ajouterCommune();
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: '2026-08-10' });
    ajouterUtilisateur(c.id, { role: 'elu', email: 'elu@testville.fr', derniere_connexion_streak: '2026-08-18' });

    expect(await destinataireCommune(ENV, c.id, true)).toBe('maire@testville.fr');
  });

  it('bascule sur le gestionnaire le plus actif si le maire ne s\'est jamais connecté', async () => {
    const c = ajouterCommune();
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: null });
    ajouterUtilisateur(c.id, { role: 'admin', email: 'admin@testville.fr', derniere_connexion_streak: '2026-08-10' });
    ajouterUtilisateur(c.id, { role: 'elu', email: 'elu@testville.fr', derniere_connexion_streak: '2026-08-18' });

    expect(await destinataireCommune(ENV, c.id, true)).toBe('elu@testville.fr'); // le plus récent
  });

  it('inclureCitoyen=true (emails 2/3/4) : peut retomber sur un citoyen si c\'est lui le plus actif', async () => {
    const c = ajouterCommune();
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: null });
    ajouterUtilisateur(c.id, { role: 'admin', email: 'admin@testville.fr', derniere_connexion_streak: '2026-08-10' });
    ajouterUtilisateur(c.id, { role: 'citoyen', email: 'citoyen@testville.fr', derniere_connexion_streak: '2026-08-19' });

    expect(await destinataireCommune(ENV, c.id, true)).toBe('citoyen@testville.fr');
  });

  it('inclureCitoyen=false (email_5) : ignore un citoyen même plus actif que le gestionnaire', async () => {
    const c = ajouterCommune();
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: null });
    ajouterUtilisateur(c.id, { role: 'admin', email: 'admin@testville.fr', derniere_connexion_streak: '2026-08-10' });
    ajouterUtilisateur(c.id, { role: 'citoyen', email: 'citoyen@testville.fr', derniere_connexion_streak: '2026-08-19' });

    expect(await destinataireCommune(ENV, c.id, false)).toBe('admin@testville.fr');
  });

  it('dernier recours dans tous les cas : l\'email du maire même jamais connecté, plutôt que rien', async () => {
    const c = ajouterCommune();
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: null });
    // Aucun autre compte, personne ne s'est jamais connecté.

    expect(await destinataireCommune(ENV, c.id, true)).toBe('maire@testville.fr');
    expect(await destinataireCommune(ENV, c.id, false)).toBe('maire@testville.fr');
  });

  it('renvoie null si aucun compte n\'existe du tout pour cette commune', async () => {
    const c = ajouterCommune();
    expect(await destinataireCommune(ENV, c.id, true)).toBeNull();
  });
});

describe('anti-doublon — email_2/3/4', () => {
  it('n\'envoie pas une deuxième fois email_2 à une commune qui l\'a déjà reçu', async () => {
    const c = ajouterCommune({ created_at: ilYAJours(3) });
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: '2026-08-15' });
    db.sequence_emails_sent.push({ id: crypto.randomUUID(), commune_id: c.id, email_type: 'email_2' });

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_2.eligibles).toBe(0);
    expect(rapport.email_2.lignes[0].resultat).toBe('écarté — déjà envoyé précédemment');
    expect(emailsEnvoyes()).toHaveLength(1); // toujours la seule ligne pré-existante
  });

  it('avoir déjà reçu email_2 ne bloque pas email_3/4 pour une AUTRE commune au bon stade', async () => {
    const dejaTraitee = ajouterCommune({ created_at: ilYAJours(3) });
    db.sequence_emails_sent.push({ id: crypto.randomUUID(), commune_id: dejaTraitee.id, email_type: 'email_2' });

    const nouvelle = ajouterCommune({ created_at: ilYAJours(7) });
    ajouterUtilisateur(nouvelle.id, { role: 'maire', email: 'maire2@testville.fr', derniere_connexion_streak: '2026-08-15' });

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_3.eligibles).toBe(1);
    expect(rapport.email_3.lignes[0].commune_id).toBe(nouvelle.id);
  });
});

describe('cas limite : aucun contact joignable', () => {
  it('email_2 est "ignoré" (pas une erreur) et ne pose pas de garde anti-doublon, pour pouvoir réessayer plus tard', async () => {
    ajouterCommune({ created_at: ilYAJours(3) }); // aucun utilisateur du tout

    const rapport = await verifierSequenceOnboarding(ENV);

    expect(rapport.email_2.eligibles).toBe(0);
    expect(rapport.email_2.lignes[0].resultat).toContain('ignoré — aucun compte');
    expect(emailsEnvoyes()).toEqual([]); // pas de ligne posée : une commune sans contact reste réessayable
  });
});

describe('communesSansContactJoignable', () => {
  it('remonte une commune avec au moins un événement mais aucun compte du tout', async () => {
    const c = ajouterCommune();
    ajouterEvenement(c.id, 'article_publie');

    const resultat = await communesSansContactJoignable(ENV);

    expect(resultat).toEqual([{ id: c.id, nom: c.nom }]);
  });

  it('ne remonte pas une commune qui a au moins un compte maire (dernier recours toujours possible)', async () => {
    const c = ajouterCommune();
    ajouterEvenement(c.id, 'article_publie');
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: null });

    expect(await communesSansContactJoignable(ENV)).toEqual([]);
  });

  it('ne remonte pas une commune déjà payante (repassée cliente pendant la séquence)', async () => {
    const c = ajouterCommune({ forfait: 'Version complète' });
    ajouterEvenement(c.id, 'article_publie');
    // Aucun utilisateur : serait remontée si elle était encore Gratuit/active.

    expect(await communesSansContactJoignable(ENV)).toEqual([]);
  });

  it('renvoie une liste vide si aucune commune n\'a d\'événement', async () => {
    ajouterCommune();
    expect(await communesSansContactJoignable(ENV)).toEqual([]);
  });
});

describe('échec d\'envoi Resend', () => {
  it('ne pose pas la garde anti-doublon si Resend échoue (réessayable au prochain passage)', async () => {
    const c = ajouterCommune({ created_at: ilYAJours(3) });
    ajouterUtilisateur(c.id, { role: 'maire', email: 'maire@testville.fr', derniere_connexion_streak: '2026-08-15' });

    const envSansCle = { ...ENV, RESEND_API_KEY: '' }; // simule une clé Resend absente/mal configurée
    const rapport = await verifierSequenceOnboarding(envSansCle);

    expect(rapport.email_2.eligibles).toBe(0);
    expect(rapport.email_2.lignes[0].resultat).toContain('échec d\'envoi Resend');
    expect(emailsEnvoyes()).toEqual([]);
  });
});
