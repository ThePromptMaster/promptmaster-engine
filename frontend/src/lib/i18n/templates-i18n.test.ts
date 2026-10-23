import { describe, expect, it } from 'vitest';

import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { EXPLORATION_V1 } from '@/lib/workflow/templates/exploration.v1';
import { RESEARCH_V1 } from '@/lib/workflow/templates/research.v1';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';
import { en } from './messages/en';
import { groupLabel, stageText, templateDescription } from './templates';

const SYSTEM = [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1, EXPLORATION_V1];

describe('the system workflows in every language (client, 21 Oct)', () => {
  it('has every stage, in the template’s own English', () => {
    const dict = en as Record<string, string>;
    for (const t of SYSTEM) {
      for (const s of t.stages) {
        expect(dict[`stage.${t.key}.${s.id}.label`], `${t.key}.${s.id}`).toBe(s.label);
        expect(dict[`stage.${t.key}.${s.id}.short`], `${t.key}.${s.id}`).toBe(s.short_label);
        expect(dict[`stage.${t.key}.${s.id}.guidance`], `${t.key}.${s.id}`).toBe(s.entry_guidance);
        expect(dict[`group.${s.group}`], s.group).toBeTruthy();
      }
      expect(dict[`template.${t.key}.description`]).toBe(t.description);
    }
  });

  it('shows a system stage translated, and a custom one as written', () => {
    const stage = BOOK_V1.stages.find((s) => s.id === 'audience')!;
    expect(stageText('es', 'book', stage, 'label')).toBe('Público');
    expect(stageText('en', 'book', stage, 'label')).toBe('Audience');
    expect(stageText('fr', 'custom_abc', { ...stage, label: 'Lecteurs' }, 'label')).toBe('Lecteurs');
    expect(templateDescription('pt', 'single_output', 'x')).toContain('entrega');
    expect(groupLabel('fr', 'planning', 'Planning')).toBe('Planification');
  });
});
