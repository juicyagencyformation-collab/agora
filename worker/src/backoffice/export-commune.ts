// worker/src/backoffice/export-commune.ts
// Restitution des données d'une commune (DPA article 15.1, convention article 5 « export sur
// demande ») : un fichier JSON avec tout ce que la commune a confié à la plateforme en tant que
// responsable du traitement. Colonnes listées UNE PAR UNE (jamais select=*) : une colonne ajoutée
// plus tard n'est exportée que si on l'ajoute ici, donc jamais un secret par accident.
// Inventaire fait le 2026-10-26 sur les 74 tables ayant commune_id : toute nouvelle table liée à
// une commune doit être ajoutée à TABLES ou à NON_INCLUS ci-dessous.
import { Hono } from 'hono';
import { supabaseSelect, supabaseSelectTout, journaliser } from '../db';
import { backofficeMiddleware } from '../middleware/backoffice';

const app = new Hono();
app.use('*', backofficeMiddleware);

const COLONNES_COMMUNE = 'id,slug,nom,population,departement,lat,lng,couleur_theme,couleur_accent,logo_url,horaires_ouverture,permanences,'
  + 'telephone_mairie,email_mairie,contact_email,prochain_conseil_date,partage_regional,photo_jour_seuil_validations,'
  + 'photo_jour_max_par_jour,photo_jour_duree,rayon_validation_enigme,enigme_duree,mur_duree,created_at';

export const TABLES: Record<string, string> = {
  users: 'id,nom,prenom,email,role,affichage_nom,avatar_url,photo_profil_url,banniere_url,created_at,consentement_rgpd_le,'
    + 'cgu_sous_traitance_acceptee_le,compte_supprime_le,bloque_le,bloque_motif,suspendu_jusqu_au,personne_id,xp,niveau,'
    + 'streak_actuel,streak_record,derniere_connexion_streak,validations_donnees,signalements_confirmes,enigmes_trouvees,'
    + 'etapes_chasse_validees,chasses_terminees,streak_exploration_actuel,streak_exploration_record,derniere_action_exploration,'
    + 'articles_lus,evenements_crees,evenements_reussis,score_citoyen,streak_participation_actuel,streak_participation_record,'
    + 'streak_mensuel_citoyen_actuel,dernier_mois_action_citoyenne,notif_articles,notif_chasses,notif_enigmes,notif_mur,'
    + 'notif_thermo,notif_agenda,notif_entraide,notif_meteo,notif_signalements,notif_vigilance',
  onglets_config: 'id,cle,actif,created_at',
  dechets_config: 'id,type,jour_semaine,frequence,couleur,created_at',
  dechets_exceptions: 'id,date,libelle,couleur,created_at',
  conseil_membres: 'id,nom,prenom,fonction,profession,contact,photo_url,ordre,created_at',
  messages_mairie: 'id,auteur_id,texte,fin_le,created_at',
  articles: 'id,auteur_id,section,titre,contenu_html,categorie,fichier_pv_url,fichier_pv_type,archive,created_at,updated_at',
  article_images: 'id,article_id,url,ordre,created_at',
  article_sondages: 'id,article_id,question,multi_choix,closes_at,created_at',
  article_sondage_choix: 'id,sondage_id,label,ordre',
  article_sondage_votes: 'id,sondage_id,choix_id,user_id,created_at',
  articles_lus_par_utilisateur: 'id,article_id,user_id,created_at',
  sondages: 'id,user_id,question,type,closes_at,created_at',
  choix_sondage: 'id,sondage_id,label,ordre',
  votes: 'id,sondage_id,choix_id,user_id,created_at',
  alertes: 'id,user_id,titre,description,lat,lng,statut,urgent,reponse_officielle,reponse_par,reponse_le,archive,created_at',
  alerte_images: 'id,alerte_id,url,ordre,created_at',
  alerte_soutiens: 'id,alerte_id,user_id,created_at',
  alertes_meteo: 'id,type,niveau,debut,fin,origine,created_at',
  posts: 'id,user_id,contenu,photo_url,statut,created_at',
  comments: 'id,post_id,user_id,contenu,created_at',
  reactions: 'id,post_id,user_id,type,created_at',
  mur_signalements: 'id,post_id,user_id,created_at',
  coups_de_main: 'id,user_id,type,titre,description,categorie,contact,prix,disponibilites,pourvu,photo_url,expires_at,created_at',
  coups_de_main_interets: 'id,annonce_id,user_id,message,created_at',
  events: 'id,user_id,titre,description,lieu,lat,lng,date_debut,date_fin,photo_url,officiel,type_action,necessite_validation_presence,'
    + 'seuil_succes_atteint,partage_autour,created_at',
  event_attendees: 'id,event_id,user_id,actif,contact_telephone,contact_email,created_at',
  participations_citoyennes: 'id,event_id,user_id,statut,scan_le,scan_lat,scan_lng,hors_geofence,valide_par,valide_le,contestee_le,'
    + 'points_attribues,created_at',
  points_citoyens_history: 'id,user_id,event_id,alerte_id,type_mouvement,type_action,montant,raison,valide_par,created_at',
  paliers_citoyens: 'id,seuil,nom,ordre,created_at',
  badges_citoyens: 'id,cle,nom,description,type,declencheur,valeur_seuil,visuel_url,actif,ordre,cree_par,created_at',
  user_badges_citoyens: 'id,user_id,badge_id,debloque_le',
  badges_obtenus: 'id,user_id,cle_badge,obtenu_at',
  chasses_tresor: 'id,user_id,titre,description,actif,mode,rayon_metres,created_at',
  etapes_chasse: 'id,chasse_id,ordre,titre,indice,lat,lng,type_contenu,contenu,photo_url,enigme_reponse,created_at',
  progressions_chasse: 'id,chasse_id,etape_id,user_id,validee_at',
  photos_enigmes: 'id,user_id,url,lat,lng,indice,statut,created_at',
  enigme_reussites: 'id,enigme_id,user_id,distance_metres,created_at',
  enigme_signalements: 'id,enigme_id,user_id,created_at',
  photos_du_jour: 'id,user_id,url,legende,date_publication,statut,libre_de_droit,force_deflout,created_at',
  photo_jour_publications: 'id,user_id,date_publication,created_at',
  photo_likes: 'id,photo_id,user_id,created_at',
  photo_validations: 'id,photo_id,user_id,created_at',
  photo_signalements: 'id,photo_id,user_id,created_at',
  souvenirs: 'id,user_id,titre,recit,theme,audio_url,statut,personne_nom,personne_date_naissance,personne_date_deces,created_at',
  souvenir_images: 'id,souvenir_id,url,ordre,created_at',
  souvenir_signalements: 'id,souvenir_id,user_id,created_at',
  annuaire: 'id,user_id,nom,categorie,description,telephone,email,site_web,logo_url,created_at',
  annuaire_documents: 'id,fiche_id,url,type,nom_original,ordre,created_at',
  bulletin_municipal: 'id,auteur_id,titre,contenu_html,statut,publie_at,created_at',
  bulletin_propositions: 'id,bulletin_id,auteur_id,titre,contenu_html,created_at',
  bulletin_proposition_soutiens: 'id,proposition_id,user_id,created_at',
  bulletin_rubriques: 'id,auteur_id,nom_auteur,titre,contenu_html,statut,created_at',
  lois_commentaires: 'id,loi_id,user_id,contenu,masque,created_at',
  lois_votes: 'id,loi_id,user_id,position,created_at',
  lois_lues_par_utilisateur: 'id,loi_id,user_id,created_at',
  lois_signalements: 'id,commentaire_id,user_id,created_at',
  avis_application: 'id,user_id,note,commentaire,created_at,updated_at',
  connexions_journalieres: 'id,user_id,jour,created_at',
  exports_rgpd_donnees: 'id,user_id,created_at',
};

