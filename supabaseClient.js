import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// ---------- guardado genérico tipo clave/valor ----------
export async function kvGet(key) {
  const { data, error } = await supabase
    .from("kv_store")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : null;
}

export async function kvSet(key, value) {
  const { error } = await supabase
    .from("kv_store")
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---------- autenticación con Google ----------
export async function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

// ---------- equipos ----------
function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin caracteres confusos
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createTeam(name) {
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const code = randomCode();
  await kvSet(`team:${id}:meta`, { name, code });
  await kvSet(`invite:${code}`, { teamId: id, teamName: name });
  return { id, name, code };
}

export async function joinTeamByCode(code) {
  const found = await kvGet(`invite:${code}`);
  if (!found) return null;
  return { id: found.teamId, name: found.teamName, code };
}

export async function getUserTeams(uid) {
  const teams = await kvGet(`user:${uid}:teams`);
  return teams || [];
}

export async function saveUserTeams(uid, teams) {
  await kvSet(`user:${uid}:teams`, teams);
}
