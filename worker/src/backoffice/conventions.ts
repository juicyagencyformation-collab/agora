// worker/src/backoffice/conventions.ts
// Convention « Commune fondatrice » (migration 088, texte dans convention-document.ts).
// - routesStaff (backoffice, session staff) : créer, compléter, suivre le statut, générer le document.
// - routesFormulaire (PUBLIC, par jeton) : la secrétaire de mairie remplit elle-même les
//   informations à réunir depuis un lien personnel, sans compte. Le jeton est long et aléatoire,
//   et le lien cesse de fonctionner une fois la convention signée ou annulée.
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseInsert, supabaseUpdate, journaliser } from '../db';
import { backofficeMiddleware, exigerAdmin } from '../middleware/backoffice';
import { departementDeLaCommune } from '../lib/regions';
import { genererConventionHtml, LIBELLES_ONGLETS, assemblerConventionEtDpa, appliquerSignature, empreinteSha256, nettoyerTexteConvention } from './convention-document';
import { genererContratDpaHtml } from './contrat-dpa';
import { infosContratDpa, chargerImageSignature } from './facturation';
import { TOUS_LES_ONGLETS, chargerOngletsGratuits, appliquerOngletsSurCommune } from './administration';

const COLONNES = 'id,commune_id,statut,numero_fondatrice,signataire_nom,signataire_qualite,deliberation_reference,'
  + 'deliberation_date,option_reconduction,siret_commune,code_service_chorus,facturation_nom,facturation_email,'
  + 'date_debut_souhaitee,citation_autorisee,premiere_annee_offerte,prix_annuel_fondateur,conditions_particulieres,onglets_offerts,jeton_formulaire,formulaire_rempli_le,envoyee_le,signee_le,created_at,updated_at,'
  + 'signature_prestataire_le,signature_prestataire_empreinte,texte_personnalise,texte_personnalise_le';
// Une fois signée par le Prestataire, la convention est figée : seuls ces champs restent modifiables
// (suivi de la signature côté mairie). Tout le reste changerait le texte signé.
const CHAMPS_MODIFIABLES_APRES_SIGNATURE = ['statut', 'signee_le'];
const CHAMPS_COMMUNE = ['signataire_nom', 'signataire_qualite', 'deliberation_reference', 'deliberation_date', 'option_reconduction',
  'siret_commune', 'code_service_chorus', 'facturation_nom', 'facturation_email', 'date_debut_souhaitee', 'citation_autorisee'] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide');
const texte = (max: number) => z.string().trim().min(1).max(max);
const champsCommuneSchema = z.object({
  signataire_nom: texte(150).nullable().optional(),
  signataire_qualite: texte(100).nullable().optional(),
  deliberation_reference: texte(100).nullable().optional(),
  deliberation_date: date.nullable().optional(),
  option_reconduction: z.enum(['tacite', 'annuelle']).nullable().optional(),
  siret_commune: z.string().transform((s) => s.replace(/\s/g, '')).pipe(z.string().regex(/^\d{14}$/, 'Le SIRET compte 14 chiffres.')).nullable().optional(),
  code_service_chorus: texte(50).nullable().optional(),
  facturation_nom: texte(150).nullable().optional(),
  facturation_email: z.string().trim().email('Adresse email invalide').max(200).nullable().optional(),
  date_debut_souhaitee: date.nullable().optional(),
  citation_autorisee: z.boolean().nullable().optional(),
});
const staffSchema = champsCommuneSchema.extend({
  numero_fondatrice: z.number().int().min(1).max(10).nullable().optional(),
  statut: z.enum(['brouillon', 'envoyee', 'signee', 'annulee']).optional(),
  // Accord exceptionnel (migrations 090 puis 096), réservé au staff : la mairie ne le voit qu'à
  // travers le texte. Prix fondateur exact propre à CETTE convention, et conditions particulières libres.
  premiere_annee_offerte: z.boolean().optional(),
  prix_annuel_fondateur: z.number().min(0).max(100000).multipleOf(0.01).nullable().optional(),
  conditions_particulieres: z.string().trim().max(4000).nullable().optional(),
  // Offre à la carte (migration 119) : onglets offerts 12 mois en plus de la version gratuite.
  // Vide = accès complet offert (enregistré null).
  onglets_offerts: z.array(z.enum(TOUS_LES_ONGLETS)).max(TOUS_LES_ONGLETS.length)
    .transform((l) => (l.length ? [...new Set(l)] : null)).nullable().optional(),
  signee_le: date.nullable().optional(),
});

