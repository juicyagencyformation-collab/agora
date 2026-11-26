// worker/src/lib/moderation-publications.ts
// Outils de modération de la mairie sur les publications qui ne sont pas les siennes (associations,
// commerces, artisans, événements d'habitants) — 2026-11-26, migration 122.
// Règlement européen sur les services numériques (DSA), art. 17 : toute restriction est MOTIVÉE et
// l'auteur en est informé (motif, règle de la charte, voie de recours). D'où un motif obligatoire
// choisi dans une liste fermée, renvoyant chacun à un article de frontend/charte-publication.html,
// un email automatique à l'auteur, et une trace dans moderation_decisions (preuve en cas de contestation).
import { supabaseSelect, supabaseUpdate, supabaseInsert, supabaseDelete } from '../db';
import { envoyerEmail } from './email';

export const MOTIFS_MODERATION = {
  publicite: { libelle: 'Publicité excessive ou répétée', article: 3 },
  doublon: { libelle: 'Doublon d\'une publication déjà en ligne', article: 3 },
  hors_sujet: { libelle: 'Sans rapport avec la vie locale', article: 2 },
  politique: { libelle: 'Propagande politique ou électorale', article: 4 },
  religieux: { libelle: 'Prosélytisme religieux', article: 4 },
  injurieux: { libelle: 'Propos injurieux, haineux ou diffamatoires', article: 5 },
  trompeur: { libelle: 'Information fausse ou trompeuse', article: 5 },
  vie_privee: { libelle: 'Atteinte à la vie privée ou au droit à l\'image', article: 6 },
  autre: { libelle: 'Autre motif (précisé ci-dessous)', article: 7 },
} as const;
export type MotifModeration = keyof typeof MOTIFS_MODERATION;
export const CLES_MOTIFS = Object.keys(MOTIFS_MODERATION) as [MotifModeration, ...MotifModeration[]];
export const DUREES_SUSPENSION = [7, 30, 90] as const;

// Version de la charte de publication (= « Version du … » de frontend/charte-publication.html).
// À changer à chaque modification de fond de la charte : elle sera redemandée à tous (migration 123).
export const VERSION_CHARTE = '2026-11-26';

// La charte s'ouvre d'office pour qui publie au nom d'une fiche (responsable actif) ou modère
// (mairie), tant qu'il n'a pas cliqué « J'ai lu la charte » pour la version en cours.
export async function charteALire(env: any, commune_id: string, user_id: string, gestionnaire: boolean): Promise<boolean> {
  const [lue] = await supabaseSelect(env, 'chartes_lues', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, version: `eq.${VERSION_CHARTE}`,
  });
  if (lue) return false;
  if (gestionnaire) return true;
  const [responsable] = await supabaseSelect(env, 'annuaire_responsables', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, statut: 'eq.actif', limit: '1',
  });
  return !!responsable;
}

export async function noterCharteLue(env: any, commune_id: string, user_id: string) {
  const [deja] = await supabaseSelect(env, 'chartes_lues', {
    select: 'id', commune_id: `eq.${commune_id}`, user_id: `eq.${user_id}`, version: `eq.${VERSION_CHARTE}`,
  });
  if (!deja) await supabaseInsert(env, 'chartes_lues', { commune_id, user_id, version: VERSION_CHARTE });
}

type Cible = { article_id?: string; event_id?: string };

const echapper = (s: string) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch] as string));
const dateFr = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

async function infosCommune(env: any, commune_id: string) {
  const [commune] = await supabaseSelect(env, 'communes', { select: 'nom,slug,email_mairie,contact_email', id: `eq.${commune_id}` });
  return { nom: commune?.nom ?? 'la commune', slug: commune?.slug ?? '', email: commune?.email_mairie || commune?.contact_email || null };
}

