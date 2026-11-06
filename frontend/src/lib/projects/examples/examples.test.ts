import { describe, expect, it } from 'vitest';

import { deliverableStage } from '@/lib/workflow/engine';
import { rendererHoldsItems } from '@/lib/workflow/stage-artifact';
import { validateTemplate } from '@/lib/workflow/validate';
import { en } from '@/lib/i18n/messages/en';
import { MAX_FILE_BYTES } from '@/lib/data/preview';
import { INPUT_LIMITS } from '@/lib/projects/input-limits';

import { EXAMPLE_CARDS } from './cards';
import { EXAMPLES, csvPreview, exampleBySlug, exampleWorkflow } from './index';

const dict = en as Record<string, string>;

describe('the examples', () => {
  it('lists the same examples on the cards and in the catalog', () => {
    expect(EXAMPLES.map((e) => [e.key, e.slug, e.icon])).toEqual(EXAMPLE_CARDS.map((c) => [c.key, c.slug, c.icon]));
    for (const c of EXAMPLE_CARDS) expect(exampleBySlug(c.slug)?.key).toBe(c.key);
    expect(exampleBySlug('nothing-here')).toBeUndefined();
  });

  for (const example of EXAMPLES) {
    describe(example.key, () => {
      const template = exampleWorkflow(example, 'abc123def0');

      it('is a workflow the engine can walk', () => {
        expect(validateTemplate(template)).toEqual([]);
        expect(template.key).toMatch(/^custom_ex_/);
      });

      it('says what done means, and has something to deliver that is not its review', () => {
        expect(template.execution?.success_criterion.trim()).toBeTruthy();
        const deliverable = deliverableStage(template);
        expect(deliverable?.renderer).toBe('prose');
        expect(deliverable?.id).not.toBe(template.stages[0].id);
      });

      it('stops for the user at the end, whatever Go may handle', () => {
        const last = template.stages.at(-1)!;
        expect(last.exit_criteria.some((c) => c.check === 'manual' && c.authority === 'reserved')).toBe(true);
      });

      it('has every word on screen in the dictionary, in the English of the workflow', () => {
        for (const field of ['title', 'blurb', 'gets', 'ownPlaceholder']) {
          expect(dict[`ex.${example.key}.${field}`], field).toBeTruthy();
        }
        const words = `example_${example.key}`;
        expect(dict[`workflow.name.${words}`]).toBe(template.name);
        expect(dict[`template.${words}.description`]).toBe(template.description);
        for (const s of template.stages) {
          expect(dict[`stage.${words}.${s.id}.label`], s.id).toBe(s.label);
          expect(dict[`stage.${words}.${s.id}.short`], s.id).toBe(s.short_label);
          expect(dict[`stage.${words}.${s.id}.guidance`], s.id).toBe(s.entry_guidance);
          for (const c of s.exit_criteria) expect(dict[`tw:${c.label}`], c.label).toBe(c.label);
        }
        expect(dict[`noun.${template.nouns?.deliverable}`]).toBe(template.nouns?.deliverable);
      });

      it('fits the limits a project holds', () => {
        expect(example.project.objective.length).toBeLessThanOrEqual(INPUT_LIMITS.objective);
        expect(example.project.context.length).toBeLessThanOrEqual(INPUT_LIMITS.context);
        expect(example.project.constraints.length).toBeLessThanOrEqual(INPUT_LIMITS.constraints);
        expect(example.project.title.length).toBeLessThanOrEqual(120);
        for (const f of example.files ?? []) expect(f.text.length).toBeLessThan(MAX_FILE_BYTES);
      });

      it('says plainly that the sample is invented, and is written for the first stage', () => {
        expect(example.project.context).toMatch(/invented/i);
        expect(example.prepared.trim().length).toBeGreaterThan(200);
        // The first stage holds prose, which is what the prepared text is.
        expect(rendererHoldsItems(template.stages[0].renderer)).toBe(false);
      });
    });
  }
});

describe('the investment memo sample', () => {
  const memo = exampleBySlug('investment-memo')!;
  const rows = memo.files![0].text.trim().split('\n').slice(1).map((l) => l.split(',').map(Number));

  it('adds up in every year, so what a check finds is the contradiction and not a typo', () => {
    for (const [, revenue, cogs, sga, reported, addbacks, adjusted] of rows) {
      expect(revenue - cogs - sga).toBeCloseTo(reported, 5);
      expect(reported + addbacks).toBeCloseTo(adjusted, 5);
    }
  });

  it('contradicts the teaser where the example says it does', () => {
    const last = rows.at(-1)!;
    const [, revenue, , , reported, addbacks, adjusted, capex, top] = last;
    expect(memo.project.context).toContain('roughly 18%');
    expect(top / revenue).toBeGreaterThan(0.3);
    expect(memo.project.context).toContain('Modest owner add-backs');
    expect(addbacks / adjusted).toBeGreaterThan(0.25);
    expect(memo.project.context).toContain('under 3%');
    expect(capex / revenue).toBeGreaterThan(0.06);
    // On reported EBITDA, cash after capex does not cover interest on 5.0x adjusted at 10.5%.
    expect(reported - capex).toBeLessThan(adjusted * 5 * 0.105);
    expect(adjusted - capex).toBeGreaterThan(adjusted * 5 * 0.105);
  });
});

describe('the business analysis sample', () => {
  const analysis = exampleBySlug('business-analysis')!;
  const rows = analysis.files![0].text.trim().split('\n').slice(1).map((l) => l.split(','));
  const last12 = rows.slice(-12);
  const west = last12.reduce((n, r) => n + Number(r[2]), 0);
  const total = last12.reduce((n, r) => n + Number(r[1]), 0);
  const perOrder = last12.reduce((n, r) => n + Number(r[3]), 0) / west;

  it('has the West well short of the "about 40%" the note claims', () => {
    expect(analysis.project.context).toContain('about 40%');
    expect(west / total).toBeGreaterThan(0.3);
    expect(west / total).toBeLessThan(0.33);
  });

  it('loses money on an own site at today\'s volume, and not on a third party', () => {
    const saving = perOrder - 7.6;
    const ownSite = saving * west - (46_000 * 12 + 68_000);
    const thirdParty = (saving - 1.35) * west;
    expect(ownSite).toBeLessThan(0);
    expect(thirdParty).toBeGreaterThan(300_000);
  });
});

describe('csvPreview', () => {
  it('shows the first rows and says how many more there are', () => {
    expect(csvPreview('a,b\n1,2\n3,4\n5,6\n', 2)).toEqual({ header: ['a', 'b'], rows: [['1', '2'], ['3', '4']], more: 1 });
  });
});
