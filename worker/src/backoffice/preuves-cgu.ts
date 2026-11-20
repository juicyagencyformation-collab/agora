// worker/src/backoffice/preuves-cgu.ts
// Attestation d'acceptation des CGU et de l'accord de sous-traitance RGPD (art. 28, article 10
// des CGU) d'une commune, en un clic depuis la fiche commune (onglet Dossier) — à produire en cas
// de contrôle CNIL ou de litige. Lecture seule : le journal n'est jamais modifié depuis ici.
// Rendu : frontend/backoffice/js/document.js (?type=preuve-cgu). Données : lib/cgu.ts, migration 108.
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseSelect, supabaseSelectTout, supabaseCount } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';
import { VERSION_CGU } from '../lib/cgu';

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

app.get('/:communeId', async (c) => {
  const communeId = idSchema.safeParse(c.req.param('communeId'));
  if (!communeId.success) return c.json({ erreur: 'Commune invalide' }, 400);
  try {
    const [commune] = await supabaseSelect(c.env, 'communes', {
      select: 'id,nom,slug,espace_officiel', id: `eq.${communeId.data}`,
    });
    if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

    const acceptations = await supabaseSelect(c.env, 'acceptations_cgu', {
      select: 'id,version,empreinte_sha256,nom_affiche,email,role,ip,user_agent,accuse_envoye_a,accuse_email_id,created_at',
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