// Adresses à prévenir : l'auteur et les responsables actifs de la fiche (sans doublon, comptes actifs).
async function destinataires(env: any, commune_id: string, auteur_id: string | null, fiche_id: string | null) {
  const ids = new Set<string>();
  if (auteur_id) ids.add(auteur_id);
  if (fiche_id) {
    const resp = await supabaseSelect(env, 'annuaire_responsables', {
      select: 'user_id', commune_id: `eq.${commune_id}`, fiche_id: `eq.${fiche_id}`, statut: 'eq.actif',
    });
    resp.forEach((r: any) => ids.add(r.user_id));
  }
  if (!ids.size) return [];
  return supabaseSelect(env, 'users', {
    select: 'id,prenom,email', commune_id: `eq.${commune_id}`, id: `in.(${[...ids].join(',')})`, compte_supprime_le: 'is.null',
  });
}

function emailDecision(env: any, commune: { nom: string; slug: string }, prenom: string, intro: string, motif: MotifModeration, precision: string | null) {
  const m = MOTIFS_MODERATION[motif];
  const charte = `${env.FRONTEND_URL}/charte-publication.html#article-${m.article}`;
  return `
    <p>Bonjour ${echapper(prenom || '')},</p>
    <p>${intro}</p>
    <p><strong>Motif :</strong> ${echapper(m.libelle)} — article ${m.article} de la
      <a href="${charte}">charte de publication</a>.</p>
    ${precision ? `<p><strong>Précision de la mairie :</strong> ${echapper(precision)}</p>` : ''}
    <p><strong>Si vous n'êtes pas d'accord</strong>, répondez simplement à cet email ou contactez la mairie de
      ${echapper(commune.nom)} : elle réexaminera sa décision. Vous pouvez aussi saisir le médiateur ou le juge
      compétent.</p>
    <p>Cette décision a été prise par la mairie de ${echapper(commune.nom)}, pas automatiquement.</p>
    <p style="color:#667">— Plateforme-Agora, pour la mairie de ${echapper(commune.nom)}</p>`;
}

async function prevenir(env: any, commune_id: string, auteur_id: string | null, fiche_id: string | null, sujet: string, intro: string, motif: MotifModeration, precision: string | null) {
  const [commune, personnes] = await Promise.all([infosCommune(env, commune_id), destinataires(env, commune_id, auteur_id, fiche_id)]);
  let envoyes = 0;
  for (const p of personnes) {
    if (!p.email) continue;
    const id = await envoyerEmail(env, p.email, sujet, emailDecision(env, commune, p.prenom, intro, motif, precision), undefined, commune.email ?? undefined);
    if (id) envoyes += 1;
  }
  return envoyes > 0;
}

async function chargerPublication(env: any, commune_id: string, cible: Cible) {
  if (cible.article_id) {
    const [a] = await supabaseSelect(env, 'articles', {
      select: 'id,titre,fiche_id,auteur_id', commune_id: `eq.${commune_id}`, id: `eq.${cible.article_id}`,
    });
    return a ? { id: a.id, titre: a.titre, fiche_id: a.fiche_id, auteur_id: a.auteur_id, mairie: !a.fiche_id, table: 'articles', genre: 'actualité' } : null;
  }
  const [e] = await supabaseSelect(env, 'events', {
    select: 'id,titre,fiche_id,user_id,officiel', commune_id: `eq.${commune_id}`, id: `eq.${cible.event_id}`,
  });
  return e ? { id: e.id, titre: e.titre, fiche_id: e.fiche_id, auteur_id: e.user_id, mairie: !!e.officiel, table: 'events', genre: 'événement' } : null;
}

