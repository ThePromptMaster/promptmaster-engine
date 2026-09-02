import { createClient } from './client';
import type { PromptTemplate, TemplateSummary } from '@/types';

export async function listTemplates(limit = 50): Promise<TemplateSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('templates')
    .select('template_id, name, mode, audience, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as TemplateSummary[];
}

export async function loadTemplate(templateId: string): Promise<PromptTemplate | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('templates')
    .select('data')
    .eq('template_id', templateId)
    .single();

  if (error || !data) return null;
  return data.data as PromptTemplate;
}

// Unwired: no caller. Template *creation* was never built — the UI only lists,
// loads and deletes. Kept because it is the write-half of a live feature, not
// dead code. NOTE: the live schema has no UPDATE policy on templates, so this
// upsert would fail under RLS on conflict; add the policy when wiring it up.
export async function saveTemplate(template: PromptTemplate, userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('templates')
    .upsert({
      user_id: userId,
      template_id: template.template_id,
      name: template.name,
      mode: template.mode,
      audience: template.audience,
      data: template,
    }, { onConflict: 'user_id,template_id' });

  if (error) throw error;
}

export async function deleteTemplate(templateId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('template_id', templateId);

  if (error) throw error;
}
