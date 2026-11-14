// worker/src/lib/themes-actus.ts
// Thèmes des actualités : UNE seule liste, lue par la validation des actus (routes/actus.ts) et
// par le journal papier (lib/journal-contenus.ts), qui en fait ses rubriques. Ajouter un thème
// ici le fait apparaître comme rubrique du journal, avec une couleur et un pictogramme par
// défaut (voir RUBRIQUES_JOURNAL). Le frontend garde ses libellés dans articles.js
// (LABELS_CATEGORIE_ARTICLE) : à compléter en même temps.
export const CLES_THEMES_ACTUS = ['vie_village', 'projets_travaux', 'environnement', 'agenda', 'info_pratique'] as const;

export const LIBELLES_THEMES_ACTUS: Record<string, string> = {
  vie_village: 'Vie du village',
  projets_travaux: 'Projets & travaux',
  environnement: 'Environnement',
  agenda: 'Agenda',
  info_pratique: 'Info pratique',
};
