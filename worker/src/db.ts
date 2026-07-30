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
