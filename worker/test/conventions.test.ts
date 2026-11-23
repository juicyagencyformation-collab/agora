// worker/test/conventions.test.ts
// Convention « Commune fondatrice » : création (numéro libre, maire prérempli), formulaire public
// de la mairie par jeton (lien invalide ou convention signée refusés, validation), document généré
// (valeurs insérées, échappées, variante de reconduction, blancs signalés).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sign } from '@tsndr/cloudflare-worker-jwt';
import { routesStaff, routesFormulaire } from '../src/backoffice/conventions';
import { genererConventionHtml, LIBELLES_ONGLETS } from '../src/backoffice/convention-document';
import { fermerOngletsOfferts } from '../src/cron';
import { anomalieFinOffre } from '../src/backoffice/suivi-communes';
import { TOUS_LES_ONGLETS } from '../src/backoffice/administration';

type Ligne = Record<string, any>;
let db: Record<string, Ligne[]>;
const JWT_SECRET = 'secret-de-test-suffisamment-long';
const ENV: any = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', JWT_SECRET };

function correspond(valeur: any, filtre: string): boolean {
  if (filtre.startsWith('eq.')) return String(valeur) === filtre.slice(3);
  if (filtre.startsWith('neq.')) return String(valeur) !== filtre.slice(4);
  if (filtre === 'not.is.null') return valeur !== null && valeur !== undefined;
  if (filtre === 'is.null') return valeur === null || valeur === undefined;
  if (filtre.startsWith('like.')) return String(valeur).startsWith(filtre.slice(5).replace('*', ''));
  if (filtre.startsWith('in.(')) return filtre.slice(4, -1).split(',').includes(String(valeur));
  if (filtre.startsWith('lt.')) return valeur !== null && valeur !== undefined && String(valeur) < filtre.slice(3);
  return true;
}
const filtrer = (t: Ligne[], p: URLSearchParams) =>
  t.filter((l) => [...p.entries()].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || correspond(l[k], v)));

function fetchFake(input: any, init?: any): Promise<Response> {
  const url = new URL(String(input));
  const table = url.pathname.replace('/rest/v1/', '');
  const methode = init?.method || 'GET';
  const ok = (d: any, s = 200) => Promise.resolve(new Response(JSON.stringify(d), { status: s }));
  if (methode === 'GET') return ok(filtrer(db[table] || [], url.searchParams));
  if (methode === 'POST' && url.searchParams.has('on_conflict')) {
    // Upsert (appliquerOngletsSurCommune) : fusion sur les colonnes de conflit.
    const cles = url.searchParams.get('on_conflict')!.split(',');
    const lignes = JSON.parse(String(init.body)) as Ligne[];
    for (const l of lignes) {
      const existante = (db[table] ??= []).find((x) => cles.every((k) => x[k] === l[k]));
      if (existante) Object.assign(existante, l); else db[table].push({ ...l });
    }
    return ok(lignes, 201);
  }
  if (methode === 'POST') {
    const l = { id: crypto.randomUUID(), statut: 'brouillon', ...JSON.parse(String(init.body)) };
    (db[table] ??= []).push(l);
    return ok([l], 201);
  }
  if (methode === 'PATCH') {
    const corps = JSON.parse(String(init.body));
    if (table === 'conventions' && corps.numero_fondatrice
      && db.conventions.some((x) => x.numero_fondatrice === corps.numero_fondatrice && !filtrer([x], url.searchParams).length)) {
      return ok({ code: '23505', message: 'duplicate key value violates unique constraint "idx_conventions_numero_fondatrice"' }, 409);
    }
    const lignes = filtrer(db[table] || [], url.searchParams);
    lignes.forEach((l) => Object.assign(l, corps));
    return ok(lignes);
  }
  return Promise.reject(new Error('méthode non gérée : ' + methode));
}

const sessionStaff = async () => ({ Cookie: `agora_bo=${await sign({ staff_id: 's1', scope: 'backoffice', exp: Math.floor(Date.now() / 1000) + 900 }, JWT_SECRET)}` });
const JETON = 'a'.repeat(64);

