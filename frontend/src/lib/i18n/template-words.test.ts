import { describe, expect, it } from 'vitest';

import { MODE_DISPLAY } from '@/lib/constants';
import { ITEM_SCHEMAS, itemSchemaFor, type StageItemSchema } from '@/lib/workflow/stage-artifact';
import { BOOK_V1 } from '@/lib/workflow/templates/book.v1';
import { EXPLORATION_V1 } from '@/lib/workflow/templates/exploration.v1';
import { ASSESSMENT_V1 } from '@/lib/workflow/templates/assessment.v1';
import { QUICK_V1 } from '@/lib/workflow/templates/quick.v1';
import { RESEARCH_V1 } from '@/lib/workflow/templates/research.v1';
import { SINGLE_OUTPUT_V1 } from '@/lib/workflow/templates/single-output.v1';
import { DECISIONS } from '@/lib/workflow/timeline';
import type { StageDefinition } from '@/lib/workflow/types';
import { shownCheckText } from './check-text';
import { LOCALES } from './locales';
import { DICTIONARIES } from './translate';
import { itemPlural, shownSchema, templateWord } from './templates';

const SYSTEM = [BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1, EXPLORATION_V1, ASSESSMENT_V1, QUICK_V1];
const CODES = LOCALES.map((l) => l.code);

/** Every English word a system workflow puts on screen through `templateWord`. */
function systemWords(): { words: string[]; nouns: string[] } {
  const words = new Set<string>();
  const nouns = new Set<string>();
  const add = (x?: string) => x && x.trim() && words.add(x);
  for (const t of SYSTEM) {
    for (const s of t.stages) {
      for (const c of s.exit_criteria) {
        add(c.label);
        add((c as { hint?: string }).hint);
      }
      s.skip_reasons.forEach(add);
    }
  }
  const walk = (sc: StageItemSchema) => {
    add(sc.itemLabel);
    nouns.add(sc.itemLabel);
    add(sc.decisionQuestion);
    add(sc.defaultStateNote);
    for (const f of sc.fields) {
      add(f.label);
      add(f.hint);
      (f.options ?? []).forEach(add);
    }
    for (const st of sc.statuses ?? []) {
      add(st.label);
      add(st.explain);
    }
  };
  Object.values(ITEM_SCHEMAS).forEach(walk);
  const bare = (renderer: string) => ({ id: 'x', renderer, expected_artifacts: [], exit_criteria: [], skip_reasons: [] }) as unknown as StageDefinition;
  walk(itemSchemaFor(bare('review')));
  walk(itemSchemaFor(bare('list')));
  Object.values(MODE_DISPLAY).forEach((m) => add(m.tagline));
  Object.values(DECISIONS).forEach(add);
  return { words: [...words], nouns: [...nouns] };
}

describe('the system workflows\' table and checklist words in every language (23 Oct)', () => {
  const { words, nouns } = systemWords();

  it('has every criterion, hint, skip reason, column, status, legend, tagline and timeline title', () => {
    for (const locale of CODES) {
      const dict = DICTIONARIES[locale] as Record<string, string>;
      for (const w of words) expect(dict[`tw:${w}`], `${locale}: ${w}`).toBeTruthy();
      for (const n of nouns) expect(dict[`twp:${n}`], `${locale}: plural of ${n}`).toBeTruthy();
    }
  });

  it('keeps every {placeholder} the English has', () => {
    for (const w of words.filter((x) => x.includes('{'))) {
      for (const locale of CODES) {
        const shown = templateWord(locale, w);
        for (const p of w.match(/\{\w+\}/g) ?? []) expect(shown, `${locale}: ${w}`).toContain(p);
      }
    }
  });

  it('shows a table in Spanish without touching its keys or values', () => {
    const schema = ITEM_SCHEMAS.fact_check ?? Object.values(ITEM_SCHEMAS)[0];
    const shown = shownSchema('es', schema);
    expect(shown.fields.map((f) => f.key)).toEqual(schema.fields.map((f) => f.key));
    expect(shown.statuses?.map((s) => s.value)).toEqual(schema.statuses?.map((s) => s.value));
    expect(shownSchema('en', schema)).toBe(schema);
    expect(itemPlural('es', 'claim')).toBe('afirmaciones');
    expect(itemPlural('en', 'claim')).toBe('claims');
    expect(templateWord('fr', 'Every claim has a status')).toBe('Chaque affirmation a un statut');
    expect(templateWord('es', 'Something a user wrote')).toBe('Something a user wrote');
  });

  it('reads the engine\'s English lines back in the interface\'s language', () => {
    expect(shownCheckText('es', '3 of 5')).toBe('3 de 5');
    expect(shownCheckText('fr', 'nothing drafted yet')).toBe('rien de rédigé pour l’instant');
    expect(shownCheckText('es', 'Memo: at most 400 words')).toBe('Memo: como máximo 400 palabras');
    expect(shownCheckText('pt', '12 questions; 3 without an answer')).toBe('12 perguntas; 3 sem resposta');
    expect(shownCheckText('es', 'Audience was changed (now v3) after this stage used it.', 'book', BOOK_V1.stages)).toBe('Público cambió (ahora v3) después de que esta etapa lo usara.');
    expect(shownCheckText('en', '3 of 5')).toBe('3 of 5');
    expect(shownCheckText('es', 'I am done editing')).toBe('He terminado de editar');
  });
});