// Champ laissé vide dans un formulaire = information effacée (null), pas une chaîne vide.
function corpsNormalise(body: any) {
  if (!body || typeof body !== 'object') return body;
  return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]));
}
const premiereErreur = (e: z.ZodError) => e.issues[0]?.message ?? 'Données invalides';
const estDoublonNumero = (e: unknown) => /23505|duplicate|numero_fondatrice/.test(String(e));

async function chargerEntreprise(env: any): Promise<Record<string, string>> {
  const lignes = await supabaseSelect(env, 'parametres_facturation', { select: 'cle,valeur', cle: 'like.entreprise_*' });
  return Object.fromEntries(lignes.map((l: any) => [l.cle, l.valeur || '']));
}

function jetonAleatoire(): string {
  const octets = crypto.getRandomValues(new Uint8Array(32));
  return [...octets].map((o) => o.toString(16).padStart(2, '0')).join('');
}

// ── Staff ──
export const routesStaff = new Hono();
routesStaff.use('*', backofficeMiddleware);

routesStaff.get('/commune/:communeId', async (c) => {
  const communeId = c.req.param('communeId');
  const [[convention], prises, ongletsGratuits] = await Promise.all([
    supabaseSelect(c.env, 'conventions', { select: COLONNES, commune_id: `eq.${communeId}` }),
    supabaseSelect(c.env, 'conventions', { select: 'commune_id,numero_fondatrice', statut: 'neq.annulee', numero_fondatrice: 'not.is.null' }),
    chargerOngletsGratuits(c.env),
  ]);
  return c.json({
    convention: convention ?? null,
    numeros_pris: prises.filter((p: any) => p.commune_id !== communeId).map((p: any) => p.numero_fondatrice),
    // Pour cocher les onglets offerts : seuls les onglets payants sont proposés.
    onglets_gratuits: ongletsGratuits,
  });
});

routesStaff.post('/commune/:communeId', async (c) => {
  const communeId = c.req.param('communeId');
  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'id,nom', id: `eq.${communeId}` });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  const [existante] = await supabaseSelect(c.env, 'conventions', { select: 'id', commune_id: `eq.${communeId}` });
  if (existante) return c.json({ erreur: 'Cette commune a déjà une convention.' }, 400);

  // Premier numéro de commune fondatrice encore libre (1 à 10), et nom du maire déjà connu s'il existe.
  const prises = await supabaseSelect(c.env, 'conventions', { select: 'numero_fondatrice', statut: 'neq.annulee', numero_fondatrice: 'not.is.null' });
  const pris = new Set(prises.map((p: any) => p.numero_fondatrice));
  const numero = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((n) => !pris.has(n)) ?? null;
  const [maire] = await supabaseSelect(c.env, 'users', {
    select: 'prenom,nom', commune_id: `eq.${communeId}`, role: 'eq.maire', compte_supprime_le: 'is.null', limit: '1',
  });
  const [prospect] = maire ? [null] : await supabaseSelect(c.env, 'prospects', { select: 'nom_maire', commune_id: `eq.${communeId}`, limit: '1' });
  const nomMaire = maire ? `${maire.prenom} ${maire.nom}`.trim() : (prospect?.nom_maire || null);

  const [convention] = await supabaseInsert(c.env, 'conventions', {
    commune_id: communeId, numero_fondatrice: numero, signataire_nom: nomMaire, signataire_qualite: 'maire',
    jeton_formulaire: jetonAleatoire(),
  });
  await journaliser(c.env, c.get('staff_id'), 'convention_creee', `${commune.nom} — fondatrice n° ${numero ?? '?'}`);
  return c.json({ convention }, 201);
});