beforeEach(() => {
  db = {
    communes: [{ id: 'fay', nom: 'Fay-les-Étangs', slug: 'faylesetangs', departement: '60' }, { id: 'tourly', nom: 'Tourly', slug: 'tourly', departement: '60' }],
    users: [{ commune_id: 'fay', role: 'maire', prenom: 'Marie', nom: 'Dupont' }],
    prospects: [{ commune_id: 'tourly', nom_maire: 'Jean Martin' }],
    conventions: [], journal_activite: [], onglets_config: [],
    onglets_gratuits: ['actualites', 'alertes', 'agenda', 'chasse_tresor', 'enigmes'].map((cle) => ({ cle })),
    parametres_facturation: [
      { cle: 'entreprise_raison_sociale', valeur: 'SALLE LEANDRE' }, { cle: 'entreprise_siret', valeur: '88299247200010' },
      { cle: 'entreprise_mention_tva', valeur: 'TVA non applicable, art. 293 B du CGI' }, { cle: 'entreprise_email', valeur: 'contact@plateforme-agora.fr' },
    ],
  };
  vi.stubGlobal('fetch', fetchFake);
});
afterEach(() => vi.unstubAllGlobals());

describe('création par le staff', () => {
  it('refuse sans session staff', async () => {
    expect((await routesStaff.request('/commune/fay', { method: 'POST' }, ENV)).status).toBe(401);
  });
  it('prend le premier numéro libre, préremplit le maire et crée un lien secret', async () => {
    db.conventions.push({ id: 'x', commune_id: 'autre', numero_fondatrice: 1, statut: 'signee', jeton_formulaire: 'b'.repeat(64) });
    const res = await routesStaff.request('/commune/fay', { method: 'POST', headers: await sessionStaff() }, ENV);
    expect(res.status).toBe(201);
    const conv = db.conventions.find((x) => x.commune_id === 'fay')!;
    expect(conv).toMatchObject({ numero_fondatrice: 2, signataire_nom: 'Marie Dupont', signataire_qualite: 'maire' });
    expect(conv.jeton_formulaire).toMatch(/^[a-f0-9]{64}$/);
  });
  it('reprend le nom du maire de la fiche prospect à défaut de compte maire', async () => {
    await routesStaff.request('/commune/tourly', { method: 'POST', headers: await sessionStaff() }, ENV);
    expect(db.conventions[0].signataire_nom).toBe('Jean Martin');
  });
  it('refuse un numéro de commune fondatrice déjà attribué', async () => {
    db.conventions.push({ id: 'c1', commune_id: 'fay', numero_fondatrice: 1, statut: 'brouillon' }, { id: 'c2', commune_id: 'tourly', numero_fondatrice: 2, statut: 'brouillon' });
    const res = await routesStaff.request('/c2', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await sessionStaff()) }, body: JSON.stringify({ numero_fondatrice: 1 }) }, ENV);
    expect(res.status).toBe(400);
  });
});

