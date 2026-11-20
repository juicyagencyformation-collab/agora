// frontend/backoffice/js/connexion.js — logique Alpine de la page de connexion staff.
// Double authentification « une fois par jour » (worker/src/backoffice/auth.ts) : le mot de passe
// donne un jeton de connexion en attente, le code reçu par email ouvre la session jusqu'au
// lendemain 5 h. Arrivée avec ?code=1 (api.js, session encore valide mais code du jour expiré) :
// le code est envoyé tout de suite, sans redemander le mot de passe.
function connexionBackoffice() {
  return {
    etape: 'identifiants',
    email: '',
    password: '',
    code: '',
    jeton: null,
    emailMasque: '',
    chargement: false,
    erreur: '',
    async init() {
      if (!new URLSearchParams(location.search).has('code')) return;
      this.chargement = true;
      try {
        this.passerAuCode(await boFetch('/auth/demander-code', { method: 'POST' }));
      } catch (e) {
        // Session réellement expirée (ou plus de cookie) : connexion complète.
        this.erreur = e.status === 401 ? '' : (e.message || '');
      } finally {
        this.chargement = false;
      }
    },
    passerAuCode(reponse) {
      this.jeton = reponse.jeton;
      this.emailMasque = reponse.email_masque;
      this.etape = 'code';
      this.$nextTick(() => this.$refs.code?.focus());
    },
    async connecter() {
      this.erreur = '';
      this.chargement = true;
      try {
        const reponse = await boFetch('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: this.email, password: this.password }),
        });
        if (reponse.double_authentification) this.passerAuCode(reponse);
        else location.href = '/backoffice/';
      } catch (e) {
        this.erreur = e.message || 'Connexion impossible';
      } finally {
        this.chargement = false;
      }
    },
    async validerCode() {
      this.erreur = '';
      this.chargement = true;
      try {
        await boFetch('/auth/login/code', { method: 'POST', body: JSON.stringify({ jeton: this.jeton, code: this.code.replace(/\s/g, '') }) });
        location.href = '/backoffice/';
      } catch (e) {
        this.erreur = e.message || 'Code refusé';
      } finally {
        this.chargement = false;
      }
    },
    async renvoyer() {
      this.erreur = '';
      try {
        await boFetch('/auth/login/renvoyer-code', { method: 'POST', body: JSON.stringify({ jeton: this.jeton }) });
        this.erreur = 'Nouveau code envoyé.';
      } catch (e) {
        this.erreur = e.message || 'Envoi impossible';
      }
    },
  };
}