routesStaff.patch('/:id', async (c) => {
  const body = staffSchema.safeParse(corpsNormalise(await c.req.json().catch(() => null)));
  if (!body.success) return c.json({ erreur: premiereErreur(body.error) }, 400);
  const [actuelle] = await supabaseSelect(c.env, 'conventions', { select: 'id,commune_id,statut,envoyee_le,signature_prestataire_le', id: `eq.${c.req.param('id')}` });
  if (!actuelle) return c.json({ erreur: 'Convention introuvable' }, 404);
  if (actuelle.signature_prestataire_le && Object.keys(body.data).some((k) => !CHAMPS_MODIFIABLES_APRES_SIGNATURE.includes(k))) {
    return c.json({ erreur: 'Convention figée par votre signature : annulez-la d\'abord pour modifier son contenu.' }, 409);
  }

  const patch: Record<string, unknown> = { ...body.data, updated_at: new Date().toISOString() };
  if (body.data.statut === 'envoyee' && !actuelle.envoyee_le) patch.envoyee_le = new Date().toISOString();
  if (body.data.statut === 'signee' && !body.data.signee_le) patch.signee_le = new Date().toISOString().slice(0, 10);
  try {
    await supabaseUpdate(c.env, 'conventions', patch, { id: `eq.${actuelle.id}` });
  } catch (e) {
    if (estDoublonNumero(e)) return c.json({ erreur: 'Ce numéro de commune fondatrice est déjà attribué.' }, 400);
    throw e;
  }
  if (body.data.statut && body.data.statut !== actuelle.statut) {
    await journaliser(c.env, c.get('staff_id'), 'convention_statut', `${actuelle.commune_id} : ${actuelle.statut} → ${body.data.statut}`);
  }
  const [convention] = await supabaseSelect(c.env, 'conventions', { select: COLONNES, id: `eq.${actuelle.id}` });
  return c.json({ convention });
});

// Convention + DPA en annexe 1, NON signé (marqueurs de signature vides) : c'est ce document qui est
// signé et dont l'empreinte est calculée. Régénéré depuis la fiche tant que la convention n'est pas figée.
async function documentComplet(env: any, conv: any): Promise<{ html: string; commune_nom: string | undefined }> {
  const [[commune], entreprise, departement, onglets, dpa, ongletsGratuits] = await Promise.all([
    supabaseSelect(env, 'communes', { select: 'nom,slug', id: `eq.${conv.commune_id}` }),
    chargerEntreprise(env),
    departementDeLaCommune(env, conv.commune_id),
    supabaseSelect(env, 'onglets_config', { select: 'cle,actif', commune_id: `eq.${conv.commune_id}` }),
    infosContratDpa(env, conv.commune_id),
    chargerOngletsGratuits(env),
  ]);
  // Même règle que l'application (middleware/onglet.ts) : un onglet sans ligne est actif.
  const desactives = onglets.filter((o: any) => o.actif === false).map((o: any) => o.cle);
  const ongletsActifs = Object.keys(LIBELLES_ONGLETS).filter((cle) => !desactives.includes(cle));
  const convention = genererConventionHtml(conv, commune, departement, entreprise, ongletsActifs, ongletsGratuits);
  const html = dpa ? assemblerConventionEtDpa(convention, genererContratDpaHtml(dpa.commune, dpa.infos)) : convention;
  return { html, commune_nom: commune?.nom };
}

routesStaff.get('/:id/document', async (c) => {
  const [conv] = await supabaseSelect(c.env, 'conventions', {
    select: COLONNES + ',document_signe_html', id: `eq.${c.req.param('id')}`,
  });
  if (!conv) return c.json({ erreur: 'Convention introuvable' }, 404);
  // Signée : on sert l'instantané figé (exactement ce qui a été signé), jamais une version régénérée.
  if (conv.document_signe_html) {
    const [commune] = await supabaseSelect(c.env, 'communes', { select: 'nom', id: `eq.${conv.commune_id}` });
    const signature = { le: conv.signature_prestataire_le, empreinte: conv.signature_prestataire_empreinte, image: await chargerImageSignature(c.env) };
    return c.json({ html: appliquerSignature(conv.document_signe_html, signature), commune_nom: commune?.nom, signee_par_prestataire: true });
  }
  const { html, commune_nom } = await documentComplet(c.env, conv);
  return c.json({
    html: appliquerSignature(html, null), commune_nom, signee_par_prestataire: false,
    modifiable: !['signee', 'annulee'].includes(conv.statut),
    texte_personnalise_le: conv.texte_personnalise_le ?? null, formulaire_rempli_le: conv.formulaire_rempli_le ?? null,
  });
});