describe('formulaire de la mairie (par lien)', () => {
  beforeEach(() => { db.conventions.push({ id: 'c1', commune_id: 'fay', statut: 'envoyee', numero_fondatrice: 2, jeton_formulaire: JETON }); });
  const envoyer = (corps: object, jeton = JETON) => routesFormulaire.request(`/${jeton}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  }, ENV);

  it('refuse un lien inconnu ou une convention déjà signée', async () => {
    expect((await routesFormulaire.request(`/${'f'.repeat(64)}`, {}, ENV)).status).toBe(404);
    expect((await routesFormulaire.request('/pas-un-jeton', {}, ENV)).status).toBe(404);
    db.conventions[0].statut = 'signee';
    expect((await routesFormulaire.request(`/${JETON}`, {}, ENV)).status).toBe(404);
  });
  it('enregistre les réponses (SIRET avec espaces accepté, champ vidé = effacé)', async () => {
    const res = await envoyer({ signataire_nom: 'Marie Dupont', siret_commune: '216 002 285 00011', option_reconduction: 'tacite', citation_autorisee: true, code_service_chorus: '' });
    expect(res.status).toBe(200);
    expect(db.conventions[0]).toMatchObject({ siret_commune: '21600228500011', option_reconduction: 'tacite', citation_autorisee: true, code_service_chorus: null });
    expect(db.conventions[0].formulaire_rempli_le).toBeTruthy();
  });
  it('refuse un SIRET incomplet, un email invalide ou un champ inattendu', async () => {
    expect((await envoyer({ siret_commune: '1234' })).status).toBe(400);
    expect((await envoyer({ facturation_email: 'pas-un-email' })).status).toBe(400);
    expect((await envoyer({ statut: 'signee' })).status).toBe(400);
    expect(db.conventions[0].statut).toBe('envoyee');
  });
});

describe('document', () => {
  const base = {
    numero_fondatrice: 2, signataire_nom: 'Marie Dupont', signataire_qualite: 'maire', deliberation_reference: '2026-45',
    deliberation_date: '2026-11-03', option_reconduction: null, siret_commune: '21600228500011', code_service_chorus: null,
    facturation_nom: 'Mairie', facturation_email: 'mairie@fay.fr', date_debut_souhaitee: null, citation_autorisee: null,
  } as any;
  const entreprise = { entreprise_siret: '88299247200010', entreprise_mention_tva: 'TVA non applicable, art. 293 B du CGI' };

  it('insère les valeurs, le département et le SIREN', () => {
    const html = genererConventionHtml({ ...base, option_reconduction: 'tacite' }, { nom: 'Fay-les-Étangs', slug: 'faylesetangs' }, '60', entreprise);
    expect(html).toContain('Commune de Fay-les-Étangs (Oise, 60)');
    expect(html).toContain('SIREN 882 992 472');
    expect(html).toContain('n° 2 / 10');
    expect(html).toContain('reconductible tacitement 3 fois');
    expect(html).toContain('plateforme-agora.fr/faylesetangs');
  });
  it('adapte le texte au renouvellement annuel et signale les blancs', () => {
    const html = genererConventionHtml({ ...base, option_reconduction: 'annuelle', deliberation_reference: null }, { nom: 'Tourly', slug: 'tourly' }, null, entreprise);
    expect(html).toContain('renouvelable chaque année par décision expresse');
    expect(html).not.toContain('reconductible tacitement 3 fois');
    expect(html).toContain('class="a-completer"');
  });
  it('liste les onglets cochés sur la fiche, ou « Tous » quand tout est coché', () => {
    const tous = genererConventionHtml(base, { nom: 'Fay', slug: 'fay' }, '60', entreprise, Object.keys(LIBELLES_ONGLETS));
    expect(tous).toContain('<td>Onglets</td><td>Tous, selon les besoins de la commune</td>');
    const partiel = genererConventionHtml(base, { nom: 'Fay', slug: 'fay' }, '60', entreprise, ['agenda', 'actualites', 'memoire']);
    expect(partiel).toContain('<td>Actualités, Agenda, Mémoire du village. Les autres onglets restent activables à tout moment');
    expect(genererConventionHtml(base, { nom: 'Fay', slug: 'fay' }, '60', entreprise, [])).toContain('aucun onglet coché');
  });
  it('ne parle de première année offerte que si l\'accord exceptionnel est coché', () => {
    const standard = genererConventionHtml({ ...base, option_reconduction: 'tacite' }, { nom: 'Fay', slug: 'fay' }, '60', entreprise);
    expect(standard).not.toMatch(/offert|Période fondatrice|1 €/);
    expect(standard).toContain('<strong>Tarif fondateur</strong> — dès la mise en service');
    expect(standard).toContain('<th>Abonnement fondateur</th>');
    expect(standard).toContain('une facture annuelle');
    expect(standard).toContain("l'année en cours reste due");
    expect(standard).toContain('modules ajoutés par la suite');
    const offerte = genererConventionHtml({ ...base, option_reconduction: 'tacite', premiere_annee_offerte: true }, { nom: 'Fay', slug: 'fay' }, '60', entreprise);
    expect(offerte).toContain('offert pendant 12 mois');
    expect(offerte).toContain('<strong>Période fondatrice (12 mois)</strong>');
    expect(offerte).toContain('sans aucune contrepartie financière');
    expect(offerte).toContain('aucune facture pendant la période fondatrice');
    expect(offerte).toContain('<td>Prix</td><td>Offert</td>');
    expect(offerte).toContain('Passé un délai de 3 mois sans abonnement, la Commune perd le statut de Commune fondatrice et le tarif fondateur.');
    expect(standard).toContain('Passé un délai de 3 mois sans abonnement, la Commune perd le statut de Commune fondatrice et le tarif fondateur.');
    expect(offerte).not.toMatch(/1 €|euro versé/);
    expect(offerte).not.toContain('<th>Abonnement fondateur</th>');
  });
  it('formule gratuite : version gratuite + onglets offerts reconduits tacitement, aucune facture', () => {
    const gratuits = ['actualites', 'alertes', 'agenda', 'chasse_tresor', 'enigmes'];
    const html = genererConventionHtml({ ...base, formule: 'gratuit', onglets_offerts: ['coups_de_main', 'mur'] },
      { nom: 'Tourly', slug: 'tourly' }, '60', entreprise, Object.keys(LIBELLES_ONGLETS), gratuits);
    expect(html).toContain('version gratuite, plus les onglets <strong>Mur des voisins et Coups de main</strong> offerts par périodes de 12 mois reconductibles');
    expect(html).toContain('<strong>La version gratuite</strong> de Plateforme-Agora, sans limite de durée : actualités, signalements, agenda, chasse au trésor, énigme photo');
    expect(html).toContain("l'accès aux onglets <strong>Mur des voisins et Coups de main</strong> pendant 12 mois");
    expect(html).toContain("l'offre est reconduite tacitement par périodes de 12 mois, 3 fois au plus, soit 4 ans au maximum");
    expect(html).toContain('La Commune comme le Prestataire peuvent refuser la reconduction par mail, au moins 2 mois avant');
    expect(html).toContain('ne donnent lieu à aucun paiement ni à aucune facture');
    expect(html).toContain('à tout moment, la Commune peut ouvrir tous les onglets');
    expect(html).toContain('Les autres onglets (thermomètre du village, conseil municipal, annuaire');
    expect(html).toContain('<td>12 mois, reconduits tacitement 3 fois (4 ans au maximum)</td>');
    expect(html).not.toContain('Tous les onglets et modules');
    expect(html).not.toContain('Période fondatrice');
    expect(html).not.toContain('Contact facturation');
    expect(html).not.toContain("l'année en cours reste due");
    // Un seul onglet : accords au singulier ; un onglet gratuit coché par erreur est ignoré.
    const un = genererConventionHtml({ ...base, formule: 'gratuit', onglets_offerts: ['mur', 'agenda'] }, { nom: 'Fay', slug: 'fay' }, '60', entreprise, undefined, gratuits);
    expect(un).toContain("plus l'onglet <strong>Mur des voisins</strong> offert par périodes de 12 mois reconductibles");
    expect(un).toContain("l'onglet offert se ferme et l'espace reste en version gratuite");
    // Sans onglet offert : la version gratuite seule.
    const seul = genererConventionHtml({ ...base, formule: 'gratuit', onglets_offerts: [] }, { nom: 'Fay', slug: 'fay' }, '60', entreprise, undefined, gratuits);
    expect(seul).toContain('fondatrice de Plateforme-Agora : version gratuite, et 35 % de réduction garantis si elle s');
    expect(seul).toContain('la version gratuite ne donne lieu à aucun paiement');
    expect(seul).not.toContain('Onglets offerts');
  });
  it('formules payantes : onglets offerts ignorés, services et prix Accompagné', () => {
    const autonomie = genererConventionHtml({ ...base, formule: 'autonomie', premiere_annee_offerte: true, onglets_offerts: ['mur'] }, { nom: 'Fay', slug: 'fay' }, '60', entreprise);
    expect(autonomie).toContain('Tous les onglets et modules');
    expect(autonomie).toContain("12 mois d'accès complet");
    expect(autonomie).not.toContain('Accompagné');
    const accompagne = genererConventionHtml({ ...base, formule: 'accompagne', prix_annuel_fondateur: 292.5 }, { nom: 'Fay', slug: 'fay' }, '60', entreprise);
    expect(accompagne).toContain("<strong>Les services de l'offre Accompagné</strong> : support prioritaire, bilan mensuel");
    expect(accompagne).toContain("pour l'offre Accompagné, ce qui correspond à 35 % de réduction");
    expect(accompagne).toContain('292,50 € par an (offre Accompagné)');
  });
  it('inscrit le prix fondateur exact de la convention quand il est renseigné', () => {
    const avecPrix = genererConventionHtml({ ...base, premiere_annee_offerte: true, prix_annuel_fondateur: '188.50' }, { nom: 'Tourly', slug: 'tourly' }, '60', entreprise);
    expect(avecPrix).toContain('au tarif fondateur de <strong>188,50 € par an</strong> (soit 15,71 € par mois) pour l\'offre Autonomie');
    expect(avecPrix).toContain('188,50 € par an (offre Autonomie), tant que l\'abonnement est continu');
    const sansPrix = genererConventionHtml({ ...base, premiere_annee_offerte: true }, { nom: 'Tourly', slug: 'tourly' }, '60', entreprise);
    expect(sansPrix).toContain('Grille du site − 35 %');
  });
  it('ajoute les conditions particulières en article 6, échappées', () => {
    const html = genererConventionHtml({ ...base, conditions_particulieres: 'Formation offerte.\n\nDeuxième <b>point</b>\nsur deux lignes' }, { nom: 'Fay', slug: 'fay' }, '60', entreprise);
    expect(html).toContain('<h2>Article 6 — Conditions particulières</h2>');
    expect(html).toContain('<p>Formation offerte.</p><p>Deuxième &lt;b&gt;point&lt;/b&gt;<br>sur deux lignes</p>');
    expect(genererConventionHtml(base, { nom: 'Fay', slug: 'fay' }, '60', entreprise)).not.toContain('Article 6');
  });
  it('a un libellé pour chaque onglet de la plateforme', () => {
    expect(Object.keys(LIBELLES_ONGLETS)).toEqual([...TOUS_LES_ONGLETS]);
  });
  it('neutralise un texte piégé saisi par la mairie', () => {
    const html = genererConventionHtml({ ...base, signataire_nom: '<img src=x onerror=alert(1)>' }, { nom: 'Fay', slug: 'fay' }, '60', entreprise);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('signature électronique du Prestataire', () => {
  const json = async () => ({ 'Content-Type': 'application/json', ...(await sessionStaff()) });
  beforeEach(() => {
    db.conventions.push({ id: 'c1', commune_id: 'fay', statut: 'envoyee', numero_fondatrice: 2, jeton_formulaire: JETON, signataire_nom: 'Marie Dupont' });
  });

  it('assemble convention et DPA en un seul document, chacun avec ses styles', async () => {
    const { html, signee_par_prestataire } = await (await routesStaff.request('/c1/document', { headers: await sessionStaff() }, ENV)).json();
    expect(signee_par_prestataire).toBe(false);
    expect(html).toContain('Annexe 1 à la convention');
    expect(html).toContain('class="contrat-dpa"');
    expect(html).not.toContain('SIGNATURE_PRESTATAIRE');
    expect(html).not.toContain('Signé électroniquement');
    // Seules les classes CSS du DPA sont renommées, jamais le mot « contrat » de son texte.
    expect(html).not.toMatch(/[a-zé]\.contrat-dpa/);
    expect(html).toContain(' contrat');
  });

  it('reprend en annexe 1 le DPA réécrit pour la commune', async () => {
    db.dpa_communes = [{ commune_id: 'fay', texte_annexes: '<p class="partie">Annexes propres à Fay</p>' }];
    const { html } = await (await routesStaff.request('/c1/document', { headers: await sessionStaff() }, ENV)).json() as any;
    expect(html).toContain('Annexes propres à Fay');
    expect(html).not.toContain('Annexe 3 — Sous-traitants ultérieurs autorisés');
    expect(html.split('<!--SIGNATURE_PRESTATAIRE-->')).toHaveLength(1); // marqueurs vides : document non signé
  });

  it('fige le document signé, avec empreinte, et le sert tel quel', async () => {
    const res = await routesStaff.request('/c1/signer', { method: 'POST', headers: await sessionStaff() }, ENV);
    expect(res.status).toBe(200);
    const conv = db.conventions[0];
    expect(conv.signature_prestataire_empreinte).toMatch(/^[a-f0-9]{64}$/);
    expect(conv.document_signe_html).toContain('<!--SIGNATURE_PRESTATAIRE-->');
    // Un changement ultérieur des réglages ne modifie pas le document signé.
    db.parametres_facturation[0].valeur = 'AUTRE RAISON SOCIALE';
    const { html, signee_par_prestataire } = await (await routesStaff.request('/c1/document', { headers: await sessionStaff() }, ENV)).json();
    expect(signee_par_prestataire).toBe(true);
    expect(html).toContain('SALLE LEANDRE');
    expect(html).not.toContain('AUTRE RAISON SOCIALE');
    expect(html.match(/Signé électroniquement par Léandre SALLE/g)).toHaveLength(2); // convention + DPA
    expect(html).toContain(conv.signature_prestataire_empreinte.slice(0, 8));
  });

  it('verrouille le contenu après signature (staff et mairie), pas le suivi du statut', async () => {
    await routesStaff.request('/c1/signer', { method: 'POST', headers: await sessionStaff() }, ENV);
    const modif = await routesStaff.request('/c1', { method: 'PATCH', headers: await json(), body: JSON.stringify({ prix_annuel_fondateur: 100 }) }, ENV);
    expect(modif.status).toBe(409);
    const statut = await routesStaff.request('/c1', { method: 'PATCH', headers: await json(), body: JSON.stringify({ statut: 'signee' }) }, ENV);
    expect(statut.status).toBe(200);
    db.conventions[0].statut = 'envoyee';
    const mairie = await routesFormulaire.request(`/${JETON}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signataire_nom: 'Autre' }) }, ENV);
    expect(mairie.status).toBe(409);
    expect(db.conventions[0].signataire_nom).toBe('Marie Dupont');
  });

  it('refuse la signature à un assistant', async () => {
    db.staff_backoffice = [{ id: 's1', role: 'assistant' }];
    expect((await routesStaff.request('/c1/signer', { method: 'POST', headers: await sessionStaff() }, ENV)).status).toBe(403);
    expect(db.conventions[0].signature_prestataire_le).toBeUndefined();
  });

  it('texte personnalisé : remplace le corps, nettoyé, signatures et DPA gardés', async () => {
    const piege = '<h2 onclick="x()">Article 1 — Mon texte</h2><p style="color:red" class="chapeau">Libre</p>'
      + '<script>alert(1)</script><!--SIGNATURE_PRESTATAIRE--><img src=x onerror=alert(1)><a href="javascript:x">lien</a>';
    const res = await routesStaff.request('/c1/texte', { method: 'PUT', headers: await json(), body: JSON.stringify({ texte: piege }) }, ENV);
    expect(res.status).toBe(200);
    expect(db.conventions[0].texte_personnalise).toBe('<h2>Article 1 — Mon texte</h2><p class="chapeau">Libre</p>lien');
    const { html, modifiable, texte_personnalise_le } = await (await routesStaff.request('/c1/document', { headers: await sessionStaff() }, ENV)).json();
    expect(modifiable).toBe(true);
    expect(texte_personnalise_le).toBeTruthy();
    expect(html).toContain('Article 1 — Mon texte');
    expect(html).not.toContain('Les parties');
    expect(html).toContain('<h2>Signatures</h2>');
    expect(html).toContain('Annexe 1 à la convention');
    // La signature électronique ne vient que des marqueurs du Worker : 2 (convention + DPA), pas 3.
    await routesStaff.request('/c1/signer', { method: 'POST', headers: await sessionStaff() }, ENV);
    expect(db.conventions[0].document_signe_html.split('<!--SIGNATURE_PRESTATAIRE-->')).toHaveLength(3);
    expect(db.conventions[0].document_signe_html).toContain('Article 1 — Mon texte');
  });

  it('texte personnalisé : retour au texte automatique, refusé après signature ou à un assistant', async () => {
    await routesStaff.request('/c1/texte', { method: 'PUT', headers: await json(), body: JSON.stringify({ texte: '<p>Libre</p>' }) }, ENV);
    await routesStaff.request('/c1/texte', { method: 'PUT', headers: await json(), body: JSON.stringify({ texte: null }) }, ENV);
    expect(db.conventions[0].texte_personnalise).toBeNull();
    expect((await routesStaff.request('/c1/texte', { method: 'PUT', headers: await json(), body: JSON.stringify({ texte: '<p> </p>' }) }, ENV)).status).toBe(400);
    await routesStaff.request('/c1/signer', { method: 'POST', headers: await sessionStaff() }, ENV);
    expect((await routesStaff.request('/c1/texte', { method: 'PUT', headers: await json(), body: JSON.stringify({ texte: '<p>Après</p>' }) }, ENV)).status).toBe(409);
    db.conventions[0].signature_prestataire_le = null;
    db.staff_backoffice = [{ id: 's1', role: 'assistant' }];
    expect((await routesStaff.request('/c1/texte', { method: 'PUT', headers: await json(), body: JSON.stringify({ texte: '<p>VA</p>' }) }, ENV)).status).toBe(403);
  });

  it('n’accepte qu’une image produite par le Worker dans le bloc de signature', async () => {
    const { appliquerSignature, MARQUEUR_SIGNATURE } = await import('../src/backoffice/convention-document');
    const piege = appliquerSignature(`<p>${MARQUEUR_SIGNATURE}</p>`, { le: '2026-11-04T13:32:00Z', empreinte: 'a'.repeat(64), image: 'javascript:alert(1)' });
    expect(piege).not.toContain('<img');
    const ok = appliquerSignature(`<p>${MARQUEUR_SIGNATURE}</p>`, { le: '2026-11-04T13:32:00Z', empreinte: 'a'.repeat(64), image: 'data:image/png;base64,iVBORw0KGgo=' });
    expect(ok).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
    expect(ok).toContain('le 4 novembre 2026 à 14:32 (heure de Paris)');
  });
});

