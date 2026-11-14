// worker/src/lib/journal-contenus.ts
// Journal papier — collecte des contenus d'une commune pour un numéro. LECTURE SEULE : rien n'est
// jamais écrit en base ici (mode essai validé par Léandre le 2026-11-14 : aucun article marqué
// « déjà paru », aucune trace). Tout est filtré par le commune_id du JWT, jamais par le client.
// Volontairement absents de l'essai : photos du jour (il faut d'abord la case de consentement
// accord_bulletin, donc une migration) et entraide (les coups de main expirés sont purgés, les
// chiffres seraient faux).
import { supabaseSelect } from '../db';
import { CLES_THEMES_ACTUS, LIBELLES_THEMES_ACTUS } from './themes-actus';

export interface PeriodeJournal { debut: string; fin: string; agendaDebut: string; agendaFin: string } // AAAA-MM-JJ

// Rubriques dans l'ordre du journal. Un thème d'actu inconnu ici (ajouté plus tard dans
// themes-actus.ts) est inséré avant « Agenda » avec la couleur et le pictogramme par défaut.
const STYLE_RUBRIQUES: Record<string, { couleur: string; picto: string }> = {
  vie_village: { couleur: '#B4583A', picto: 'maison' },
  vie_associative: { couleur: '#8A4F7D', picto: 'assos' },
  projets_travaux: { couleur: '#2F6690', picto: 'travaux' },
  conseil: { couleur: '#5B4B8A', picto: 'mairie' },
  environnement: { couleur: '#3F7F4E', picto: 'feuille' },
  agenda: { couleur: '#B07A12', picto: 'calendrier' },
  info_pratique: { couleur: '#24767A', picto: 'info' },
  thermometre: { couleur: '#B23A48', picto: 'thermometre' },
};
const STYLE_DEFAUT = { couleur: '#4A6670', picto: 'info' };

export function ordreRubriques(): { cle: string; titre: string; couleur: string; picto: string }[] {
  const fixes = ['vie_village', 'vie_associative', 'projets_travaux', 'conseil', 'environnement'];
  const nouveaux = CLES_THEMES_ACTUS.filter((c) => !['vie_village', 'projets_travaux', 'environnement', 'agenda', 'info_pratique'].includes(c));
  const cles = [...fixes, ...nouveaux, 'agenda', 'info_pratique', 'thermometre'];
  const titres: Record<string, string> = { ...LIBELLES_THEMES_ACTUS, vie_associative: 'Vie associative', conseil: 'Conseil municipal', thermometre: 'Thermomètre du village' };
  return cles.map((cle) => ({ cle, titre: titres[cle] ?? cle, ...(STYLE_RUBRIQUES[cle] ?? STYLE_DEFAUT) }));
}

// Lendemain d'une date AAAA-MM-JJ (borne de fin exclusive d'une période).
export function lendemain(jour: string): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const entre = (col: string, debut: string, finIncluse: string) => `(${col}.gte.${debut}T00:00:00Z,${col}.lt.${lendemain(finIncluse)}T00:00:00Z)`;

