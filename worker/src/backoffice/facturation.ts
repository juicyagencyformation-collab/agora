// worker/src/backoffice/facturation.ts
// Devis -> bon de commande -> facture, pour la vente de la version complète aux communes.
// Génère des PDF conformes (impression navigateur, comme la fiche de présentation) — l'envoi
// effectif d'une facture à une commune (administration publique) doit ensuite passer par
// Chorus Pro, obligatoire depuis 2020 pour toute facture à destination du secteur public.
// Décision prise avec Léandre le 2026-08-17 : pas d'intégration API Chorus Pro, dépôt manuel du
// PDF généré ici. Toutes les routes sont derrière backofficeMiddleware (données financières).
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseInsert, supabaseUpdate, journaliser } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';

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

app.get('/devis', async (c) => {
  const communeId = c.req.query('commune_id');
  const filtres: Record<string, string> = { select: '*', order: 'created_at.desc', limit: '500' };
  if (communeId) filtres.commune_id = `eq.${communeId}`;
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
    date_emission: dateEmission.toISOString().slice(0, 10),
    date_echeance: dateEcheance.toISOString().slice(0, 10),
    numero,
  });
  await supabaseUpdate(c.env, 'devis', { facture_id: facture.id, updated_at: new Date().toISOString() }, { id: `eq.${id}` });
  return c.json({ ok: true, facture }, 201);
});

// — Factures —
app.get('/factures', async (c) => {
  const communeId = c.req.query('commune_id');
  const filtres: Record<string, string> = { select: '*', order: 'created_at.desc', limit: '500' };
  if (communeId) filtres.commune_id = `eq.${communeId}`;
  const factures = await supabaseSelect(c.env, 'factures', filtres);
  return c.json({ factures });
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
  }
  return c.json({ ok: true, facture: maj[0] });
});

export default app;
