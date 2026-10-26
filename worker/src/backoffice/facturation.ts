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
import { backofficeMiddleware } from '../middleware/backoffice';
import { versCsv } from '../lib/csv';
import { genererContratDpaHtml, CHAMPS_DPA, type CleDpa, type InfosDpa } from './contrat-dpa';

const app = new Hono();
app.use('*', backofficeMiddleware);

const STATUTS_DEVIS = ['envoye', 'accepte', 'refuse', 'expire'] as const;
const STATUTS_FACTURE = ['emise', 'deposee_chorus', 'payee'] as const;

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

app.put('/parametres-entreprise', async (c) => {
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

async function infosContratDpa(env: any, communeId: string) {
  const [commune] = await supabaseSelect(env, 'communes', { select: 'id,nom,population,telephone_mairie', id: `eq.${communeId}` });
  if (!commune) return null;
  const [lignesParam, [saisie], [maireCompte], [prospect], [convention]] = await Promise.all([
    supabaseSelect(env, 'parametres_facturation', { select: 'cle,valeur', cle: `in.(${[...new Set([...CLES_ENTREPRISE, ...CLES_PRESTATAIRE_DPA])].join(',')})` }),
    supabaseSelect(env, 'dpa_communes', { select: CLES_COMMUNE_DPA.join(','), commune_id: `eq.${communeId}` }),
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
  return { commune, champs, infos };
}

app.get('/contrat-dpa/:communeId', async (c) => {
  const donnees = await infosContratDpa(c.env, c.req.param('communeId'));
  if (!donnees) return c.json({ erreur: 'Commune introuvable' }, 404);
  return c.json({
    html: genererContratDpaHtml(donnees.commune, donnees.infos),
    commune_nom: donnees.commune.nom,
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

  const champsCommune = CLES_COMMUNE_DPA.filter((cle) => d[cle] !== undefined);
  if (champsCommune.length) {
    await supabaseUpsert(c.env, 'dpa_communes', [{
      commune_id: communeId, updated_at: new Date().toISOString(),
      ...Object.fromEntries(champsCommune.map((cle) => [cle, d[cle] || null])),
    }], 'commune_id');
  }
  const champsPrestataire = CLES_PRESTATAIRE_DPA.filter((cle) => d[cle] !== undefined);
  if (champsPrestataire.length) {
    await supabaseUpsert(c.env, 'parametres_facturation', champsPrestataire.map((cle) => ({ cle, valeur: d[cle] })), 'cle');
  }
  await journaliser(c.env, c.get('staff_id'), 'contrat_dpa_infos', commune.nom);
  return c.json({ ok: true });
});

// Numéro séquentiel SANS TROU par table et par année (ex. F-2026-0001) — obligation légale pour
// les factures (Code de commerce), reprise ici pour les devis par cohérence.
async function genererNumero(env: any, table: 'devis' | 'factures', prefixe: string): Promise<string> {
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

  const parametresDelai = await supabaseSelect(c.env, 'parametres_facturation', {
    select: 'valeur', cle: 'eq.entreprise_delai_paiement_jours',
  });
  const delaiJours = parseInt(parametresDelai[0]?.valeur || '30', 10) || 30;

  const numero = await genererNumero(c.env, 'factures', 'F');
  const dateEmission = new Date();
  const dateEcheance = new Date(dateEmission.getTime() + delaiJours * 24 * 3600 * 1000);

  const [facture] = await supabaseInsert(c.env, 'factures', {
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
  await supabaseUpdate(c.env, 'devis', { facture_id: facture.id, updated_at: new Date().toISOString() }, { id: `eq.${id}` });
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
  return c.json({ factures });
});

// GET /factures-export.csv — export de la vue "Toutes les factures" (mêmes colonnes que le
// tableau backoffice), pour la compta.
app.get('/factures-export.csv', async (c) => {
  const factures = await supabaseSelect(c.env, 'factures', {
    select: 'numero,nom_destinataire,objet,montant_ht,taux_tva,montant_ttc,date_emission,date_echeance,statut',
    order: 'created_at.desc', limit: '500',
  });
  const csv = versCsv(factures, [
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
  return c.json({ facture });
});

const facturePatchSchema = z.object({ statut: z.enum(STATUTS_FACTURE) });

app.patch('/factures/:id', async (c) => {
  const body = facturePatchSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ erreur: 'Statut invalide' }, 400);
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

export default app;
