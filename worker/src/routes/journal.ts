// worker/src/routes/journal.ts
// Journal papier — MODE ESSAI (validé par Léandre le 2026-11-14) : réservé au superadmin, rien
// n'est jamais écrit en base ni dans R2. Aucun article n'est marqué « déjà paru », aucun numéro
// n'est publié : on peut refaire le même numéro autant de fois qu'on veut. La photo de
// couverture et les photos ajoutées pour le papier arrivent avec la demande (image intégrée) et
// sont oubliées aussitôt la page ou le PDF rendus.
//   GET  /contenus  : contenus proposés pour la période (lecture seule)
//   POST /apercu    : page HTML du journal (même gabarit que le PDF)
//   POST /pdf       : PDF A4, pages dans l'ordre, fabriqué par Browser Run (binding BROWSER)
import { Hono } from 'hono';
import { z } from 'zod';
import puppeteer from '@cloudflare/puppeteer';
import { jwtMiddleware } from '../middleware/jwt';
import { genererQrSvgUrl } from '../lib/qr-url';
import {
  ordreRubriques, chargerCommuneJournal, articlesDeLaPeriode, articlesParIds, evenementsAgenda,
  sondagesClos, bilanSignalements, collecteDechets, texteEnParagraphes, type PeriodeJournal,
} from '../lib/journal-contenus';
import { genererJournalHtml, esc, couleurSure, type DonneesJournal, type RubriqueJournal, type ArticleJournal } from '../lib/journal-gabarit';

const app = new Hono();
app.use('*', jwtMiddleware);
app.use('*', async (c, next) => {
  if (c.get('role') !== 'superadmin') return c.json({ erreur: 'Réservé au superadmin (journal en essai)' }, 403);
  await next();
});

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();
// Image intégrée envoyée par le navigateur (déjà réduite côté client). Jamais stockée.
const imageIntegree = z.string().max(8_000_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/);

const periodeSchema = z.object({
  debut: date, fin: date, agenda_debut: date, agenda_fin: date,
}).refine((p) => p.debut <= p.fin && p.agenda_debut <= p.agenda_fin, { message: 'Période incohérente' });

const journalSchema = z.object({
  titre: z.string().trim().min(1).max(80),
  sous_titre: z.string().trim().max(120).default(''),
  numero: z.number().int().min(1).max(999),
  saison: z.string().trim().min(1).max(40),
  tirage: z.string().trim().max(40).default(''),
  periode: periodeSchema,
  couverture: z.object({ image: imageIntegree, credit: z.string().trim().max(80).default('') }).nullable().default(null),
  edito: z.object({ texte: z.string().max(5000).default(''), signataire: z.string().trim().max(80).default('Le maire') }),
  opposition: z.object({
    choix: z.enum(['aucun_bloc', 'texte', 'non_transmis', 'aucun_elu']),
    liste: z.string().trim().max(80).default(''),
    texte: z.string().max(1200).default(''),
  }),
  articles: z.array(z.object({
    id: uuid,
    titre: z.string().trim().min(1).max(200).optional(),
    texte: z.string().max(12000).optional(),
    photo: imageIntegree.optional(),
    sans_photo: z.boolean().default(false),
    photo_grande: z.boolean().default(false),
  })).max(80),
  evenements: z.array(uuid).max(60),
  sondages: z.array(uuid).max(10),
  encarts: z.object({ signalements: z.boolean(), dechets: z.boolean(), numeros_utiles: z.boolean() }),
});
type DemandeJournal = z.infer<typeof journalSchema>;

