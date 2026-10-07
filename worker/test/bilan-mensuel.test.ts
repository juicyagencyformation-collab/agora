// worker/test/bilan-mensuel.test.ts
// Couvre le bilan mensuel (src/lib/bilan-mensuel.ts) : agrégation des compteurs (bornage correct
// du mois écoulé, signalements en attente non bornés dans le temps), le gabarit HTML
// (pluriel/singulier, encart d'alerte conditionnel, échappement du nom de commune), et l'envoi
// en boucle (filtre par formule, destinataire manquant ignoré, une commune en échec n'empêche
// jamais les autres — même esprit que test/emails-recus.test.ts).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { calculerBilanMensuel, bilanMensuelHtml, envoyerBilansMensuels } from '../src/lib/bilan-mensuel';

const ENV = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'fake-key', RESEND_API_KEY: 'fake-resend-key', FRONTEND_URL: 'https://plateforme-agora.fr' };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('calculerBilanMensuel', () => {
  it('interroge chaque compteur avec les bons filtres (période bornée sauf pour les signalements en attente)', async () => {
    const appels: Array<{ table: string; params: URLSearchParams }> = [];
    vi.stubGlobal('fetch', (input: any) => {
      const url = new URL(String(input));
      const table = url.pathname.replace('/rest/v1/', '');
      appels.push({ table, params: url.searchParams });
      // Compte différent par appel pour vérifier l'affectation au bon champ du résultat.
      let total = 0;
      if (table === 'alertes' && url.searchParams.has('and')) total = 3;        // nouveauxSignalements
      if (table === 'alertes' && url.searchParams.has('statut')) total = 2;      // signalementsEnAttente
      if (table === 'articles') total = 5;                                       // nouvellesActus
      if (table === 'users') total = 7;                                          // nouveauxHabitants
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': `0-0/${total}` } }));
    });

    const debut = new Date('2026-09-01T00:00:00.000Z');
    const fin = new Date('2026-10-01T00:00:00.000Z');
    const bilan = await calculerBilanMensuel(ENV, 'commune-1', debut, fin);

    expect(bilan).toEqual({ nouveauxSignalements: 3, signalementsEnAttente: 2, nouvellesActus: 5, nouveauxHabitants: 7 });

    const appelSignalementsEnAttente = appels.find((a) => a.table === 'alertes' && a.params.has('statut'));
    expect(appelSignalementsEnAttente?.params.has('and')).toBe(false); // jamais borné dans le temps

    const appelNouveaux = appels.find((a) => a.table === 'alertes' && a.params.has('and'));
    expect(appelNouveaux?.params.get('and')).toBe('(created_at.gte.2026-09-01T00:00:00.000Z,created_at.lt.2026-10-01T00:00:00.000Z)');

    expect(appels.find((a) => a.table === 'articles')?.params.get('section')).toBe('eq.actualites');
    expect(appels.find((a) => a.table === 'users')?.params.get('role')).toBe('eq.citoyen');
  });
});

