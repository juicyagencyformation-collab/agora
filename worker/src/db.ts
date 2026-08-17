// worker/src/db.ts
export async function supabaseSelect(env: any, table: string, filtres: Record<string, string>): Promise<any[]> {
  const params = new URLSearchParams(filtres);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase select ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Compte total de lignes correspondant aux filtres, SANS toutes les charger : PostgREST renvoie
// le total dans l'en-tête Content-Range quand on demande Prefer: count=exact + Range 0-0.
export async function supabaseCount(env: any, table: string, filtres: Record<string, string>): Promise<number> {
  const params = new URLSearchParams({ ...filtres, select: 'id' });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  const contentRange = res.headers.get('content-range'); // ex. "0-0/1234" ou "*/1234"
  const total = contentRange?.split('/')[1];
  return total && total !== '*' ? parseInt(total, 10) : 0;
}

export async function supabaseInsert(env: any, table: string, donnees: object | object[]): Promise<any[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(donnees),
  });
  if (!res.ok) throw new Error(`Supabase insert ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function supabaseUpdate(env: any, table: string, donnees: object, filtres: Record<string, string>): Promise<any[]> {
  const params = new URLSearchParams(filtres);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(donnees),
  });
  if (!res.ok) throw new Error(`Supabase update ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function supabaseDelete(env: any, table: string, filtres: Record<string, string>): Promise<void> {
  const params = new URLSearchParams(filtres);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase delete ${table}: ${res.status} ${await res.text()}`);
}

// Journal d'activité MINIMAL (migration 043) : uniquement les actions à fort impact (palier
// gratuit rétroactif, grille tarifaire, statut d'une commune, anonymisation RGPD, comptes
// staff, facture soldée...). Ne doit JAMAIS faire échouer l'action réelle si l'écriture du
// journal échoue — best-effort, erreur avalée.
export async function journaliser(env: any, staffId: any, action: string, details?: string): Promise<void> {
  try {
    await supabaseInsert(env, 'journal_activite', { staff_id: staffId, action, details: details || null });
  } catch { /* le journal ne doit jamais bloquer l'action réelle */ }
}