// Retrait motivé : la publication est masquée (statut masquee, réversible par « Rétablir »),
// l'auteur et les responsables de la fiche reçoivent le motif par email, la décision est tracée.
export async function retirerPublication(env: any, commune_id: string, decide_par: string, cible: Cible, motif: MotifModeration, precision: string | null) {
  const pub = await chargerPublication(env, commune_id, cible);
  if (!pub) return { erreur: 'Publication introuvable', statut: 404 as const };
  if (pub.mairie) return { erreur: 'Une publication de la mairie se modifie ou se supprime directement', statut: 400 as const };
  await supabaseUpdate(env, pub.table, { statut: 'masquee' }, { id: `eq.${pub.id}`, commune_id: `eq.${commune_id}` });
  const prevenu = await prevenir(env, commune_id, pub.auteur_id, pub.fiche_id, `Votre ${pub.genre} a été retiré(e) par la mairie`,
    `La mairie a retiré votre ${pub.genre} « ${echapper(pub.titre)} » : elle n'est plus visible des habitants.`, motif, precision);
  await supabaseInsert(env, 'moderation_decisions', {
    commune_id, type: 'retrait', ...cible, fiche_id: pub.fiche_id, motif, precision, decide_par, auteur_prevenu: prevenu,
  });
  return { ok: true, auteur_prevenu: prevenu };
}

// « Rétablir » : la trace de la décision inverse, pour que l'historique reste lisible.
export async function noterRestauration(env: any, commune_id: string, decide_par: string, cible: Cible) {
  const pub = await chargerPublication(env, commune_id, cible);
  if (!pub) return;
  await supabaseInsert(env, 'moderation_decisions', { commune_id, type: 'restauration', ...cible, fiche_id: pub.fiche_id, decide_par });
}

// Dernier motif de retrait de chaque publication masquée (affiché à la mairie à côté du badge).
export async function motifsRetrait(env: any, commune_id: string, colonne: 'article_id' | 'event_id', ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const lignes = await supabaseSelect(env, 'moderation_decisions', {
    select: `${colonne},motif`, commune_id: `eq.${commune_id}`, type: 'eq.retrait', [colonne]: `in.(${ids.join(',')})`, order: 'created_at.asc',
  });
  return new Map(lignes.map((l: any) => [l[colonne], MOTIFS_MODERATION[l.motif as MotifModeration]?.libelle ?? 'Retrait']));
}

// Suspension des publications d'une fiche pour 7, 30 ou 90 jours (récidive, spam).
export async function suspendreFiche(env: any, commune_id: string, decide_par: string, fiche_id: string, jours: number, motif: MotifModeration, precision: string | null) {
  const [fiche] = await supabaseSelect(env, 'annuaire', { select: 'id,nom,user_id', commune_id: `eq.${commune_id}`, id: `eq.${fiche_id}` });
  if (!fiche) return { erreur: 'Fiche introuvable', statut: 404 as const };
  const jusqu = new Date(Date.now() + jours * 86400000).toISOString().slice(0, 10);
  await supabaseUpdate(env, 'annuaire', { publications_suspendues_jusqu: jusqu, publications_suspension_motif: motif }, {
    id: `eq.${fiche_id}`, commune_id: `eq.${commune_id}`,
  });
  const prevenu = await prevenir(env, commune_id, null, fiche_id, `Publications de « ${fiche.nom} » suspendues`,
    `La mairie a suspendu les publications au nom de « ${echapper(fiche.nom)} » jusqu'au ${dateFr(jusqu)} inclus. La fiche de l'annuaire reste visible.`, motif, precision);
  await supabaseInsert(env, 'moderation_decisions', {
    commune_id, type: 'suspension', fiche_id, motif, precision, jusqu_au: jusqu, decide_par, auteur_prevenu: prevenu,
  });
  return { ok: true, jusqu_au: jusqu, auteur_prevenu: prevenu };
}

export async function leverSuspension(env: any, commune_id: string, decide_par: string, fiche_id: string) {
  await supabaseUpdate(env, 'annuaire', { publications_suspendues_jusqu: null, publications_suspension_motif: null }, {
    id: `eq.${fiche_id}`, commune_id: `eq.${commune_id}`,
  });
  await supabaseInsert(env, 'moderation_decisions', { commune_id, type: 'fin_suspension', fiche_id, decide_par });
}