// PUT /:id/texte — texte de la convention réécrit à la main pour CETTE commune (2026-11-20) :
// remplace tout le corps (titre → article 6), nettoyé (convention-document.ts). null = revenir au
// texte automatique. Réservé à l'administrateur, et impossible une fois la convention signée.
const texteSchema = z.object({ texte: z.string().max(200000).nullable() }).strict();
routesStaff.put('/:id/texte', exigerAdmin, async (c) => {
  const body = texteSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: premiereErreur(body.error) }, 400);
  const [conv] = await supabaseSelect(c.env, 'conventions', { select: 'id,commune_id,statut,signature_prestataire_le', id: `eq.${c.req.param('id')}` });
  if (!conv) return c.json({ erreur: 'Convention introuvable' }, 404);
  if (conv.signature_prestataire_le || ['signee', 'annulee'].includes(conv.statut)) {
    return c.json({ erreur: 'Convention figée par la signature : annulez-la d\'abord pour modifier son texte.' }, 409);
  }
  const texte = body.data.texte === null ? null : nettoyerTexteConvention(body.data.texte).trim();
  if (texte !== null && !texte.replace(/<[^>]*>/g, '').trim()) return c.json({ erreur: 'Le texte de la convention est vide.' }, 400);
  const maintenant = new Date().toISOString();
  await supabaseUpdate(c.env, 'conventions', {
    texte_personnalise: texte, texte_personnalise_le: texte === null ? null : maintenant, updated_at: maintenant,
  }, { id: `eq.${conv.id}` });
  await journaliser(c.env, c.get('staff_id'), texte === null ? 'convention_texte_automatique' : 'convention_texte_personnalise', conv.commune_id);
  return c.json({ ok: true, texte_personnalise_le: texte === null ? null : maintenant });
});

// Dernier jour INCLUS d'une offre de 12 mois : mise en service le 23/11/2026 → offert jusqu'au 22/11/2027.
export function finOffre12Mois(debut: string): string {
  const d = new Date(debut + 'T12:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// POST /:id/mettre-en-service — applique sur la commune l'offre de la convention « première année
// offerte » (2026-11-23) : version gratuite + onglets offerts (à la carte), ou tous les onglets
// (accès complet), chaque onglet offert portant sa date de fin. Le cron ferme ces onglets le
// lendemain (cron.ts, fermerOngletsOfferts) ; rappel 30 jours avant dans les anomalies. Forfait
// « Fondateur », sans prix ni échéance, comme le préréglage « Fondateur, accès offert ».
const miseEnServiceSchema = z.object({ debut: date.optional() }).strict();
routesStaff.post('/:id/mettre-en-service', exigerAdmin, async (c) => {
  const body = miseEnServiceSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ erreur: premiereErreur(body.error) }, 400);
  const [conv] = await supabaseSelect(c.env, 'conventions', {
    select: 'id,commune_id,statut,premiere_annee_offerte,onglets_offerts', id: `eq.${c.req.param('id')}`,
  });
  if (!conv) return c.json({ erreur: 'Convention introuvable' }, 404);
  if (conv.statut === 'annulee') return c.json({ erreur: 'Convention annulée.' }, 400);
  if (!conv.premiere_annee_offerte) return c.json({ erreur: 'Cette convention n\'offre pas de première année : rien à mettre en service ici.' }, 400);

  const gratuits = await chargerOngletsGratuits(c.env);
  const payants = TOUS_LES_ONGLETS.filter((cle) => !gratuits.includes(cle));
  const choisis = (conv.onglets_offerts ?? []).filter((cle: string) => payants.includes(cle as any));
  const offerts = choisis.length ? choisis : payants;
  const debut = body.data.debut ?? new Date().toISOString().slice(0, 10);
  const fin = finOffre12Mois(debut);

  // Remet toutes les dates à zéro (appliquerOngletsSurCommune), puis date les seuls onglets offerts.
  await appliquerOngletsSurCommune(c.env, conv.commune_id, [...gratuits, ...offerts]);
  await supabaseUpdate(c.env, 'onglets_config', { offert_jusqu_au: fin }, { commune_id: `eq.${conv.commune_id}`, cle: `in.(${offerts.join(',')})` });
  await supabaseUpdate(c.env, 'communes', { forfait: 'Fondateur', prix_annuel_ttc: null, prochaine_echeance: null }, { id: `eq.${conv.commune_id}` });
  await journaliser(c.env, c.get('staff_id'), 'offre_fondatrice_mise_en_service',
    `${conv.commune_id} — ${choisis.length ? offerts.join(', ') : 'accès complet'} offert du ${debut} au ${fin}`);
  return c.json({ ok: true, onglets_offerts: offerts, offert_jusqu_au: fin });
});

