// worker/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { tenantMiddleware } from './middleware/tenant';
import { jwtMiddleware } from './middleware/jwt';
import { requireOngletActif } from './middleware/onglet';
import { nettoyerCoupsDeMainExpires, purgerPhotosDuJour, purgerEnigmes, purgerMur, cloturerActionsCiviques, purgerOrphelinsMemoire, relancerEcheancesFacturation, corrigerEmailsProspectsInvalides, verifierVariantesProspection, verifierRelancesInactiviteProspection, verifierSequenceOnboardingCommunes, synchroniserEmailsRecusProspection } from './cron';
import { synchroniserVigilanceMeteoFrance } from './lib/vigilance-meteofrance';

import auth from './auth';
import commune from './routes/commune';
import actus from './routes/actus';
import alertes from './routes/alertes';
import alertesMeteo from './routes/alertes_meteo';
import sondages from './routes/sondages';
import mur from './routes/mur';
import agenda from './routes/agenda';
import coupsDeMain from './routes/coups_de_main';
import chassesTresor from './routes/chasses_tresor';
import moderation from './routes/moderation';
import dechets from './routes/dechets';
import profil from './routes/profil';
import push from './routes/push';
import enigmes from './routes/enigmes';
import deliberations from './routes/deliberations';
import conseilMembres from './routes/conseil_membres';
import annuaire from './routes/annuaire';
import bulletin from './routes/bulletin';
import photoDuJour from './routes/photo_du_jour';
import memoire from './routes/memoire';
import decouverte from './routes/decouverte';
import lois from './routes/lois';
import backoffice from './backoffice';
import liensCourts from './routes/liens_courts';
import { synchroniserToutesLesLois } from './lib/sync-lois';

const app = new Hono();

// CORS : autorise ton frontend (Pages, réseau local, sous-domaines communes)
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '';
    if (origin.endsWith('.pages.dev')) return origin;
    if (origin === 'https://plateforme-agora.fr' || origin.endsWith('.plateforme-agora.fr')) return origin;
    if (origin.includes('192.168.') || origin.includes('localhost')) return origin;
    return '';
  },
  credentials: true,
}));

// Découverte régionale — route publique, AVANT la résolution de tenant, sinon
// "decouverte" serait interprété à tort comme un slug de commune.
app.route('/decouverte', decouverte);

// Backoffice interne Juicy Solutions — transverse, hors résolution de tenant (mêmes raisons
// que /decouverte). Sa propre garde d'accès (scope 'backoffice') est appliquée dans ses routes.
app.route('/backoffice', backoffice);

// Liens courts pour QR code (voir liens_courts.ts) — "q" n'est pas un slug de commune, mêmes
// raisons que /decouverte et /backoffice ci-dessus.
app.route('/q', liensCourts);

// Résolution tenant : chaque route commence par /:slug/...
app.use('/:slug/*', tenantMiddleware);

// Auth (pas de JWT requis pour login, mais tenant résolu pour retrouver commune_id)
app.route('/:slug/auth', auth);

// Config commune (lecture publique, écriture admin)
app.route('/:slug/commune', commune);

// Modules métier — JWT vérifié AVANT le contrôle d'onglet (commune_id doit être défini)
app.use('/:slug/actus/*', jwtMiddleware);
app.route('/:slug/actus', actus);

app.use('/:slug/alertes/*', jwtMiddleware, requireOngletActif('alertes'));
app.route('/:slug/alertes', alertes);
app.route('/:slug/alertes-meteo', alertesMeteo);

app.use('/:slug/sondages/*', jwtMiddleware, requireOngletActif('thermometre'));
app.route('/:slug/sondages', sondages);

app.use('/:slug/mur/*', jwtMiddleware, requireOngletActif('mur'));
app.route('/:slug/mur', mur);

app.use('/:slug/agenda/*', jwtMiddleware, requireOngletActif('agenda'));
app.route('/:slug/agenda', agenda);