// « Masquer chez nous » : une publication partagée par une AUTRE commune disparaît de « Autour de
// moi » pour les habitants de cette commune-ci. Aucune écriture dans la commune d'origine (isolation).
export async function masquerPartage(env: any, commune_id: string, masque_par: string, cible: Cible) {
  const table = cible.article_id ? 'articles' : 'events';
  const [pub] = await supabaseSelect(env, table, { select: 'id,commune_id,partage_autour', id: `eq.${cible.article_id ?? cible.event_id}` });
  if (!pub || !pub.partage_autour) return { erreur: 'Publication partagée introuvable', statut: 404 as const };
  if (pub.commune_id === commune_id) return { erreur: 'Cette publication est la vôtre : retirez-la directement', statut: 400 as const };
  const colonne = cible.article_id ? 'article_id' : 'event_id';
  const [deja] = await supabaseSelect(env, 'partages_masques', { select: 'id', commune_id: `eq.${commune_id}`, [colonne]: `eq.${pub.id}` });
  if (!deja) {
    await supabaseInsert(env, 'partages_masques', { commune_id, [colonne]: pub.id, masque_par });
    await supabaseInsert(env, 'moderation_decisions', { commune_id, type: 'masquage_partage', [colonne]: pub.id, decide_par: masque_par });
  }
  return { ok: true };
}

export async function demasquerPartage(env: any, commune_id: string, decide_par: string, cible: Cible) {
  const colonne = cible.article_id ? 'article_id' : 'event_id';
  const id = (cible.article_id ?? cible.event_id) as string;
  await supabaseDelete(env, 'partages_masques', { commune_id: `eq.${commune_id}`, [colonne]: `eq.${id}` });
  await supabaseInsert(env, 'moderation_decisions', { commune_id, type: 'fin_masquage_partage', [colonne]: id, decide_par });
}

// Identifiants masqués par une commune (filtre de « Autour de moi »).
export async function idsPartagesMasques(env: any, commune_id: string | null) {
  if (!commune_id) return { articles: new Set<string>(), events: new Set<string>() };
  const lignes = await supabaseSelect(env, 'partages_masques', { select: 'article_id,event_id', commune_id: `eq.${commune_id}` });
  return {
    articles: new Set<string>(lignes.map((l: any) => l.article_id).filter(Boolean)),
    events: new Set<string>(lignes.map((l: any) => l.event_id).filter(Boolean)),
  };
}

// Historique des décisions (volet « Modération » de la mairie), les plus récentes d'abord.
export async function historiqueDecisions(env: any, commune_id: string) {
  const lignes = await supabaseSelect(env, 'moderation_decisions', {
    select: 'id,type,article_id,event_id,fiche_id,motif,precision,jusqu_au,auteur_prevenu,created_at',
    commune_id: `eq.${commune_id}`, order: 'created_at.desc', limit: '50',
  });
  const ids = (col: string) => [...new Set(lignes.map((l: any) => l[col]).filter(Boolean))] as string[];
  const [articles, events, fiches] = await Promise.all([
    // Titres : publications de la commune, ou partagées par une autre (masquées « chez nous »).
    ids('article_id').length ? supabaseSelect(env, 'articles', { select: 'id,titre', id: `in.(${ids('article_id').join(',')})`, or: `(commune_id.eq.${commune_id},partage_autour.eq.true)` }) : [],
    ids('event_id').length ? supabaseSelect(env, 'events', { select: 'id,titre', id: `in.(${ids('event_id').join(',')})`, or: `(commune_id.eq.${commune_id},partage_autour.eq.true)` }) : [],
    ids('fiche_id').length ? supabaseSelect(env, 'annuaire', { select: 'id,nom', commune_id: `eq.${commune_id}`, id: `in.(${ids('fiche_id').join(',')})` }) : [],
  ]);
  const titre = (liste: any[], id: string | null, champ = 'titre') => (id ? liste.find((x: any) => x.id === id)?.[champ] ?? null : null);
  return lignes.map((l: any) => ({
    ...l,
    motif_libelle: l.motif ? MOTIFS_MODERATION[l.motif as MotifModeration]?.libelle ?? l.motif : null,
    titre: titre(articles, l.article_id) ?? titre(events, l.event_id),
    fiche_nom: titre(fiches, l.fiche_id, 'nom'),
  }));
}
