// worker/src/backoffice/preuves-cgu.ts
// Attestation d'acceptation des CGU et de l'accord de sous-traitance RGPD (art. 28, article 10
// des CGU) d'une commune, en un clic depuis la fiche commune (onglet Dossier) — à produire en cas
// de contrôle CNIL ou de litige. Lecture seule : le journal n'est jamais modifié depuis ici.
// Rendu : frontend/backoffice/js/document.js (?type=preuve-cgu). Données : lib/cgu.ts, migration 108.
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseSelectTout, supabaseCount, supabaseInsert, journaliser } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { VERSION_CGU } from '../lib/cgu';
import { hasherSha256Hex } from '../lib/hash';
import { envoyerEmail } from '../lib/email';

const app = new Hono();
app.use('*', backofficeMiddleware);

const idSchema = z.string().uuid();

// Registre des activités de traitement de l'éditeur (article 30 du RGPD ; guide CNIL des
// collectivités 2026, p. 29 : « le sous-traitant doit tenir un registre »). Partie fixe rendue par
// document.js (?type=registre-rgpd) ; ici seulement ce qui bouge : coordonnées de l'éditeur
// (Réglages) et liste des communes pour le compte desquelles il agit (espaces officiels).
// Déclaré AVANT /:communeId, sinon « registre » serait pris pour un identifiant.
app.get('/registre', async (c) => {
  try {
    const [parametres, communes, nbEspacesCitoyens] = await Promise.all([
      supabaseSelect(c.env, 'parametres_facturation', {
        select: 'cle,valeur', cle: 'in.(entreprise_adresse,entreprise_cp_ville,entreprise_email,entreprise_telephone,entreprise_siret)',
      }),
      supabaseSelectTout(c.env, 'communes', {
        select: 'id,nom,departement,dpa_communes(dpo)', espace_officiel: 'eq.true', niveau_national: 'not.is.true', order: 'nom.asc',
      }),
      supabaseCount(c.env, 'communes', { espace_officiel: 'eq.false', niveau_national: 'not.is.true' }),
    ]);
    return c.json({
      editeur: Object.fromEntries(parametres.map((p: any) => [p.cle, p.valeur])),
      communes: communes.map((cm: any) => ({
        nom: cm.nom, departement: cm.departement,
        dpo: (Array.isArray(cm.dpa_communes) ? cm.dpa_communes[0]?.dpo : cm.dpa_communes?.dpo) || null,
      })),
      nb_espaces_citoyens: nbEspacesCitoyens,
    });
  } catch (e) {
    console.error('Registre RGPD', e);
    return c.json({ erreur: 'Impossible de charger le registre.' }, 500);
  }
});

// POST /:communeId/demander-accord-maire — envoie au maire, à l'adresse de la mairie, un lien
// personnel pour donner l'accord de la commune sans compte (routes/accord-maire.ts, migration 109).
// Toujours déclenché à la main par le staff (jamais automatique). Un nouvel envoi crée un nouveau
// lien ; les précédents restent valables jusqu'à leur expiration ou leur utilisation.
const demandeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200).optional() }).strict();

