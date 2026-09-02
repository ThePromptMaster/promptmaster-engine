import { createClient } from './client';

export interface UserPreset {
  id: string;
  type: 'constraint' | 'format';
  label: string;
}

const LOCAL_STORAGE_KEY = 'pm-custom-presets';

// --- Supabase CRUD (authenticated users) ---

export async function listPresets(
  type?: 'constraint' | 'format'
): Promise<UserPreset[]> {
  const supabase = createClient();
  let query = supabase
    .from('user_presets')
    .select('id, type, label')
    .order('created_at', { ascending: true });

  if (type) {
    query = query.eq('type', type);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as UserPreset[];
}

export async function addPreset(
  type: 'constraint' | 'format',
  label: string,
  userId: string
): Promise<UserPreset> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('user_presets')
    .insert({ user_id: userId, type, label })
    .select('id, type, label')
    .single();

  if (error) throw error;
  return data as UserPreset;
}

// Unwired: no caller. Only removeLocalPreset is hooked up, so a signed-in user
// can add a preset but cannot delete it from Supabase. Kept — the fix is to wire
// this in, not to delete it.
export async function deletePreset(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('user_presets')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// --- localStorage fallback (unauthenticated users) ---

interface LocalPresets {
  constraint: string[];
  format: string[];
}

function getLocalPresets(): LocalPresets {
  if (typeof window === 'undefined') return { constraint: [], format: [] };
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return { constraint: [], format: [] };
    return JSON.parse(raw) as LocalPresets;
  } catch {
    return { constraint: [], format: [] };
  }
}

function saveLocalPresets(presets: LocalPresets): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(presets));
}

export function listLocalPresets(type: 'constraint' | 'format'): string[] {
  return getLocalPresets()[type];
}

export function addLocalPreset(type: 'constraint' | 'format', label: string): void {
  const presets = getLocalPresets();
  if (!presets[type].includes(label)) {
    presets[type].push(label);
    saveLocalPresets(presets);
  }
}

export function removeLocalPreset(type: 'constraint' | 'format', label: string): void {
  const presets = getLocalPresets();
  presets[type] = presets[type].filter((p) => p !== label);
  saveLocalPresets(presets);
}