export const NON_INCLUS: Record<string, string> = {
  'secrets de sécurité': 'mots de passe chiffrés, jetons de connexion et de réinitialisation (login_tokens, password_reset_tokens, '
    + 'refresh_tokens, activations_libres), abonnements aux notifications (push_subscriptions), codes des QR de validation',
  'journaux de sécurité': 'tentatives de connexion (tentatives_connexion), conservées brièvement pour la protection des comptes',
  'données commerciales du Prestataire': 'prospection, devis, factures, convention, prix, forfait et suivi des relances '
    + '(prospects, devis, factures, conventions, churn_events, sequence_emails_sent, activation_events, annonces_plateforme_lues)',
  'clés de stockage internes': "identifiants techniques des fichiers ; l'adresse publique de chaque fichier est incluse",
};

app.get('/:communeId', async (c) => {
  const communeId = c.req.param('communeId');
  const [commune] = await supabaseSelect(c.env, 'communes', { select: COLONNES_COMMUNE, id: `eq.${communeId}` });
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  const tables: Record<string, any[]> = {};
  const entrees = Object.entries(TABLES);
  for (let i = 0; i < entrees.length; i += 8) {
    await Promise.all(entrees.slice(i, i + 8).map(async ([table, colonnes]) => {
      tables[table] = await supabaseSelectTout(c.env, table, { select: colonnes, commune_id: `eq.${communeId}`, order: 'id.asc' });
    }));
  }
  const nombreLignes = Object.fromEntries(Object.entries(tables).map(([t, l]) => [t, l.length]));
  const total = Object.values(nombreLignes).reduce((a, b) => a + b, 0);
  const aujourdhui = new Date().toISOString().slice(0, 10);

  await journaliser(c.env, c.get('staff_id'), 'export_donnees_commune', `${commune.nom} — ${total} ligne(s)`);
  const contenu = {
    format: 'Plateforme-Agora — restitution des données de la commune',
    version: 1,
    genere_le: new Date().toISOString(),
    commune,
    note: "Données traitées par Plateforme-Agora pour le compte de la commune (responsable du traitement). Les photos, "
      + "documents et enregistrements audio sont désignés par leur adresse : ils restent téléchargeables à ces adresses "
      + 'tant que les données ne sont pas supprimées. Les identifiants (user_id, auteur_id…) renvoient à la table users.',
    non_inclus: NON_INCLUS,
    nombre_lignes: nombreLignes,
    tables,
  };
  return new Response(JSON.stringify(contenu, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="donnees-${commune.slug}-${aujourdhui}.json"`,
    },
  });
});

export default app;