describe('offre de la convention : mise en service, reconduction et fermeture', () => {
  const json = async () => ({ 'Content-Type': 'application/json', ...(await sessionStaff()) });
  beforeEach(() => {
    db.communes[1].forfait = 'Version complète';
    db.communes[1].prix_annuel_ttc = 250;
    db.conventions.push({ id: 'c2', commune_id: 'tourly', statut: 'envoyee', numero_fondatrice: 3, formule: 'gratuit', onglets_offerts: ['mur', 'coups_de_main'], offre_reconductions: 2, offre_non_reconduite: true });
  });
  const actifs = (commune: string) => db.onglets_config.filter((o) => o.commune_id === commune && o.actif).map((o) => o.cle).sort();
  const LIBRES = ['actualites', 'agenda', 'alertes', 'chasse_tresor', 'enigmes'];

  it('enregistre formule et onglets offerts (doublons retirés, vide = null), refuse une valeur inconnue', async () => {
    const ok = await routesStaff.request('/c2', { method: 'PATCH', headers: await json(), body: JSON.stringify({ formule: 'gratuit', onglets_offerts: ['mur', 'mur', 'memoire'] }) }, ENV);
    expect(ok.status).toBe(200);
    expect(db.conventions[0].onglets_offerts).toEqual(['mur', 'memoire']);
    await routesStaff.request('/c2', { method: 'PATCH', headers: await json(), body: JSON.stringify({ onglets_offerts: [] }) }, ENV);
    expect(db.conventions[0].onglets_offerts).toBeNull();
    for (const corps of [{ onglets_offerts: ['piscine'] }, { formule: 'premium' }]) {
      expect((await routesStaff.request('/c2', { method: 'PATCH', headers: await json(), body: JSON.stringify(corps) }, ENV)).status).toBe(400);
    }
  });

  it('après signature : « Ne pas reconduire » reste possible, la formule non', async () => {
    db.conventions[0].signature_prestataire_le = '2026-11-23T10:00:00Z';
    expect((await routesStaff.request('/c2', { method: 'PATCH', headers: await json(), body: JSON.stringify({ offre_non_reconduite: false }) }, ENV)).status).toBe(200);
    expect(db.conventions[0].offre_non_reconduite).toBe(false);
    expect((await routesStaff.request('/c2', { method: 'PATCH', headers: await json(), body: JSON.stringify({ formule: 'autonomie' }) }, ENV)).status).toBe(409);
  });

  it('gratuite : ouvre gratuit + onglets offerts datés, ferme le reste, formule et forfait recopiés, compteurs remis à zéro', async () => {
    const res = await routesStaff.request('/c2/mettre-en-service', { method: 'POST', headers: await json(), body: JSON.stringify({ debut: '2026-11-23' }) }, ENV);
    expect(res.status).toBe(200);
    expect((await res.json() as any).offert_jusqu_au).toBe('2027-11-22');
    expect(actifs('tourly')).toEqual([...LIBRES, 'coups_de_main', 'mur'].sort());
    expect(db.onglets_config.filter((o) => o.offert_jusqu_au).map((o) => [o.cle, o.offert_jusqu_au]).sort())
      .toEqual([['coups_de_main', '2027-11-22'], ['mur', '2027-11-22']]);
    expect(db.communes[1]).toMatchObject({ forfait: 'Fondateur', formule: 'gratuit', prix_annuel_ttc: null, prochaine_echeance: null });
    expect(db.conventions[0]).toMatchObject({ offre_reconductions: 0, offre_non_reconduite: false });
  });

  it('payante avec première année offerte : tous les onglets offerts ; sans elle : refusée', async () => {
    Object.assign(db.conventions[0], { formule: 'accompagne', premiere_annee_offerte: true });
    await routesStaff.request('/c2/mettre-en-service', { method: 'POST', headers: await json(), body: '{}' }, ENV);
    expect(actifs('tourly')).toHaveLength(TOUS_LES_ONGLETS.length);
    expect(db.onglets_config.filter((o) => o.offert_jusqu_au)).toHaveLength(TOUS_LES_ONGLETS.length - 5);
    expect(db.communes[1].formule).toBe('accompagne');
    db.conventions[0].premiere_annee_offerte = false;
    expect((await routesStaff.request('/c2/mettre-en-service', { method: 'POST', headers: await json(), body: '{}' }, ENV)).status).toBe(400);
  });

  it('refusée à un assistant', async () => {
    db.staff_backoffice = [{ id: 's1', role: 'assistant' }];
    expect((await routesStaff.request('/c2/mettre-en-service', { method: 'POST', headers: await json(), body: '{}' }, ENV)).status).toBe(403);
    expect(db.onglets_config).toHaveLength(0);
  });

  it('cron : reconduit tacitement la formule gratuite (12 mois, compteur +1), sans rien fermer', async () => {
    await routesStaff.request('/c2/mettre-en-service', { method: 'POST', headers: await json(), body: JSON.stringify({ debut: '2024-01-10' }) }, ENV);
    await fermerOngletsOfferts(ENV);
    expect(actifs('tourly')).toEqual([...LIBRES, 'coups_de_main', 'mur'].sort());
    expect(db.onglets_config.filter((o) => o.offert_jusqu_au).map((o) => o.offert_jusqu_au)).toEqual(['2026-01-09', '2026-01-09']);
    expect(db.conventions[0].offre_reconductions).toBe(1);
    expect(db.communes[1].forfait).toBe('Fondateur');
    expect(db.journal_activite.some((j) => j.action === 'offre_reconduite')).toBe(true);
  });

  for (const [cas, etat] of [['reconduction refusée', { offre_non_reconduite: true }], ['4 ans atteints', { offre_reconductions: 3 }],
    ['convention payante', { formule: 'autonomie', premiere_annee_offerte: true }]] as const) {
    it(`cron : ferme les onglets offerts échus (${cas}) et repasse la commune en Gratuit, pas les offres en cours`, async () => {
      await routesStaff.request('/c2/mettre-en-service', { method: 'POST', headers: await json(), body: JSON.stringify({ debut: '2024-01-10' }) }, ENV);
      Object.assign(db.conventions[0], etat);
      db.onglets_config.push({ commune_id: 'fay', cle: 'mur', actif: true, offert_jusqu_au: '2099-01-01' });
      db.communes[0].forfait = 'Fondateur';
      await fermerOngletsOfferts(ENV);
      expect(actifs('tourly')).toEqual(LIBRES);
      expect(db.onglets_config.filter((o) => o.commune_id === 'tourly' && o.offert_jusqu_au)).toHaveLength(0);
      expect(db.communes[1].forfait).toBe('Gratuit');
      expect(actifs('fay')).toEqual(['mur']);
      expect(db.communes[0].forfait).toBe('Fondateur');
      expect(db.journal_activite.some((j) => j.action === 'onglets_offerts_fermes')).toBe(true);
    });
  }

  it('rappel : reconduction entre J-90 et J-60 (date limite du préavis), fermeture dans les 30 derniers jours', () => {
    const jour = (iso: string) => new Date(iso + 'T08:00:00Z').getTime();
    const gratuite = { formule: 'gratuit', statut: 'signee', offre_reconductions: 0, offre_non_reconduite: false };
    expect(anomalieFinOffre(gratuite, '2027-11-22', ['Mur des voisins'], jour('2027-08-01'))).toBeNull(); // J-113
    const r = anomalieFinOffre(gratuite, '2027-11-22', ['Mur des voisins'], jour('2027-09-01')); // J-82
    expect(r?.gravite).toBe('info');
    expect(r?.message).toContain('reconduction 1/3');
    expect(r?.message).toContain('avant le 22 septembre 2027');
    expect(anomalieFinOffre(gratuite, '2027-11-22', ['Mur des voisins'], jour('2027-10-01'))).toBeNull(); // J-52 : trop tard pour refuser
    const refusee = { ...gratuite, offre_non_reconduite: true };
    expect(anomalieFinOffre(refusee, '2027-11-22', ['Mur des voisins'], jour('2027-10-01'))).toBeNull();
    const fermeture = anomalieFinOffre(refusee, '2027-11-22', ['Mur des voisins'], jour('2027-11-01'));
    expect(fermeture?.gravite).toBe('moyenne');
    expect(fermeture?.message).toContain('offre non reconduite');
    expect(fermeture?.message).toContain('se ferment seuls le lendemain');
    expect(anomalieFinOffre({ ...gratuite, offre_reconductions: 3 }, '2027-11-22', ['Mur des voisins'], jour('2027-11-01'))?.message).toContain('fin des 4 ans');
  });
});
