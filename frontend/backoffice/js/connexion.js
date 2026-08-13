// frontend/backoffice/js/connexion.js — logique Alpine de la page de connexion staff.
function connexionBackoffice() {
  return {
    email: '',
    password: '',
    chargement: false,
    erreur: '',
    async connecter() {
      this.erreur = '';
      this.chargement = true;
      try {
        await boFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: this.email, password: this.password }),
        });
        location.href = '/backoffice/';
      } catch (e) {
        this.erreur = e.message || 'Connexion impossible';
      } finally {
        this.chargement = false;
      }
    },
  };
}