// HTML de l'éditeur riche (déjà nettoyé à l'écriture par sanitizeHtml) → paragraphes de texte
// brut. Le papier a sa propre typographie : gras, couleurs et liens ne sont pas repris.
export function htmlEnParagraphes(html: string): string[] {
  const texte = String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
  return texte.split('\n').map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
// Texte libre (retouche « pour le papier ») → paragraphes : une ligne = un paragraphe.
export function texteEnParagraphes(texte: string): string[] {
  return String(texte ?? '').split('\n').map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export function rubriqueArticle(a: { section: string; fiche_id: string | null; categorie: string }): string {
  if (a.section === 'conseil') return 'conseil';
  if (a.fiche_id) return 'vie_associative';
  return a.categorie || 'vie_village';
}

const COLONNES_COMMUNE = 'id,slug,nom,departement,population,couleur_theme,couleur_accent,logo_url,horaires_ouverture,permanences,telephone_mairie,email_mairie';

export async function chargerCommuneJournal(env: any, commune_id: string) {
  const [commune] = await supabaseSelect(env, 'communes', { select: COLONNES_COMMUNE, id: `eq.${commune_id}` });
  return commune ?? null;
}

async function nomsAssociations(env: any, commune_id: string, ficheIds: string[]): Promise<Map<string, string>> {
  if (!ficheIds.length) return new Map();
  const fiches = await supabaseSelect(env, 'annuaire', {
    select: 'id,nom', commune_id: `eq.${commune_id}`, id: `in.(${[...new Set(ficheIds)].join(',')})`,
  });
  return new Map(fiches.map((f: any) => [f.id, f.nom]));
}

async function premieresImages(env: any, commune_id: string, articleIds: string[]): Promise<Map<string, string>> {
  if (!articleIds.length) return new Map();
  const images = await supabaseSelect(env, 'article_images', {
    select: 'article_id,url,ordre', commune_id: `eq.${commune_id}`, article_id: `in.(${articleIds.join(',')})`, order: 'ordre.asc',
  });
  const premiere = new Map<string, string>();
  images.forEach((i: any) => { if (!premiere.has(i.article_id)) premiere.set(i.article_id, i.url); });
  return premiere;
}

const COLONNES_ARTICLE = 'id,titre,contenu_html,categorie,section,fiche_id,created_at';

// Articles visibles (jamais les masqués après signalement) publiés pendant la période, archivés
// compris : un article archivé depuis a bien paru pendant la période.
export async function articlesDeLaPeriode(env: any, commune_id: string, p: PeriodeJournal) {
  const articles = await supabaseSelect(env, 'articles', {
    select: COLONNES_ARTICLE, commune_id: `eq.${commune_id}`, statut: 'eq.visible',
    and: entre('created_at', p.debut, p.fin), order: 'created_at.asc', limit: '200',
  });
  return completerArticles(env, commune_id, articles);
}

// Articles choisis pour le numéro, relus en base par identifiant (le client n'envoie que des ids).
export async function articlesParIds(env: any, commune_id: string, ids: string[]) {
  if (!ids.length) return [];
  const articles = await supabaseSelect(env, 'articles', {
    select: COLONNES_ARTICLE, commune_id: `eq.${commune_id}`, statut: 'eq.visible', id: `in.(${ids.join(',')})`,
  });
  return completerArticles(env, commune_id, articles);
}

async function completerArticles(env: any, commune_id: string, articles: any[]) {
  const [images, assos] = await Promise.all([
    premieresImages(env, commune_id, articles.map((a: any) => a.id)),
    nomsAssociations(env, commune_id, articles.map((a: any) => a.fiche_id).filter(Boolean)),
  ]);
  return articles.map((a: any) => ({
    id: a.id, titre: a.titre, date: a.created_at, rubrique: rubriqueArticle(a), categorie: a.categorie,
    association: a.fiche_id ? (assos.get(a.fiche_id) ?? 'Association') : null,
    paragraphes: htmlEnParagraphes(a.contenu_html), photo_url: images.get(a.id) ?? null,
  }));
}

// Événements visibles qui commencent entre la distribution et la date de fin de l'agenda.
export async function evenementsAgenda(env: any, commune_id: string, debut: string, fin: string, ids?: string[]) {
  const filtres: Record<string, string> = {
    select: 'id,titre,lieu,date_debut,date_fin,fiche_id', commune_id: `eq.${commune_id}`, statut: 'eq.visible',
    and: entre('date_debut', debut, fin), order: 'date_debut.asc', limit: '100',
  };
  if (ids) {
    if (!ids.length) return [];
    filtres.id = `in.(${ids.join(',')})`;
  }
  return supabaseSelect(env, 'events', filtres);
}

// Sondages du Thermomètre clos pendant la période (et déjà clos aujourd'hui), avec résultats.
export async function sondagesClos(env: any, commune_id: string, p: PeriodeJournal, ids?: string[]) {
  const filtres: Record<string, string> = {
    select: 'id,question,type,closes_at', commune_id: `eq.${commune_id}`,
    and: entre('closes_at', p.debut, p.fin), order: 'closes_at.asc',
  };
  if (ids) {
    if (!ids.length) return [];
    filtres.id = `in.(${ids.join(',')})`;
  }
  const maintenant = Date.now();
  const sondages = (await supabaseSelect(env, 'sondages', filtres)).filter((s: any) => new Date(s.closes_at).getTime() <= maintenant);
  if (!sondages.length) return [];
  const sIds = sondages.map((s: any) => s.id).join(',');
  const [choix, votes] = await Promise.all([
    supabaseSelect(env, 'choix_sondage', { select: 'id,sondage_id,label,ordre', commune_id: `eq.${commune_id}`, sondage_id: `in.(${sIds})`, order: 'ordre.asc' }),
    supabaseSelect(env, 'votes', { select: 'sondage_id,choix_id,user_id', commune_id: `eq.${commune_id}`, sondage_id: `in.(${sIds})` }),
  ]);
  return sondages.map((s: any) => {
    const sesVotes = votes.filter((v: any) => v.sondage_id === s.id);
    const participants = new Set(sesVotes.map((v: any) => v.user_id)).size;
    return {
      id: s.id, question: s.question, closes_at: s.closes_at, participants,
      choix: choix.filter((ch: any) => ch.sondage_id === s.id).map((ch: any) => {
        const n = sesVotes.filter((v: any) => v.choix_id === ch.id).length;
        return { label: ch.label, votes: n, pct: participants ? Math.round((n / participants) * 100) : 0 };
      }),
    };
  });
}

// Bilan agrégé des signalements de la période : jamais un signalement individuel.
export async function bilanSignalements(env: any, commune_id: string, p: PeriodeJournal) {
  const alertes = await supabaseSelect(env, 'alertes', {
    select: 'statut', commune_id: `eq.${commune_id}`, and: entre('created_at', p.debut, p.fin), limit: '2000',
  });
  const resolus = alertes.filter((a: any) => a.statut === 'resolue').length;
  return { recus: alertes.length, resolus, en_cours: alertes.length - resolus };
}

export async function collecteDechets(env: any, commune_id: string, debut: string, fin: string) {
  const [config, exceptions] = await Promise.all([
    supabaseSelect(env, 'dechets_config', { select: 'type,jour_semaine,frequence', commune_id: `eq.${commune_id}`, order: 'jour_semaine.asc' }),
    supabaseSelect(env, 'dechets_exceptions', { select: 'date,libelle', commune_id: `eq.${commune_id}`, and: `(date.gte.${debut},date.lte.${fin})`, order: 'date.asc' }),
  ]);
  return { config, exceptions };
}
