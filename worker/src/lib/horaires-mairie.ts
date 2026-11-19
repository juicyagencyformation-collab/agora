// worker/src/lib/horaires-mairie.ts
// Horaires d'ouverture des mairies (annuaire service-public, champ plage_ouverture) pour la
// prospection par téléphone : appeler pendant les permanences, et reprogrammer un appel sans
// réponse au prochain créneau d'ouverture. Fonctions pures, toujours à l'heure de Paris (le
// Worker tourne en UTC). Format source vérifié le 2026-11-19 sur de vraies mairies de la Somme :
//   [{"nom_jour_debut":"Lundi","nom_jour_fin":"Jeudi","valeur_heure_debut_1":"08:30:00",
//     "valeur_heure_fin_1":"12:00:00","valeur_heure_debut_2":"","valeur_heure_fin_2":"",...}]

// Clé = jour ISO ("1" = lundi … "7" = dimanche), valeur = créneaux [début, fin] en "HH:MM", triés.
export type HorairesMairie = Record<string, [string, string][]>;

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const indexJour = (nom: unknown) => JOURS.indexOf(String(nom ?? '').trim().toLowerCase()) + 1; // 0 = inconnu

function hhmm(valeur: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(valeur ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

export function parserPlagesOuverture(champJson: string | null | undefined): HorairesMairie | null {
  if (!champJson) return null;
  let plages: any;
  try { plages = JSON.parse(champJson); } catch { return null; }
  if (!Array.isArray(plages)) return null;

  const horaires: HorairesMairie = {};
  for (const p of plages) {
    const debut = indexJour(p?.nom_jour_debut);
    const fin = indexJour(p?.nom_jour_fin) || debut;
    if (!debut || fin < debut) continue; // plage « samedi → lundi » ou jour illisible : ignorée
    const creneaux: [string, string][] = [];
    for (const n of [1, 2]) {
      const a = hhmm(p[`valeur_heure_debut_${n}`]);
      const b = hhmm(p[`valeur_heure_fin_${n}`]);
      if (a && b && a < b) creneaux.push([a, b]);
    }
    for (let j = debut; j <= fin && creneaux.length; j++) (horaires[j] ??= []).push(...creneaux);
  }
  for (const j of Object.keys(horaires)) horaires[j].sort((x, y) => x[0].localeCompare(y[0]));
  return Object.keys(horaires).length ? horaires : null;
}

// Date, jour ISO et heure à Paris (heure d'été / d'hiver gérées par Intl).
export function maintenantParis(date = new Date()): { dateIso: string; jour: number; heure: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    dateIso: `${v('year')}-${v('month')}-${v('day')}`,
    jour: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(v('weekday')) + 1,
    heure: `${v('hour')}:${v('minute')}`,
  };
}

export function ajouterJours(dateIso: string, jours: number): string {
  const d = new Date(dateIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

const jourIsoDe = (dateIso: string) => ((new Date(dateIso + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;

// Prochain jour du lundi au vendredi strictement après dateIso (repli sans horaires connus).
export function prochainJourOuvre(dateIso: string): string {
  let d = ajouterJours(dateIso, 1);
  while (jourIsoDe(d) > 5) d = ajouterJours(d, 1);
  return d;
}

// Début du prochain créneau STRICTEMENT après maintenant (un créneau déjà entamé ne compte pas :
// on vient justement d'appeler sans réponse).
export function prochaineOuverture(horaires: HorairesMairie, maintenant = new Date()): { date: string; heure: string } | null {
  const { dateIso, jour, heure } = maintenantParis(maintenant);
  for (let i = 0; i <= 7; i++) {
    const j = ((jour - 1 + i) % 7) + 1;
    const creneau = (horaires[j] || []).find(([debut]) => i > 0 || debut > heure);
    if (creneau) return { date: ajouterJours(dateIso, i), heure: creneau[0] };
  }
  return null;
}

// "08:30" → "8 h 30", "14:00" → "14 h"
export function formaterHeure(h: string): string {
  const [hh, mm] = h.split(':');
  return `${Number(hh)} h${mm && mm !== '00' ? ' ' + mm : ''}`;
}

// "2026-11-20" → "jeudi 20/11"
export function formaterDateCourte(dateIso: string): string {
  const [, m, d] = dateIso.split('-');
  return `${JOURS[jourIsoDe(dateIso) - 1]} ${d}/${m}`;
}

export type EtatOuverture = {
  ouvert: boolean;
  jusqua: string | null;
  prochaine: { date: string; heure: string } | null;
  libelle: string;
};

export function etatOuverture(horaires: HorairesMairie | null | undefined, maintenant = new Date()): EtatOuverture | null {
  if (!horaires) return null;
  const { dateIso, jour, heure } = maintenantParis(maintenant);
  const enCours = (horaires[jour] || []).find(([a, b]) => a <= heure && heure < b);
  const prochaine = prochaineOuverture(horaires, maintenant);
  let libelle = 'Fermée';
  if (enCours) libelle = `Ouverte jusqu'à ${formaterHeure(enCours[1])}`;
  else if (prochaine) {
    const quand = prochaine.date === dateIso ? "aujourd'hui"
      : prochaine.date === ajouterJours(dateIso, 1) ? 'demain'
        : formaterDateCourte(prochaine.date).split(' ')[0];
    libelle = `Fermée · ouvre ${quand} à ${formaterHeure(prochaine.heure)}`;
  }
  return { ouvert: !!enCours, jusqua: enCours?.[1] ?? null, prochaine, libelle };
}

// "Lun–Jeu 8 h 30–12 h, 13 h 30–18 h · Ven 8 h 30–12 h" (jours consécutifs identiques regroupés)
export function resumerHoraires(horaires: HorairesMairie | null | undefined): string | null {
  if (!horaires) return null;
  const texte = (j: number) => (horaires[j] || []).map(([a, b]) => `${formaterHeure(a)}–${formaterHeure(b)}`).join(', ');
  const groupes: string[] = [];
  let j = 1;
  while (j <= 7) {
    const t = texte(j);
    if (!t) { j++; continue; }
    let fin = j;
    while (fin < 7 && texte(fin + 1) === t) fin++;
    groupes.push(`${JOURS_COURTS[j - 1]}${fin > j ? '–' + JOURS_COURTS[fin - 1] : ''} ${t}`);
    j = fin + 1;
  }
  return groupes.join(' · ');
}