// POST /:id/signer — signature électronique simple du Prestataire (eIDAS, art. 1367 du Code civil) :
// fige le document tel qu'il est à cet instant (instantané + empreinte SHA-256 + date + auteur).
// Réservé au compte administrateur.
routesStaff.post('/:id/signer', exigerAdmin, async (c) => {
  const [conv] = await supabaseSelect(c.env, 'conventions', { select: COLONNES, id: `eq.${c.req.param('id')}` });
  if (!conv) return c.json({ erreur: 'Convention introuvable' }, 404);
  if (conv.signature_prestataire_le) return c.json({ erreur: 'Déjà signée par vous.' }, 400);
  if (['signee', 'annulee'].includes(conv.statut)) return c.json({ erreur: 'Convention déjà signée ou annulée.' }, 400);
  const { html, commune_nom } = await documentComplet(c.env, conv);
  const maintenant = new Date().toISOString();
  const empreinte = await empreinteSha256(html);
  await supabaseUpdate(c.env, 'conventions', {
    document_signe_html: html, signature_prestataire_le: maintenant, signature_prestataire_par: c.get('staff_id'),
    signature_prestataire_empreinte: empreinte, updated_at: maintenant,
  }, { id: `eq.${conv.id}` });
  await journaliser(c.env, c.get('staff_id'), 'convention_signee_prestataire', `${commune_nom ?? conv.commune_id} — empreinte ${empreinte}`);
  return c.json({ ok: true, signature_prestataire_le: maintenant, signature_prestataire_empreinte: empreinte });
});

// DELETE /:id/signature — annule la signature du Prestataire, tant que la mairie n'a pas signé.
routesStaff.delete('/:id/signature', exigerAdmin, async (c) => {
  const [conv] = await supabaseSelect(c.env, 'conventions', { select: 'id,commune_id,statut', id: `eq.${c.req.param('id')}` });
  if (!conv) return c.json({ erreur: 'Convention introuvable' }, 404);
  if (conv.statut === 'signee') return c.json({ erreur: 'La mairie a déjà signé : la signature ne peut plus être annulée.' }, 400);
  await supabaseUpdate(c.env, 'conventions', {
    document_signe_html: null, signature_prestataire_le: null, signature_prestataire_par: null,
    signature_prestataire_empreinte: null, updated_at: new Date().toISOString(),
  }, { id: `eq.${conv.id}` });
  await journaliser(c.env, c.get('staff_id'), 'convention_signature_annulee', conv.commune_id);
  return c.json({ ok: true });
});

// ── Formulaire de la mairie (public, par jeton) ──
export const routesFormulaire = new Hono();

async function conventionParJeton(env: any, jeton: string) {
  if (!/^[a-f0-9]{64}$/.test(jeton)) return null;
  const [conv] = await supabaseSelect(env, 'conventions', { select: COLONNES, jeton_formulaire: `eq.${jeton}` });
  return conv && !['signee', 'annulee'].includes(conv.statut) ? conv : null;
}

routesFormulaire.get('/:jeton', async (c) => {
  const conv = await conventionParJeton(c.env, c.req.param('jeton'));
  if (!conv) return c.json({ erreur: 'Ce lien n\'est plus valable. Contactez Plateforme-Agora.' }, 404);
  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'nom', id: `eq.${conv.commune_id}` });
  return c.json({
    commune_nom: commune?.nom ?? '',
    numero_fondatrice: conv.numero_fondatrice,
    premiere_annee_offerte: !!conv.premiere_annee_offerte,
    champs: Object.fromEntries(CHAMPS_COMMUNE.map((k) => [k, conv[k] ?? null])),
  });
});

routesFormulaire.post('/:jeton', async (c) => {
  const conv = await conventionParJeton(c.env, c.req.param('jeton'));
  if (!conv) return c.json({ erreur: 'Ce lien n\'est plus valable. Contactez Plateforme-Agora.' }, 404);
  if (conv.signature_prestataire_le) {
    return c.json({ erreur: 'La convention a déjà été signée par Plateforme-Agora : contactez-nous pour toute modification.' }, 409);
  }
  const body = champsCommuneSchema.strict().safeParse(corpsNormalise(await c.req.json().catch(() => null)));
  if (!body.success) return c.json({ erreur: premiereErreur(body.error) }, 400);
  const maintenant = new Date().toISOString();
  await supabaseUpdate(c.env, 'conventions', { ...body.data, formulaire_rempli_le: maintenant, updated_at: maintenant }, { id: `eq.${conv.id}` });
  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'nom', id: `eq.${conv.commune_id}` });
  await journaliser(c.env, null, 'convention_formulaire_rempli', `${commune?.nom ?? conv.commune_id} — informations transmises par la mairie`);
  return c.json({ ok: true });
});
