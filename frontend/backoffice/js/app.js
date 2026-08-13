// frontend/backoffice/js/app.js — logique Alpine du tableau de bord backoffice.
function backoffice() {
  return {
    vue: 'communes',      // 'communes' | 'fiche'
    chargement: true,
    staff: { nom: '' },
    apercu: {},
    communes: [],
    fiche: null,

    async init() {
      try {
        const { staff } = await boFetch('/auth/me');
        this.staff = staff;
      } catch {
        redirigerVersConnexion();
        return;
      }
      await this.chargerCommunes();
    },

    async chargerCommunes() {
      this.chargement = true;
      try {
        const [apercu, liste] = await Promise.all([
          boFetch('/administration/apercu'),
          boFetch('/administration/communes'),
        ]);
        this.apercu = apercu;
        this.communes = liste.communes;
      } finally {
        this.chargement = false;
      }
    },

    async ouvrirFiche(id) {
      this.chargement = true;
      this.vue = 'fiche';
      try {
        this.fiche = await boFetch('/administration/communes/' + id);
      } finally {
        this.chargement = false;
      }
    },

    allerCommunes() {
      this.vue = 'communes';
      this.fiche = null;
    },

    async deconnexion() {
      try { await boFetch('/auth/logout', { method: 'POST' }); } catch {}
      location.href = '/backoffice/connexion';
    },

    // — Utilitaires d'affichage —
    classeNote(note) {
      if (note >= 4) return 'bo-note--haute';
      if (note >= 2.5) return 'bo-note--moyenne';
      return 'bo-note--basse';
    },
    formatDate(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    },
    formatOctets(o) {
      if (!o) return '0 o';
      const unites = ['o', 'Ko', 'Mo', 'Go'];
      const i = Math.floor(Math.log(o) / Math.log(1024));
      return Math.round((o / Math.pow(1024, i)) * 10) / 10 + ' ' + unites[i];
    },
  };
}