app.use('/:slug/coups-de-main/*', jwtMiddleware, requireOngletActif('coups_de_main'));
app.route('/:slug/coups-de-main', coupsDeMain);

app.use('/:slug/chasses-tresor/*', jwtMiddleware, requireOngletActif('chasse_tresor'));
app.route('/:slug/chasses-tresor', chassesTresor);

// Modération : jamais désactivable, accès filtré par rôle dans la route elle-même
app.route('/:slug/moderation', moderation);

// Déchets : alimente le dashboard, pas d'onglet désactivable dédié
app.route('/:slug/dechets', dechets);

// Mon profil (statistiques gamification)
app.use('/:slug/profil/*', jwtMiddleware, requireOngletActif('profil'));
app.route('/:slug/profil', profil);

// Notifications push — pas de gating par onglet, l'utilisateur doit toujours pouvoir gérer ses abonnements
app.route('/:slug/push', push);

// Énigme photo (énigmes géolocalisées)
app.use('/:slug/enigmes/*', jwtMiddleware, requireOngletActif('enigmes'));
app.route('/:slug/enigmes', enigmes);

// Conseil municipal (délibérations) — les comptes-rendus utilisent /actus?section=conseil
app.use('/:slug/deliberations/*', jwtMiddleware, requireOngletActif('conseil'));
app.route('/:slug/deliberations', deliberations);

// Trombinoscope du conseil municipal (maire, adjoints, conseillers)
app.use('/:slug/conseil-membres/*', jwtMiddleware, requireOngletActif('conseil'));
app.route('/:slug/conseil-membres', conseilMembres);

// Lois & Projets de loi (national/européen, ajout manuel par la mairie)
app.use('/:slug/lois/*', jwtMiddleware, requireOngletActif('lois'));
app.route('/:slug/lois', lois);

// Annuaire citoyen
app.use('/:slug/annuaire/*', jwtMiddleware, requireOngletActif('annuaire'));
app.route('/:slug/annuaire', annuaire);

// Bulletin municipal
app.use('/:slug/bulletin/*', jwtMiddleware, requireOngletActif('bulletin'));
app.route('/:slug/bulletin', bulletin);

// Photo du jour
app.use('/:slug/photo-du-jour/*', jwtMiddleware, requireOngletActif('photo_du_jour'));
app.route('/:slug/photo-du-jour', photoDuJour);

// La mémoire du village (récits patrimoniaux : texte + photos + audio)
app.use('/:slug/memoire/*', jwtMiddleware, requireOngletActif('memoire'));
app.route('/:slug/memoire', memoire);

// Filet de sécurité : sans ça, toute exception non rattrapée dans une route (ex: colonne
// manquante en base, jamais migrée) remonte en 500 brut non-JSON — le frontend plante alors
// sur `res.json()` avant même de pouvoir afficher une erreur lisible.
app.onError((err, c) => {
  console.error(`Erreur non gérée sur ${c.req.method} ${c.req.path} :`, err);
  return c.json({ erreur: 'Erreur interne du serveur, réessaie dans un instant.' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: any, env: any) {
    if (event.cron === '0 4 * * *') {
      await purgerPhotosDuJour(env);
      await purgerEnigmes(env);
      await purgerMur(env);
      await cloturerActionsCiviques(env);
      await purgerOrphelinsMemoire(env);
      await relancerEcheancesFacturation(env);
      await corrigerEmailsProspectsInvalides(env);
      await verifierVariantesProspection(env);
      await verifierRelancesInactiviteProspection(env);
      await verifierSequenceOnboardingCommunes(env);
      await synchroniserEmailsRecusProspection(env);
    } else if (event.cron === '0 */6 * * *') {
      await synchroniserToutesLesLois(env);
      await synchroniserVigilanceMeteoFrance(env);
    } else {
      await nettoyerCoupsDeMainExpires(env);
    }
  },
};
