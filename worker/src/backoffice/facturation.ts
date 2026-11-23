// worker/src/backoffice/facturation.ts
// Devis -> bon de commande -> facture, pour la vente de la version complète aux communes.
// Génère des PDF conformes (impression navigateur, comme la fiche de présentation) — l'envoi
// effectif d'une facture à une commune (administration publique) doit ensuite passer par
// Chorus Pro, obligatoire depuis 2020 pour toute facture à destination du secteur public.
// Décision prise avec Léandre le 2026-08-17 : pas d'intégration API Chorus Pro, dépôt manuel du
// PDF généré ici. Toutes les routes sont derrière backofficeMiddleware (données financières).
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseInsert, supabaseUpdate, supabaseUpsert, journaliser } from '../db';
import { backofficeMiddleware, exigerAdmin, roleStaff } from '../middleware/backoffice';
import { versCsv } from '../lib/csv';
import { genererContratDpaHtml, nettoyerTexteDpa, CHAMPS_DPA, type CleDpa, type InfosDpa } from './contrat-dpa';
import { TOUS_LES_ONGLETS, appliquerOngletsSurCommune, clorerDemandesFormule } from './administration';
import { avecAvoirs, COLONNES_AVOIR, arrondi } from './avoirs';

const app = new Hono();
app.use('*', backofficeMiddleware);

const STATUTS_DEVIS = ['envoye', 'accepte', 'refuse', 'expire'] as const;
// « annulee » n'est jamais choisi à la main : seul un avoir couvrant tout le montant y mène.
const STATUTS_FACTURE = ['emise', 'deposee_chorus', 'payee'] as const;
const STATUTS_AVOIR = ['emis', 'depose_chorus', 'rembourse'] as const;

const CLES_ENTREPRISE = [
  'entreprise_raison_sociale', 'entreprise_forme_juridique', 'entreprise_siret',
  'entreprise_adresse', 'entreprise_cp_ville', 'entreprise_email', 'entreprise_telephone',
  'entreprise_iban', 'entreprise_bic', 'entreprise_mention_tva',
  'entreprise_delai_paiement_jours', 'entreprise_taux_penalites',
] as const;

// GET /parametres-entreprise — informations légales de l'émetteur (raison sociale, SIRET,
// statut TVA...), éditables depuis le backoffice, jamais codées en dur dans les documents.
app.get('/parametres-entreprise', async (c) => {
  const rows = await supabaseSelect(c.env, 'parametres_facturation', {
    select: 'cle,valeur', cle: `in.(${CLES_ENTREPRISE.join(',')})`,
  });
  const parametres: Record<string, string> = {};
  for (const cle of CLES_ENTREPRISE) parametres[cle] = rows.find((r: any) => r.cle === cle)?.valeur || '';
  return c.json({ parametres });
});

const parametresEntrepriseSchema = z.object(
  Object.fromEntries(CLES_ENTREPRISE.map((cle) => [cle, z.string().max(300)])) as Record<typeof CLES_ENTREPRISE[number], z.ZodString>,
);

// — Signature manuscrite du Prestataire (2026-11-04) : image scannée une fois, apposée à côté de la
// mention « Signé électroniquement » des conventions signées (voir conventions.ts, /:id/signer).
// Stockée dans le bucket PRIVÉ des documents (jamais sur le CDN public) et intégrée aux documents
// en data URI par le Worker : elle n'a donc aucune adresse publique.
const CLE_SIGNATURE = 'prestataire/signature';
const TYPES_SIGNATURE = ['image/png', 'image/jpeg'];