app.post('/:communeId/demander-accord-maire', async (c) => {
  const communeId = idSchema.safeParse(c.req.param('communeId'));
  if (!communeId.success) return c.json({ erreur: 'Commune invalide' }, 400);
  const body = demandeSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ erreur: 'Adresse email invalide.' }, 400);
  try {
    const [[commune], [maireCompte], [prospect], [convention]] = await Promise.all([
      supabaseSelect(c.env, 'communes', { select: 'id,nom,email_mairie,contact_email', id: `eq.${communeId.data}` }),
      supabaseSelect(c.env, 'users', { select: 'prenom,nom', commune_id: `eq.${communeId.data}`, role: 'eq.maire', compte_supprime_le: 'is.null', limit: '1' }),
      supabaseSelect(c.env, 'prospects', { select: 'nom_maire,maire_civilite', commune_id: `eq.${communeId.data}`, limit: '1' }),
      supabaseSelect(c.env, 'conventions', { select: 'signataire_nom', commune_id: `eq.${communeId.data}`, statut: 'neq.annulee', order: 'created_at.desc', limit: '1' }),
    ]);
    if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);
    const destinataire = body.data.email || commune.email_mairie || commune.contact_email;
    if (!destinataire) return c.json({ erreur: 'Aucune adresse email de mairie connue : indiquez-en une.' }, 400);

    const nomMaire = (maireCompte && `${maireCompte.prenom} ${maireCompte.nom}`.trim()) || convention?.signataire_nom || prospect?.nom_maire || null;
    const salutation = prospect?.maire_civilite === 'Madame' ? 'Madame la Maire' : prospect?.maire_civilite === 'Monsieur' ? 'Monsieur le Maire' : 'Madame, Monsieur le Maire';
    const token = crypto.randomUUID() + crypto.randomUUID();
    await supabaseInsert(c.env, 'demandes_accord_maire', {
      commune_id: commune.id, token_hash: await hasherSha256Hex(token), envoye_a: destinataire, nom_maire: nomMaire,
      staff_id: c.get('staff_id') ?? null, expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    });
    const lien = `${c.env.FRONTEND_URL || 'https://plateforme-agora.fr'}/api/accord-maire/${token}`;
    const id = await envoyerEmail(c.env, destinataire, `Commune de ${commune.nom} : votre accord en un clic (protection des données)`, `
      <p>${salutation},</p>
      <p>Votre commune utilise Plateforme-Agora. Comme le prévoit le RGPD, même quand le service est gratuit, la commune
        doit donner son accord sur la protection des données de ses habitants.</p>
      <p>Cela prend dix secondes, sans compte ni mot de passe :</p>
      <p><a href="${lien}" style="display:inline-block;background:#2c5f2d;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">Donner l'accord de la commune</a></p>
      <p style="color:#5b6b5c;font-size:13px">Lien personnel, valable 30 jours. Si vous n'êtes pas le maire, merci de lui transférer ce message.</p>
      <p>Léandre Sallé, entrepreneur individuel, éditeur de Plateforme-Agora<br>contact@plateforme-agora.fr</p>`);
    if (!id) return c.json({ erreur: "L'email n'a pas pu partir (quota d'envoi ou adresse refusée). Réessayez plus tard." }, 502);
    await journaliser(c.env, c.get('staff_id'), 'accord_maire_demande', `${commune.nom} → ${destinataire}`);
    return c.json({ ok: true, envoye_a: destinataire });
  } catch (e) {
    console.error('Demande accord maire', e);
    return c.json({ erreur: "Impossible d'envoyer la demande." }, 500);
  }
});

app.get('/:communeId', async (c) => {
  const communeId = idSchema.safeParse(c.req.param('communeId'));
  if (!communeId.success) return c.json({ erreur: 'Commune invalide' }, 400);
  try {
    const [commune] = await supabaseSelect(c.env, 'communes', {
      select: 'id,nom,slug,espace_officiel', id: `eq.${communeId.data}`,
    });
    if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

    const acceptations = await supabaseSelect(c.env, 'acceptations_cgu', {
      select: 'id,version,empreinte_sha256,nom_affiche,email,role,canal,ip,user_agent,accuse_envoye_a,accuse_email_id,created_at',
      commune_id: `eq.${commune.id}`, order: 'created_at.asc',
    });
    const empreintes = [...new Set(acceptations.map((a: any) => a.empreinte_sha256).filter(Boolean))];
    const versions = empreintes.length
      ? await supabaseSelect(c.env, 'versions_cgu', {
          select: 'empreinte_sha256,version,texte_html,url_source,created_at',
          empreinte_sha256: `in.(${empreintes.join(',')})`,
        })
      : [];
    return c.json({ commune, acceptations, versions, version_en_vigueur: VERSION_CGU });
  } catch (e) {
    console.error('Preuve CGU', e);
    return c.json({ erreur: 'Impossible de charger le journal des acceptations.' }, 500);
  }
});

export default app;