const fmtParis = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
// Jour de la semaine CALCULÉ à partir de la date (heure de Paris), jamais saisi.
export function partiesDate(iso: string) {
  const p = Object.fromEntries(fmtParis.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const heure = p.hour === '00' && p.minute === '00' ? '' : `${Number(p.hour)} h${p.minute !== '00' ? ` ${p.minute}` : ''}`;
  const mois = `${p.month} ${p.year}`;
  return { jour: String(p.weekday).replace('.', ''), num: p.day, mois: mois.charAt(0).toUpperCase() + mois.slice(1), heure, jourMois: `${p.day} ${p.month}` };
}

const LIBELLES_DECHETS: Record<string, string> = {
  ordures_menageres: 'Ordures ménagères', tri_selectif: 'Tri sélectif', verre: 'Verre', encombrants: 'Encombrants', dechets_verts: 'Déchets verts',
};
const JOURS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const FREQUENCES: Record<string, string> = { chaque_semaine: 'chaque', semaines_paires: 'semaines paires, le', semaines_impaires: 'semaines impaires, le' };

// GET /contenus?debut=&fin=&agenda_debut=&agenda_fin=
app.get('/contenus', async (c) => {
  const commune_id = c.get('commune_id');
  const q = periodeSchema.safeParse({
    debut: c.req.query('debut'), fin: c.req.query('fin'), agenda_debut: c.req.query('agenda_debut'), agenda_fin: c.req.query('agenda_fin'),
  });
  if (!q.success) return c.json({ erreur: 'Période invalide' }, 400);
  const p: PeriodeJournal = { debut: q.data.debut, fin: q.data.fin, agendaDebut: q.data.agenda_debut, agendaFin: q.data.agenda_fin };

  const [commune, articles, evenements, sondages, signalements, dechets] = await Promise.all([
    chargerCommuneJournal(c.env, commune_id),
    articlesDeLaPeriode(c.env, commune_id, p),
    evenementsAgenda(c.env, commune_id, p.agendaDebut, p.agendaFin),
    sondagesClos(c.env, commune_id, p),
    bilanSignalements(c.env, commune_id, p),
    collecteDechets(c.env, commune_id, p.agendaDebut, p.agendaFin),
  ]);
  if (!commune) return c.json({ erreur: 'Commune introuvable' }, 404);

  const rubriques = ordreRubriques()
    .map((r) => ({
      cle: r.cle, titre: r.titre, couleur: r.couleur,
      articles: articles.filter((a: any) => a.rubrique === r.cle).map((a: any) => ({
        id: a.id, titre: a.titre, date: a.date, photo_url: a.photo_url, association: a.association,
        texte: a.paragraphes.join('\n'), nb_mots: a.paragraphes.join(' ').split(/\s+/).filter(Boolean).length,
      })),
    }));

  return c.json({
    commune: {
      nom: commune.nom, population: commune.population ?? null,
      couleur_theme: couleurSure(commune.couleur_theme, '#2C5F6E'), couleur_accent: couleurSure(commune.couleur_accent, '#E2C97E'),
    },
    rubriques,
    evenements: evenements.map((e: any) => {
      const d = partiesDate(e.date_debut);
      return { id: e.id, titre: e.titre, lieu: e.lieu ?? '', jour: d.jour, num: d.num, mois: d.mois, heure: d.heure };
    }),
    sondages: sondages.map((s: any) => ({ id: s.id, question: s.question, participants: s.participants, cloture: partiesDate(s.closes_at).jourMois })),
    signalements,
    dechets: { collectes: dechets.config.length, jours_decales: dechets.exceptions.length },
  });
});

// ── Assemblage d'un numéro à partir de la demande (ids + retouches) relue en base ──

async function polices(env: any): Promise<string> {
  if (policesEnCache !== null) return policesEnCache;
  const fichiers: [string, string, string, string][] = [
    ['Kaushan Script', '400', 'normal', 'kaushan-script-400'],
    ['Source Sans 3', '400', 'normal', 'source-sans-3-400'],
    ['Source Sans 3', '600', 'normal', 'source-sans-3-600'],
    ['Source Sans 3', '700', 'normal', 'source-sans-3-700'],
    ['Source Serif 4', '400', 'normal', 'source-serif-4-400'],
    ['Source Serif 4', '400', 'italic', 'source-serif-4-400-italique'],
    ['Source Serif 4', '600', 'normal', 'source-serif-4-600'],
  ];
  try {
    const regles = await Promise.all(fichiers.map(async ([famille, graisse, style, nom]) => {
      const res = await fetch(`${env.FRONTEND_URL}/css/polices/journal/${nom}.woff2`);
      if (!res.ok) throw new Error(`police ${nom} : ${res.status}`);
      const octets = new Uint8Array(await res.arrayBuffer());
      let binaire = '';
      for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
      return `@font-face{font-family:'${famille}';font-weight:${graisse};font-style:${style};src:url(data:font/woff2;base64,${btoa(binaire)}) format('woff2')}`;
    }));
    policesEnCache = regles.join('');
  } catch (err) {
    // Polices de secours (Georgia/Arial) : le journal reste lisible, et l'on réessaiera au prochain appel.
    console.error('Journal : polices indisponibles', err);
    return '';
  }
  return policesEnCache;
}
let policesEnCache: string | null = null;

async function assembler(env: any, commune_id: string, d: DemandeJournal, mode: 'apercu' | 'pdf'): Promise<DonneesJournal | null> {
  const p: PeriodeJournal = { debut: d.periode.debut, fin: d.periode.fin, agendaDebut: d.periode.agenda_debut, agendaFin: d.periode.agenda_fin };
  const [commune, articles, evenements, sondages, signalements, dechets, policesCss] = await Promise.all([
    chargerCommuneJournal(env, commune_id),
    articlesParIds(env, commune_id, d.articles.map((a) => a.id)),
    evenementsAgenda(env, commune_id, p.agendaDebut, p.agendaFin, d.evenements),
    sondagesClos(env, commune_id, p, d.sondages),
    d.encarts.signalements ? bilanSignalements(env, commune_id, p) : null,
    d.encarts.dechets ? collecteDechets(env, commune_id, p.agendaDebut, p.agendaFin) : null,
    polices(env),
  ]);
  if (!commune) return null;
  const parId = new Map(articles.map((a: any) => [a.id, a]));

  const rubriques: RubriqueJournal[] = ordreRubriques().map((r) => ({ cle: r.cle, titre: r.titre, couleur: r.couleur, picto: r.picto, articles: [], encartsHtml: [] }));
  const rubrique = (cle: string) => rubriques.find((r) => r.cle === cle) ?? rubriques[0];

  // Articles dans l'ordre choisi par l'utilisateur (seuls ceux relus en base, donc de SA commune).
  d.articles.forEach((choix) => {
    const a: any = parId.get(choix.id);
    if (!a) return;
    const article: ArticleJournal = {
      id: a.id,
      surtitre: a.association ?? (a.rubrique === 'conseil' ? 'Compte rendu' : ''),
      titre: choix.titre ?? a.titre,
      paragraphes: choix.texte !== undefined ? texteEnParagraphes(choix.texte) : a.paragraphes,
      photo: choix.sans_photo ? null : (choix.photo ?? a.photo_url),
      photoGrande: choix.photo_grande,
      sansPhotoChoisi: choix.sans_photo,
    };
    rubrique(a.rubrique).articles.push(article);
  });

  rubrique('agenda').evenements = evenements.map((e: any) => {
    const t = partiesDate(e.date_debut);
    return { jour: t.jour, num: t.num, mois: t.mois, titre: e.titre, detail: [e.lieu, t.heure].filter(Boolean).join(' · ') };
  });
  rubrique('thermometre').sondages = sondages.map((s: any) => ({
    question: s.question, participants: s.participants, cloture: partiesDate(s.closes_at).jourMois,
    choix: s.choix.map((ch: any) => ({ label: ch.label, pct: ch.pct })),
  }));

  if (signalements && signalements.recus > 0) {
    rubrique('projets_travaux').encartsHtml!.push(`<h4>Vos signalements sur la période</h4><div class="chiffres">`
      + `<div><b>${signalements.recus}</b>reçus</div><div><b>${signalements.resolus}</b>résolus</div><div><b>${signalements.en_cours}</b>en cours</div></div>`
      + 'Un souci dans le village ? Signalez-le dans l\'appli, rubrique Alertes.');
  }
  if (dechets && (dechets.config.length || dechets.exceptions.length)) {
    const lignes = dechets.config.map((cfg: any) => `<li>${esc(LIBELLES_DECHETS[cfg.type] ?? cfg.type)} : ${esc(FREQUENCES[cfg.frequence] ?? '')} ${esc(JOURS[cfg.jour_semaine] ?? '')}</li>`).join('');
    const decales = dechets.exceptions.map((ex: any) => `${esc(partiesDate(`${ex.date}T12:00:00Z`).jourMois)} : ${esc(ex.libelle)}`).join(' ; ');
    rubrique('info_pratique').encartsHtml!.push(`<h4>Collecte des déchets</h4>${lignes ? `<ul>${lignes}</ul>` : ''}`
      + (decales ? `<p style="margin:.5em 0 0"><b>Jours particuliers :</b> ${decales}.</p>` : ''));
  }
  if (d.encarts.numeros_utiles) {
    rubrique('info_pratique').encartsHtml!.push('<h4>Numéros utiles</h4><ul>'
      + (commune.telephone_mairie ? `<li>Mairie : ${esc(commune.telephone_mairie)}</li>` : '')
      + '<li>Urgences (depuis un portable) : 112</li><li>SAMU : 15</li><li>Police, gendarmerie : 17</li><li>Pompiers : 18</li>'
      + '<li>Urgences pour personnes sourdes ou malentendantes : 114 (SMS)</li></ul>');
  }

  const logo = typeof commune.logo_url === 'string' && /^https:\/\//.test(commune.logo_url) ? commune.logo_url : null;
  return {
    mode, polices: policesCss,
    titre: d.titre, sousTitre: d.sous_titre, numero: d.numero, saison: d.saison, tirage: d.tirage,
    commune: {
      nom: commune.nom, departement: commune.departement ?? '',
      c1: couleurSure(commune.couleur_theme, '#2C5F6E'), c2: couleurSure(commune.couleur_accent, '#E2C97E'),
      logoUrl: logo, qrSvg: genererQrSvgUrl(`${env.FRONTEND_URL}/${commune.slug}`),
    },
    mairie: { horaires: commune.horaires_ouverture ?? '', permanences: commune.permanences ?? '', telephone: commune.telephone_mairie ?? '', email: commune.email_mairie ?? '' },
    couverture: { image: d.couverture?.image ?? null, credit: d.couverture?.credit ?? '' },
    edito: d.edito.texte.trim() ? { paragraphes: texteEnParagraphes(d.edito.texte), signataire: d.edito.signataire || 'Le maire' } : null,
    rubriques: rubriques.filter((r) => r.articles.length || r.evenements?.length || r.sondages?.length || r.encartsHtml?.length),
    opposition: { choix: d.opposition.choix, liste: d.opposition.liste, paragraphes: texteEnParagraphes(d.opposition.texte) },
    numerosUtilesInclus: d.encarts.numeros_utiles,
  };
}

async function lireDemande(c: any): Promise<{ ok: true; data: DemandeJournal } | { ok: false; reponse: Response }> {
  const taille = Number(c.req.header('content-length') ?? 0);
  if (taille > 30_000_000) return { ok: false, reponse: c.json({ erreur: 'Demande trop lourde : réduisez le nombre de photos ajoutées.' }, 413) };
  let corps: unknown;
  try { corps = await c.req.json(); } catch { return { ok: false, reponse: c.json({ erreur: 'Demande illisible' }, 400) }; }
  const r = journalSchema.safeParse(corps);
  if (!r.success) return { ok: false, reponse: c.json({ erreur: r.error.flatten() }, 400) };
  return { ok: true, data: r.data };
}

app.post('/apercu', async (c) => {
  const demande = await lireDemande(c);
  if (!demande.ok) return demande.reponse;
  const donnees = await assembler(c.env, c.get('commune_id'), demande.data, 'apercu');
  if (!donnees) return c.json({ erreur: 'Commune introuvable' }, 404);
  return c.json({ html: genererJournalHtml(donnees) });
});

app.post('/pdf', async (c) => {
  if (!c.env.BROWSER) return c.json({ erreur: 'Fabrication du PDF indisponible sur ce serveur.' }, 503);
  const demande = await lireDemande(c);
  if (!demande.ok) return demande.reponse;
  const donnees = await assembler(c.env, c.get('commune_id'), demande.data, 'pdf');
  if (!donnees) return c.json({ erreur: 'Commune introuvable' }, 404);
  const html = genererJournalHtml(donnees);

  let navigateur: any;
  try {
    navigateur = await puppeteer.launch(c.env.BROWSER);
    const page = await navigateur.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
    // Attente par intervalle fixe (pas « raf ») : un navigateur sans écran peut ne jamais
    // rafraîchir l'affichage, et l'attente par défaut ne finirait pas.
    await page.waitForFunction('document.body.dataset.pret === "1"', { polling: 250, timeout: 30000 });
    // Vérifié le 2026-11-14 avec le vrai Browser Run (wrangler dev, remote = true) : ~5 s pour
    // 5 pages. La version LOCALE de Browser Run, elle, bloque sur page.pdf() même pour une page
    // vide : pour essayer en local, mettre remote = true sur le binding browser.
    const pdf = await page.pdf({ width: '210mm', height: '297mm', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' }, timeout: 60000 });
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="journal-n${demande.data.numero}-essai.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err: any) {
    console.error('Journal : échec du PDF', err);
    // Offre Workers gratuite : 10 min de navigateur par jour ET un nouveau navigateur toutes les
    // 20 s au plus — deux limites différentes, deux messages différents.
    const message = String(err?.message ?? '');
    const erreur = /exceeded for today/i.test(message)
      ? 'Le quota quotidien du navigateur Cloudflare est atteint. Réessayez demain.'
      : /429|rate limit|too many/i.test(message)
        ? 'Trop de PDF demandés d\'affilée : attendez une trentaine de secondes et réessayez.'
        : 'La fabrication du PDF a échoué. Réessayez dans un instant.';
    return c.json({ erreur }, 502);
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
  }
});

export default app;