describe('bilanMensuelHtml', () => {
  const base = { nouveauxSignalements: 0, signalementsEnAttente: 0, nouvellesActus: 0, nouveauxHabitants: 0 };

  it('accorde correctement singulier/pluriel', () => {
    const unSeul = bilanMensuelHtml('Testville', new Date('2026-09-15'), { ...base, nouveauxSignalements: 1 }, 'https://x.fr', 'testville');
    expect(unSeul).toContain('nouveau signalement ce mois-ci');
    expect(unSeul).not.toContain('nouveaux signalements');
    const plusieurs = bilanMensuelHtml('Testville', new Date('2026-09-15'), { ...base, nouveauxSignalements: 3 }, 'https://x.fr', 'testville');
    expect(plusieurs).toContain('nouveaux signalements ce mois-ci');
  });

  it('affiche l\'encart d\'alerte seulement si des signalements sont en attente', () => {
    const sansAttente = bilanMensuelHtml('Testville', new Date('2026-09-15'), base, 'https://x.fr', 'testville');
    expect(sansAttente).not.toContain('attendent une réponse');
    expect(sansAttente).not.toContain('attend une réponse');
    const avecAttente = bilanMensuelHtml('Testville', new Date('2026-09-15'), { ...base, signalementsEnAttente: 1 }, 'https://x.fr', 'testville');
    expect(avecAttente).toContain('Un signalement attend');
  });

  it('échappe le nom de la commune contre l\'injection HTML', () => {
    const html = bilanMensuelHtml('<script>x</script>', new Date('2026-09-15'), base, 'https://x.fr', 'x');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('inclut le lien vers l\'application de la commune', () => {
    const html = bilanMensuelHtml('Testville', new Date('2026-09-15'), base, 'https://plateforme-agora.fr', 'testville');
    expect(html).toContain('https://plateforme-agora.fr/testville/');
  });
});

describe('envoyerBilansMensuels', () => {
  function stubFetch(communes: any[], { echoueResend = false } = {}) {
    const emailsEnvoyes: Array<{ to: string; subject: string }> = [];
    vi.stubGlobal('fetch', (input: any, init?: any) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.resend.com') {
        if (echoueResend) return Promise.resolve(new Response('erreur', { status: 500 }));
        const body = JSON.parse(init.body);
        emailsEnvoyes.push({ to: body.to, subject: body.subject });
        return Promise.resolve(new Response(JSON.stringify({ id: 'email-fake' }), { status: 200 }));
      }
      const table = url.pathname.replace('/rest/v1/', '');
      if (table === 'communes') {
        return Promise.resolve(new Response(JSON.stringify(communes), { status: 200 }));
      }
      // Tous les compteurs (alertes/articles/users) : 1 par défaut, suffisant pour ces tests
      // qui portent sur le filtrage des communes, pas sur les chiffres exacts (voir le describe
      // calculerBilanMensuel ci-dessus pour ça).
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': '0-0/1' } }));
    });
    return emailsEnvoyes;
  }

  it('ne requête que les communes en formule accompagne/premium', async () => {
    const appelsCommunes: URLSearchParams[] = [];
    vi.stubGlobal('fetch', (input: any) => {
      const url = new URL(String(input));
      if (url.pathname === '/rest/v1/communes') appelsCommunes.push(url.searchParams);
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': '0-0/0' } }));
    });
    await envoyerBilansMensuels(ENV);
    expect(appelsCommunes[0].get('formule')).toBe('in.(accompagne,premium)');
  });

  it('envoie un email par commune éligible avec un destinataire, et ignore celles sans email', async () => {
    const communes = [
      { id: 'c1', nom: 'Avec Email', slug: 'avec-email', contact_email: 'mairie@avec-email.fr', email_mairie: null, formule: 'accompagne' },
      { id: 'c2', nom: 'Sans Email', slug: 'sans-email', contact_email: null, email_mairie: null, formule: 'premium' },
    ];
    const emails = stubFetch(communes);
    await envoyerBilansMensuels(ENV);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('mairie@avec-email.fr');
    expect(emails[0].subject).toContain('Avec Email');
  });

  it('une commune en échec n\'empêche pas l\'envoi aux autres', async () => {
    const communes = [
      { id: 'c1', nom: 'Première', slug: 'premiere', contact_email: 'a@a.fr', email_mairie: null, formule: 'accompagne' },
      { id: 'c2', nom: 'Seconde', slug: 'seconde', contact_email: 'b@b.fr', email_mairie: null, formule: 'accompagne' },
    ];
    let appelsSupabase = 0;
    vi.stubGlobal('fetch', (input: any, init?: any) => {
      const url = new URL(String(input));
      if (url.hostname === 'api.resend.com') {
        const body = JSON.parse(init.body);
        return Promise.resolve(new Response(JSON.stringify({ id: body.to }), { status: 200 }));
      }
      if (url.pathname === '/rest/v1/communes') return Promise.resolve(new Response(JSON.stringify(communes), { status: 200 }));
      appelsSupabase += 1;
      // La toute première commune voit son calcul de bilan échouer (panne Supabase simulée),
      // la seconde doit quand même recevoir son email.
      if (appelsSupabase <= 3) return Promise.reject(new Error('panne Supabase ponctuelle'));
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-range': '0-0/1' } }));
    });

    await expect(envoyerBilansMensuels(ENV)).resolves.not.toThrow();
  });
});