export async function chargerImageSignature(env: any): Promise<string | null> {
  if (!env.BUCKET_DOCUMENTS) return null;
  const objet = await env.BUCKET_DOCUMENTS.get(CLE_SIGNATURE);
  if (!objet) return null;
  const type = objet.httpMetadata?.contentType;
  if (!TYPES_SIGNATURE.includes(type)) return null;
  const octets = new Uint8Array(await objet.arrayBuffer());
  let binaire = '';
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(binaire)}`;
}

app.get('/signature-prestataire', async (c) => c.json({ image: await chargerImageSignature(c.env) }));

app.put('/signature-prestataire', exigerAdmin, async (c) => {
  if (!c.env.BUCKET_DOCUMENTS) return c.json({ erreur: 'Stockage privé non configuré' }, 503);
  const formulaire = await c.req.formData().catch(() => null);
  const fichier = formulaire?.get('fichier');
  if (!(fichier instanceof File)) return c.json({ erreur: 'Aucune image' }, 400);
  if (!TYPES_SIGNATURE.includes(fichier.type)) return c.json({ erreur: 'Format accepté : PNG ou JPEG' }, 400);
  if (fichier.size > 1024 * 1024) return c.json({ erreur: 'Image trop lourde (1 Mo maximum)' }, 400);
  await c.env.BUCKET_DOCUMENTS.put(CLE_SIGNATURE, await fichier.arrayBuffer(), { httpMetadata: { contentType: fichier.type } });
  await journaliser(c.env, c.get('staff_id'), 'signature_prestataire', 'image de signature remplacée');
  return c.json({ ok: true });
});

app.delete('/signature-prestataire', exigerAdmin, async (c) => {
  if (c.env.BUCKET_DOCUMENTS) await c.env.BUCKET_DOCUMENTS.delete(CLE_SIGNATURE);
  await journaliser(c.env, c.get('staff_id'), 'signature_prestataire', 'image de signature supprimée');
  return c.json({ ok: true });
});


app.put('/parametres-entreprise', exigerAdmin, async (c) => {
  const body = parametresEntrepriseSchema.partial().safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  for (const [cle, valeur] of Object.entries(body.data)) {
    await supabaseUpdate(c.env, 'parametres_facturation', { valeur }, { cle: `eq.${cle}` });
  }
  return c.json({ ok: true });
});

// Contrat de sous-traitance RGPD (art. 28) pré-rempli pour une commune, à la demande (bouton sur
// sa fiche), jamais généré ni envoyé automatiquement — voir docs/dpa-contrat-sous-traitance.md
// pour la version de référence, à tenir synchronisée. Chaque information à compléter (CHAMPS_DPA)
// vient de la saisie du panneau du document (dpa_communes pour la commune, parametres_facturation
// pour le Prestataire), sinon de la première source existante ci-dessous, renvoyée au panneau.
const CLES_COMMUNE_DPA = CHAMPS_DPA.filter((ch) => ch.groupe === 'commune').map((ch) => ch.cle);
const CLES_PRESTATAIRE_DPA = CHAMPS_DPA.filter((ch) => ch.groupe === 'prestataire').map((ch) => ch.cle);

export async function infosContratDpa(env: any, communeId: string) {
  const [commune] = await supabaseSelect(env, 'communes', { select: 'id,nom,population,telephone_mairie', id: `eq.${communeId}` });
  if (!commune) return null;
  const [lignesParam, [saisie], [maireCompte], [prospect], [convention]] = await Promise.all([
    supabaseSelect(env, 'parametres_facturation', { select: 'cle,valeur', cle: `in.(${[...new Set([...CLES_ENTREPRISE, ...CLES_PRESTATAIRE_DPA])].join(',')})` }),
    supabaseSelect(env, 'dpa_communes', { select: [...CLES_COMMUNE_DPA, 'texte_contrat', 'texte_annexes', 'texte_personnalise_le'].join(','), commune_id: `eq.${communeId}` }),
    supabaseSelect(env, 'users', { select: 'prenom,nom', commune_id: `eq.${communeId}`, role: 'eq.maire', compte_supprime_le: 'is.null', limit: '1' }),
    supabaseSelect(env, 'prospects', { select: 'nom_maire,maire_civilite,adresse,contact_telephone', commune_id: `eq.${communeId}`, limit: '1' }),
    supabaseSelect(env, 'conventions', {
      select: 'signataire_nom,signataire_qualite,siret_commune,deliberation_reference,deliberation_date',
      commune_id: `eq.${communeId}`, statut: 'neq.annulee', order: 'created_at.desc', limit: '1',
    }),
  ]);
  const param: Record<string, string> = Object.fromEntries(lignesParam.map((r: any) => [r.cle, r.valeur]));
  const dateFr = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  // nom_maire est déjà "Prénom Nom" formé (voir formaterNomMaire dans prospection.ts).
  const candidats: Record<string, [string | null | undefined, string][]> = {
    signataire_nom: [[convention?.signataire_nom, 'convention'], [maireCompte && `${maireCompte.prenom} ${maireCompte.nom}`, 'compte du maire'], [prospect?.nom_maire, 'annuaire']],
    signataire_qualite: [[convention?.signataire_qualite, 'convention'], ['maire', 'par défaut']],
    habilitation: [[convention?.deliberation_reference && `la délibération n° ${convention.deliberation_reference}`
      + (convention.deliberation_date ? ` du ${dateFr(convention.deliberation_date)}` : ''), 'convention']],
    siret_commune: [[convention?.siret_commune, 'convention']],
    adresse_mairie: [[prospect?.adresse, 'annuaire']],
    telephone_alerte: [[commune.telephone_mairie, 'fiche commune'], [prospect?.contact_telephone, 'annuaire']],
  };
  const champs = CHAMPS_DPA.map(({ cle, libelle, groupe }) => {
    const saisi = groupe === 'commune' ? saisie?.[cle] : param[cle];
    if (saisi) return { cle, libelle, groupe, valeur: saisi as string, source: null as string | null };
    const [valeur, source] = (candidats[cle] || []).find(([v]) => v) || ['', null];
    return { cle, libelle, groupe, valeur: valeur || '', source };
  });
  const infos: InfosDpa = {
    ...Object.fromEntries(champs.map((ch) => [ch.cle, ch.valeur])),
    entreprise_raison_sociale: param.entreprise_raison_sociale, entreprise_forme_juridique: param.entreprise_forme_juridique,
    entreprise_email: param.entreprise_email,
    maire_civilite: prospect?.nom_maire && champs.find((ch) => ch.cle === 'signataire_nom')!.valeur === prospect.nom_maire
      ? prospect.maire_civilite : undefined,
  };
  // Texte réécrit à la main pour cette commune (migration 121) : null = texte automatique.
  const textes = { contrat: saisie?.texte_contrat ?? null, annexes: saisie?.texte_annexes ?? null, le: saisie?.texte_personnalise_le ?? null };
  return { commune, champs, infos, textes };
}

// Le DPA d'une commune dont la convention est signée par le Prestataire est figé dans cette
// convention : son texte ne se modifie plus (comme la convention elle-même).
async function dpaFigeParConvention(env: any, communeId: string | undefined): Promise<boolean> {
  const signees = await supabaseSelect(env, 'conventions', {
    select: 'id', commune_id: `eq.${communeId}`, statut: 'neq.annulee', signature_prestataire_le: 'not.is.null', limit: '1',
  });
  return signees.length > 0;
}

app.get('/contrat-dpa/:communeId', async (c) => {
  const donnees = await infosContratDpa(c.env, c.req.param('communeId'));
  if (!donnees) return c.json({ erreur: 'Commune introuvable' }, 404);
  return c.json({
    html: genererContratDpaHtml(donnees.commune, donnees.infos, donnees.textes),
    commune_nom: donnees.commune.nom,
    texte_personnalise_le: donnees.textes.le,
    modifiable: !(await dpaFigeParConvention(c.env, c.req.param('communeId'))),
    champs: donnees.champs,
    manquants: donnees.champs.filter((ch) => !ch.valeur).length,
  });
});

// Saisie du panneau : champs envoyés seulement (les autres ne bougent pas) ; vide = effacé, et la
// source automatique reprend alors la main. Les champs « prestataire » valent pour toutes les communes.
const infosDpaSchema = z.object(
  Object.fromEntries(CHAMPS_DPA.map((ch) => [ch.cle, z.string().trim().max(300).optional()])) as Record<CleDpa, z.ZodOptional<z.ZodString>>,
).strict();

app.put('/contrat-dpa/:communeId', async (c) => {
  const communeId = c.req.param('communeId');
  const body = infosDpaSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: 'Données invalides.' }, 400);
  const d: Record<string, string | undefined> = { ...body.data };
  if (d.siret_commune) {
    d.siret_commune = d.siret_commune.replace(/\s/g, '');
    if (!/^\d{14}$/.test(d.siret_commune)) return c.json({ erreur: 'Le SIRET de la commune compte 14 chiffres.' }, 400);
  }
  if (d.dpa_plafond_responsabilite) {
    d.dpa_plafond_responsabilite = d.dpa_plafond_responsabilite.replace(/[\s€.]/g, '');
    if (!/^\d{1,9}$/.test(d.dpa_plafond_responsabilite)) return c.json({ erreur: 'Le plafond de responsabilité est un montant en euros, sans centimes.' }, 400);
  }
  if (d.dpa_assurance && !['titulaire', 'engagement'].includes(d.dpa_assurance)) return c.json({ erreur: 'Assurance : choix invalide.' }, 400);

  const [commune] = await supabaseSelect(c.env, 'communes', { select: 'id,nom', id: `eq.${communeId}` });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  const champsPrestataire = CLES_PRESTATAIRE_DPA.filter((cle) => d[cle] !== undefined);
  // Plafond, assurance, coordonnées de l'entreprise : réglages de Léandre (SOP §8), pas d'un
  // assistant — vérifié AVANT toute écriture, pour ne jamais enregistrer à moitié.
  if (champsPrestataire.length && await roleStaff(c) === 'assistant') {
    return c.json({ erreur: 'Les informations du prestataire sont réservées au compte administrateur.' }, 403);
  }

  const champsCommune = CLES_COMMUNE_DPA.filter((cle) => d[cle] !== undefined);
  if (champsCommune.length) {
    await supabaseUpsert(c.env, 'dpa_communes', [{
      commune_id: communeId, updated_at: new Date().toISOString(),
      ...Object.fromEntries(champsCommune.map((cle) => [cle, d[cle] || null])),
    }], 'commune_id');
  }
  if (champsPrestataire.length) {
    await supabaseUpsert(c.env, 'parametres_facturation', champsPrestataire.map((cle) => ({ cle, valeur: d[cle] })), 'cle');
  }
  await journaliser(c.env, c.get('staff_id'), 'contrat_dpa_infos', commune.nom);
  return c.json({ ok: true });
});

// PUT /contrat-dpa/:communeId/texte — texte du DPA réécrit à la main pour CETTE commune (2026-11-23,
// migration 121), comme la convention (conventions.ts, PUT /:id/texte). Chaque partie envoyée est
// remplacée (null = retour au texte automatique) ; une partie absente ne bouge pas. Réservé à
// l'administrateur, refusé une fois la convention de la commune signée par le Prestataire.
const texteDpaSchema = z.object({
  contrat: z.string().max(300000).nullable().optional(),
  annexes: z.string().max(300000).nullable().optional(),
}).strict();

app.put('/contrat-dpa/:communeId/texte', exigerAdmin, async (c) => {
  const communeId = c.req.param('communeId');
  const body = texteDpaSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: 'Données invalides.' }, 400);
  const [[commune], [actuel]] = await Promise.all([
    supabaseSelect(c.env, 'communes', { select: 'id,nom', id: `eq.${communeId}` }),
    supabaseSelect(c.env, 'dpa_communes', { select: 'texte_contrat,texte_annexes', commune_id: `eq.${communeId}` }),
  ]);
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
  if (await dpaFigeParConvention(c.env, communeId)) {
    return c.json({ erreur: 'DPA figé par votre signature de la convention : annulez-la d\'abord pour modifier son texte.' }, 409);
  }
  const nettoyer = (v: string | null | undefined, avant: string | null) => {
    if (v === undefined) return avant;
    if (v === null) return null;
    const t = nettoyerTexteDpa(v).trim();
    return t.replace(/<[^>]*>/g, '').trim() ? t : undefined;
  };
  const contrat = nettoyer(body.data.contrat, actuel?.texte_contrat ?? null);
  const annexes = nettoyer(body.data.annexes, actuel?.texte_annexes ?? null);
  if (contrat === undefined || annexes === undefined) return c.json({ erreur: 'Le texte du DPA est vide.' }, 400);
  const maintenant = new Date().toISOString();
  const le = contrat || annexes ? maintenant : null;
  await supabaseUpsert(c.env, 'dpa_communes', [{
    commune_id: communeId, texte_contrat: contrat, texte_annexes: annexes, texte_personnalise_le: le, updated_at: maintenant,
  }], 'commune_id');
  await journaliser(c.env, c.get('staff_id'), le ? 'contrat_dpa_texte_personnalise' : 'contrat_dpa_texte_automatique', commune.nom);
  return c.json({ ok: true, texte_personnalise_le: le });
});

// Numéro séquentiel SANS TROU par table et par année (ex. F-2026-0001) — obligation légale pour
// les factures (Code de commerce), reprise ici pour les devis par cohérence. Avoirs : A-2026-0001.
async function genererNumero(env: any, table: 'devis' | 'factures' | 'avoirs', prefixe: string): Promise<string> {
  const annee = new Date().getFullYear();
  const base = `${prefixe}-${annee}-`;
  const [dernier] = await supabaseSelect(env, table, {
    select: 'numero', numero: `like.${base}*`, order: 'numero.desc', limit: '1',
  });
  const n = dernier ? parseInt(dernier.numero.slice(base.length), 10) + 1 : 1;
  return base + String(n).padStart(4, '0');
}

// — Devis —
const devisSchema = z.object({
  commune_id: z.string().uuid().optional().nullable(),
  nom_destinataire: z.string().min(1).max(150),
  adresse_destinataire: z.string().max(300).optional().nullable(),
  objet: z.string().min(1).max(300),
  montant_ht: z.number().min(0),
  taux_tva: z.number().min(0).max(100).default(0),
  duree_engagement_mois: z.number().int().min(1).max(60).optional().nullable(),
  validite_jours: z.number().int().min(1).max(365).default(30),
  // Devis du bloc « 💶 Abonnement » (migration 114) : ce que « Activer et facturer » appliquera.
  formule: z.enum(['autonomie', 'accompagne']).optional().nullable(),
  fondatrice: z.boolean().optional(),
});

// sans_commune=1 : devis/factures "libres" (client hors commune, ex. prestation annexe à l'EI
// de Léandre — voir POST /devis, commune_id est optionnel/nullable exprès pour ce cas) — jamais
// combiné avec commune_id, l'un ou l'autre.
app.get('/devis', async (c) => {
  const communeId = c.req.query('commune_id');
  const filtres: Record<string, string> = { select: '*', order: 'created_at.desc', limit: '500' };
  if (c.req.query('sans_commune') === '1') filtres.commune_id = 'is.null';
  else if (communeId) filtres.commune_id = `eq.${communeId}`;
  const devis = await supabaseSelect(c.env, 'devis', filtres);
  return c.json({ devis });
});

app.get('/devis/:id', async (c) => {
  const [devis] = await supabaseSelect(c.env, 'devis', { select: '*', id: `eq.${c.req.param('id')}` });
  if (!devis) return c.json({ erreur: 'Devis introuvable' }, 404);
  return c.json({ devis });
});

app.post('/devis', async (c) => {
  const body = devisSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  // Devis sans commune = facturation libre (prestations hors Agora de l'EI de Léandre, SOP §7).
  if (!body.data.commune_id && await roleStaff(c) === 'assistant') {
    return c.json({ erreur: 'La facturation libre est réservée au compte administrateur.' }, 403);
  }
  const montant_ttc = Math.round(body.data.montant_ht * (1 + body.data.taux_tva / 100) * 100) / 100;
  const numero = await genererNumero(c.env, 'devis', 'D');
  const [devis] = await supabaseInsert(c.env, 'devis', { ...body.data, montant_ttc, numero });
  return c.json({ ok: true, devis }, 201);
});

const devisPatchSchema = z.object({
  statut: z.enum(STATUTS_DEVIS).optional(),
  bon_commande_recu_le: z.string().datetime().optional().nullable(),
  bon_commande_reference: z.string().max(150).optional().nullable(),
});

app.patch('/devis/:id', async (c) => {
  const body = devisPatchSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);
  if (Object.keys(body.data).length === 0) return c.json({ erreur: 'Aucun champ à mettre à jour' }, 400);
  const maj = await supabaseUpdate(c.env, 'devis', { ...body.data, updated_at: new Date().toISOString() }, { id: `eq.${c.req.param('id')}` });
  if (!maj.length) return c.json({ erreur: 'Devis introuvable' }, 404);
  return c.json({ ok: true, devis: maj[0] });
});

// POST /devis/:id/facturer — transforme un devis accepté (avec bon de commande reçu) en
// facture. Un devis ne peut donner lieu qu'à UNE seule facture (facture_id posé après coup).
app.post('/devis/:id/facturer', async (c) => {
  const id = c.req.param('id');
  const [devis] = await supabaseSelect(c.env, 'devis', { select: '*', id: `eq.${id}` });
  if (!devis) return c.json({ erreur: 'Devis introuvable' }, 404);
  if (devis.facture_id) return c.json({ erreur: 'Ce devis a déjà été facturé.' }, 400);
  if (devis.statut !== 'accepte') return c.json({ erreur: 'Le devis doit être marqué « accepté » avant facturation.' }, 400);
  if (!devis.bon_commande_recu_le) return c.json({ erreur: 'Le bon de commande n\'a pas encore été enregistré.' }, 400);
  const facture = await facturerDevis(c.env, devis);
  return c.json({ ok: true, facture }, 201);
});

// Émet la facture d'un devis (contrôles faits par l'appelant) et la relie au devis.
async function facturerDevis(env: any, devis: any) {
  const parametresDelai = await supabaseSelect(env, 'parametres_facturation', {
    select: 'valeur', cle: 'eq.entreprise_delai_paiement_jours',
  });
  const delaiJours = parseInt(parametresDelai[0]?.valeur || '30', 10) || 30;

  const numero = await genererNumero(env, 'factures', 'F');
  const dateEmission = new Date();
  const dateEcheance = new Date(dateEmission.getTime() + delaiJours * 24 * 3600 * 1000);

  const [facture] = await supabaseInsert(env, 'factures', {
    devis_id: devis.id,
    commune_id: devis.commune_id,
    nom_destinataire: devis.nom_destinataire,
    adresse_destinataire: devis.adresse_destinataire,
    objet: devis.objet,
    montant_ht: devis.montant_ht,
    taux_tva: devis.taux_tva,
    montant_ttc: devis.montant_ttc,
    duree_engagement_mois: devis.duree_engagement_mois,
    date_emission: dateEmission.toISOString().slice(0, 10),
    date_echeance: dateEcheance.toISOString().slice(0, 10),
    numero,
  });
  await supabaseUpdate(env, 'devis', { facture_id: facture.id, updated_at: new Date().toISOString() }, { id: `eq.${devis.id}` });
  return facture;
}

// POST /communes/:id/activer-abonnement — 3e geste du bloc « 💶 Abonnement » (2026-11-20) :
// applique ce que la mairie a commandé sur le devis (formule, commune fondatrice, prix) et émet
// la facture, en une fois. Remplace cinq réglages faits à la main ailleurs dans la fiche, dont
// l'oubli de la formule (pas de modération photo ni de bilan) et le bouton « Fondateur » qui
// effaçait prix et échéance d'une fondatrice pourtant payante.
// Échéance : celle déjà en place pour un renouvellement (la date anniversaire ne bouge pas),
// sinon aujourd'hui ; c'est le passage de la facture à « payée » qui l'avance de 12 mois. Le
// rappel automatique est marqué comme fait : la facture tient lieu de rappel pour ce cycle.
const activationSchema = z.object({ devis_id: z.string().uuid() });

app.post('/communes/:id/activer-abonnement', exigerAdmin, async (c) => {
  const communeId = c.req.param('id');
  const body = activationSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: body.error.flatten() }, 400);

  const [[devis], [commune]] = await Promise.all([
    supabaseSelect(c.env, 'devis', { select: '*', id: `eq.${body.data.devis_id}`, commune_id: `eq.${communeId}` }),
    supabaseSelect(c.env, 'communes', { select: 'id,nom,prochaine_echeance', id: `eq.${communeId}` }),
  ]);
  if (!commune || !devis) return c.json({ erreur: 'Devis introuvable pour cette commune.' }, 404);
  if (!devis.formule) return c.json({ erreur: 'Ce devis n\'a pas été créé depuis « Abonnement » : utilise « Facturer » dans la liste des devis.' }, 400);
  if (devis.facture_id) return c.json({ erreur: 'Ce devis a déjà été facturé.' }, 400);
  if (!devis.bon_commande_recu_le) return c.json({ erreur: 'Le bon de commande n\'a pas encore été enregistré.' }, 400);

  const maintenant = new Date().toISOString();
  await appliquerOngletsSurCommune(c.env, communeId, [...TOUS_LES_ONGLETS]);
  await supabaseUpdate(c.env, 'communes', {
    forfait: devis.fondatrice ? 'Fondateur' : 'Version complète',
    formule: devis.formule,
    prix_annuel_ttc: devis.montant_ttc,
    duree_engagement_mois: 12,
    prochaine_echeance: commune.prochaine_echeance || maintenant.slice(0, 10),
    derniere_relance_echeance_le: maintenant,
    statut_client: 'active',
  }, { id: `eq.${communeId}` });
  if (devis.statut !== 'accepte') {
    await supabaseUpdate(c.env, 'devis', { statut: 'accepte', updated_at: maintenant }, { id: `eq.${devis.id}` });
  }
  await clorerDemandesFormule(c.env, communeId);
  // Le prospect lié est gagné : il sort des « Appels du jour » et de toute relance.
  const prospectsGagnes = await supabaseUpdate(c.env, 'prospects',
    { statut: 'gagne', prochaine_relance_le: null, prochaine_relance_heure: null, updated_at: maintenant },
    { commune_id: `eq.${communeId}`, statut: 'neq.gagne' });
  if (prospectsGagnes.length) {
    await supabaseInsert(c.env, 'prospect_interactions', prospectsGagnes.map((p: any) => ({
      prospect_id: p.id, staff_id: c.get('staff_id'), type: 'statut', contenu: 'Statut : → gagne (abonnement activé)',
    })));
  }
  const facture = await facturerDevis(c.env, devis);
  await journaliser(c.env, c.get('staff_id'), 'abonnement_active',
    `${commune.nom} — ${devis.formule}${devis.fondatrice ? ', fondatrice' : ''} — ${devis.montant_ttc} € — facture ${facture.numero}`);
  return c.json({ ok: true, facture }, 201);
});

// — Factures —
// Sans commune_id ni sans_commune : TOUTES les factures (communes + libres confondues) — vue
// d'ensemble "Toutes les factures" du backoffice, voir frontend. nom_destinataire/objet sont
// dupliqués sur chaque ligne à la création (jamais recalculés depuis une commune), donc cette
// liste globale n'a besoin d'aucune jointure.
app.get('/factures', async (c) => {
  const communeId = c.req.query('commune_id');
  const filtres: Record<string, string> = { select: '*', order: 'created_at.desc', limit: '500' };
  if (c.req.query('sans_commune') === '1') filtres.commune_id = 'is.null';
  else if (communeId) filtres.commune_id = `eq.${communeId}`;
  const factures = await supabaseSelect(c.env, 'factures', filtres);
  return c.json({ factures: await avecAvoirs(c.env, factures) });
});

// GET /factures-export.csv — export de la vue "Toutes les factures" (mêmes colonnes que le
// tableau backoffice), pour la compta. Les avoirs y figurent aussi, en montants négatifs, avec
// la facture qu'ils corrigent dans l'objet.
app.get('/factures-export.csv', async (c) => {
  const [factures, avoirs] = await Promise.all([
    supabaseSelect(c.env, 'factures', {
      select: 'id,numero,nom_destinataire,objet,montant_ht,taux_tva,montant_ttc,date_emission,date_echeance,statut',
      order: 'created_at.desc', limit: '500',
    }),
    supabaseSelect(c.env, 'avoirs', { select: COLONNES_AVOIR, order: 'created_at.desc', limit: '500' }),
  ]);
  const numeroFacture = new Map(factures.map((f: any) => [f.id, f.numero]));
  const lignes = [
    ...factures.map((f: any) => ({ ...f, type: 'Facture' })),
    ...avoirs.map((a: any) => ({
      type: 'Avoir', numero: a.numero, nom_destinataire: a.nom_destinataire,
      objet: `Avoir sur ${numeroFacture.get(a.facture_id) ?? 'facture'} — ${a.motif}`,
      montant_ht: -Number(a.montant_ht), taux_tva: a.taux_tva, montant_ttc: -Number(a.montant_ttc),
      date_emission: a.date_emission, date_echeance: '', statut: a.statut,
    })),
  ].sort((x: any, y: any) => String(y.date_emission).localeCompare(String(x.date_emission)));
  const csv = versCsv(lignes, [
    { cle: 'type', titre: 'Type' },
    { cle: 'numero', titre: 'N°' }, { cle: 'nom_destinataire', titre: 'Destinataire' },
    { cle: 'objet', titre: 'Objet' }, { cle: 'montant_ht', titre: 'Montant HT' },
    { cle: 'taux_tva', titre: 'TVA %' }, { cle: 'montant_ttc', titre: 'Montant TTC' },
    { cle: 'date_emission', titre: 'Émise le' }, { cle: 'date_echeance', titre: 'Échéance' },
    { cle: 'statut', titre: 'Statut' },
  ]);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="factures-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});

app.get('/factures/:id', async (c) => {
  const [facture] = await supabaseSelect(c.env, 'factures', { select: '*', id: `eq.${c.req.param('id')}` });
  if (!facture) return c.json({ erreur: 'Facture introuvable' }, 404);
  const [avecSesAvoirs] = await avecAvoirs(c.env, [facture]);
  return c.json({ facture: avecSesAvoirs });
});

const facturePatchSchema = z.object({ statut: z.enum(STATUTS_FACTURE) });

app.patch('/factures/:id', async (c) => {
  const body = facturePatchSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Statut invalide' }, 400);
  const [actuelle] = await supabaseSelect(c.env, 'factures', { select: 'id,statut', id: `eq.${c.req.param('id')}` });
  if (!actuelle) return c.json({ erreur: 'Facture introuvable' }, 404);
  if (actuelle.statut === 'annulee') return c.json({ erreur: 'Facture annulée par avoir : son statut ne change plus.' }, 409);
  // Déjà payée : ne rien refaire (sinon l'échéance de la commune avancerait une deuxième fois).
  if (actuelle.statut === body.data.statut) return c.json({ ok: true, facture: actuelle });
  const patch: Record<string, unknown> = { statut: body.data.statut };
  if (body.data.statut === 'deposee_chorus') patch.deposee_chorus_le = new Date().toISOString();
  if (body.data.statut === 'payee') patch.payee_le = new Date().toISOString();
  const maj = await supabaseUpdate(c.env, 'factures', patch, { id: `eq.${c.req.param('id')}` });
  if (!maj.length) return c.json({ erreur: 'Facture introuvable' }, 404);
  if (body.data.statut === 'payee') {
    await journaliser(c.env, c.get('staff_id'), 'facture_payee', `${maj[0].numero} — ${maj[0].montant_ttc} € TTC`);
    // Sans ça, payer via le circuit devis -> facture ne fait jamais bouger l'échéance de la
    // commune : elle reste indéfiniment "en retard" (badge santé, "Facturation à traiter")
    // malgré le paiement (bug constaté le 2026-08-18 — les deux façons de "marquer payé", ici
    // et via le bouton dédié sur l'onglet Abonnement, ne se synchronisaient pas).
    if (maj[0].commune_id) {
      const [commune] = await supabaseSelect(c.env, 'communes', {
        select: 'prochaine_echeance', id: `eq.${maj[0].commune_id}`,
      });
      const base = commune?.prochaine_echeance ? new Date(commune.prochaine_echeance) : new Date();
      base.setMonth(base.getMonth() + (maj[0].duree_engagement_mois || 12));
      await supabaseUpdate(c.env, 'communes', {
        prochaine_echeance: base.toISOString().slice(0, 10), derniere_relance_echeance_le: null,
      }, { id: `eq.${maj[0].commune_id}` });
    }
  }
  return c.json({ ok: true, facture: maj[0] });
});

// — Avoirs (2026-11-22, migration 118) —
// POST /factures/:id/avoirs — annule tout ou partie d'une facture émise. montant_ttc absent = tout
// ce qui reste dû. Une facture entièrement couverte passe « annulee ». Facture déjà payée puis
// entièrement annulée : reculer_echeance défait l'avance d'échéance qu'avait faite le paiement.
// Réservé à l'administrateur (document comptable).
const avoirSchema = z.object({
  montant_ttc: z.number().positive().max(1_000_000).optional(),
  motif: z.string().trim().min(3, 'Indique le motif de l\'avoir.').max(500),
  reculer_echeance: z.boolean().optional(),
}).strict();

app.post('/factures/:id/avoirs', exigerAdmin, async (c) => {
  const body = avoirSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: body.error.issues[0]?.message ?? 'Données invalides' }, 400);
  const [facture] = await supabaseSelect(c.env, 'factures', {
    select: 'id,numero,commune_id,nom_destinataire,adresse_destinataire,montant_ttc,taux_tva,statut,payee_le,duree_engagement_mois',
    id: `eq.${c.req.param('id')}`,
  });
  if (!facture) return c.json({ erreur: 'Facture introuvable' }, 404);
  if (facture.statut === 'annulee') return c.json({ erreur: 'Cette facture est déjà entièrement annulée.' }, 400);

  const [{ avoirs: deja, reste_ttc: reste }] = await avecAvoirs(c.env, [facture]);
  if (reste <= 0) return c.json({ erreur: 'Cette facture est déjà entièrement couverte par des avoirs.' }, 400);
  const montant = body.data.montant_ttc === undefined ? reste : arrondi(body.data.montant_ttc);
  if (montant <= 0 || montant > reste) {
    return c.json({ erreur: `L'avoir ne peut pas dépasser ce qui reste de la facture : ${reste.toLocaleString('fr-FR')} €.` }, 400);
  }
  const solde = montant === reste;
  const taux = Number(facture.taux_tva) || 0;
  const reculer = !!body.data.reculer_echeance && solde && !!facture.payee_le && !!facture.commune_id;
  const maintenant = new Date().toISOString();

  const [avoir] = await supabaseInsert(c.env, 'avoirs', {
    numero: await genererNumero(c.env, 'avoirs', 'A'),
    facture_id: facture.id, commune_id: facture.commune_id,
    nom_destinataire: facture.nom_destinataire, adresse_destinataire: facture.adresse_destinataire,
    motif: body.data.motif, type: !deja.length && solde ? 'total' : 'partiel',
    montant_ht: arrondi(montant / (1 + taux / 100)), taux_tva: taux, montant_ttc: montant,
    date_emission: maintenant.slice(0, 10), echeance_reculee: reculer, cree_par: c.get('staff_id') ?? null,
  });
  if (solde) await supabaseUpdate(c.env, 'factures', { statut: 'annulee', annulee_le: maintenant }, { id: `eq.${facture.id}` });
  if (reculer) {
    const [commune] = await supabaseSelect(c.env, 'communes', { select: 'prochaine_echeance', id: `eq.${facture.commune_id}` });
    if (commune?.prochaine_echeance) {
      const date = new Date(`${commune.prochaine_echeance}T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() - (facture.duree_engagement_mois || 12));
      await supabaseUpdate(c.env, 'communes', { prochaine_echeance: date.toISOString().slice(0, 10) }, { id: `eq.${facture.commune_id}` });
    }
  }
  await journaliser(c.env, c.get('staff_id'), 'avoir_emis',
    `${avoir.numero} sur ${facture.numero} — ${montant} € TTC${solde ? ' (facture annulée)' : ''} — ${body.data.motif}`);
  return c.json({ ok: true, avoir, facture_annulee: solde, echeance_reculee: reculer }, 201);
});

// GET /avoirs/:id — pour le PDF : l'avoir et la facture qu'il corrige (numéro, date, montant).
app.get('/avoirs/:id', async (c) => {
  const [avoir] = await supabaseSelect(c.env, 'avoirs', { select: COLONNES_AVOIR, id: `eq.${c.req.param('id')}` });
  if (!avoir) return c.json({ erreur: 'Avoir introuvable' }, 404);
  const [facture] = await supabaseSelect(c.env, 'factures', {
    select: 'id,numero,objet,date_emission,montant_ttc,statut,payee_le,deposee_chorus_le', id: `eq.${avoir.facture_id}`,
  });
  const [avecSesAvoirs] = facture ? await avecAvoirs(c.env, [facture]) : [null];
  return c.json({ avoir: { ...avoir, facture: avecSesAvoirs ? { ...avecSesAvoirs, avoirs: undefined } : null } });
});

// PATCH /avoirs/:id — suivi : déposé sur Chorus Pro, puis remboursé (seulement si la facture
// d'origine avait été payée : sinon l'avoir réduit simplement ce qui reste à payer).
const avoirPatchSchema = z.object({ statut: z.enum(STATUTS_AVOIR) }).strict();

app.patch('/avoirs/:id', async (c) => {
  const body = avoirPatchSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ erreur: 'Statut invalide' }, 400);
  const [avoir] = await supabaseSelect(c.env, 'avoirs', { select: 'id,numero,facture_id,statut', id: `eq.${c.req.param('id')}` });
  if (!avoir) return c.json({ erreur: 'Avoir introuvable' }, 404);
  if (body.data.statut === 'rembourse') {
    const [facture] = await supabaseSelect(c.env, 'factures', { select: 'payee_le', id: `eq.${avoir.facture_id}` });
    if (!facture?.payee_le) return c.json({ erreur: 'La facture n\'a pas été payée : rien à rembourser, l\'avoir réduit ce qui reste dû.' }, 400);
  }
  const patch: Record<string, unknown> = { statut: body.data.statut };
  if (body.data.statut === 'depose_chorus') patch.deposee_chorus_le = new Date().toISOString();
  if (body.data.statut === 'rembourse') patch.rembourse_le = new Date().toISOString();
  const [maj] = await supabaseUpdate(c.env, 'avoirs', patch, { id: `eq.${avoir.id}` });
  if (body.data.statut === 'rembourse') await journaliser(c.env, c.get('staff_id'), 'avoir_rembourse', avoir.numero);
  return c.json({ ok: true, avoir: maj });
});

export default app;
