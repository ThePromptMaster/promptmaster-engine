import type { Locale } from './locales';
import { translate } from './translate';
import { templateWord } from './templates';
import { shownCheckText } from './check-text';
import type { ProposedRecommendation, RecommendationRationale } from '@/lib/workflow/recommend';

/**
 * A derived suggestion in the interface's language (client, 22 Oct: "Move on
 * to Audience" under "Qué hacer a continuación"). The builder's English is
 * what a row stores and stays as written; this says the same from the
 * structured `shown` it carries. Evaluation-driven rows, which a model wrote,
 * come back as they are.
 */
export interface RecommendationNames {
  /** A stage's full name, by id, in the interface's language. */
  stage: (stageId: string) => string;
  /** The first sentence a stage's guidance opens with, by id, in the interface's language; '' for none. */
  guidance: (stageId: string) => string;
  /** The open work elsewhere, in the interface's language, in the order the builder was given it. */
  elsewhere: readonly string[];
  templateKey?: string | null;
}

export interface ShownRecommendation {
  title: string;
  summary: string;
  rationale: RecommendationRationale;
}

const lowerFirst = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

export function shownRecommendation(
  rec: Pick<ProposedRecommendation, 'title' | 'summary' | 'rationale' | 'shown'>,
  locale: Locale,
  names: RecommendationNames,
  /** For the drift test: say the English through the keys too. */
  force = false
): ShownRecommendation {
  const own = { title: rec.title, summary: rec.summary, rationale: rec.rationale };
  const s = rec.shown;
  if (!s || (locale === 'en' && !force)) return own;
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const word = (text: string) => (locale === 'en' ? text : templateWord(locale, text));
  const stage = names.stage(s.stageId);

  switch (s.rule) {
    case 'setup': {
      // An unknown key comes back as itself: then the field's own name, as the builder writes it.
      const fieldKey = `recx.field.${s.field}`;
      const named = t(fieldKey);
      const shownField = named === fieldKey ? s.field.replace(/_/g, ' ') : named;
      return {
        title: t('recx.setupTitle', { field: shownField }),
        summary: t('recx.setupSummary', { stage }),
        rationale: {
          triggering_issue: t('recx.setupTrigger', { criterion: word(s.criterion), stage }),
          relevant_stage: stage,
          expected_benefit: t('recx.setupBenefit'),
          scope: t('recx.setupScope'),
        },
      };
    }
    case 'blocked': {
      const criterion = word(s.criterion);
      const detail = s.detail ? (locale === 'en' ? s.detail : shownCheckText(locale, s.detail, names.templateKey)) : '';
      return {
        title: t('recx.blockedTitle', { criterion: lowerFirst(criterion) }),
        summary: detail ? t('recx.blockedSummaryDetail', { detail, stage }) : t('recx.blockedSummary', { stage }),
        rationale: {
          triggering_issue: detail ? t('recx.blockedTriggerDetail', { criterion, detail }) : t('recx.blockedTrigger', { criterion }),
          relevant_stage: stage,
          expected_benefit: t('recx.blockedBenefit'),
          scope: t('recx.artifact', { stage }),
        },
      };
    }
    case 'advance':
    case 'finish': {
      const open = s.open.length
        ? t('recx.openNote', { count: s.open.length, list: s.open.map((c) => `"${word(c)}"`).join(', ') })
        : '';
      const elsewhere = names.elsewhere.slice(0, s.elsewhere);
      const still = s.elsewhere ? t('recx.stillOpen', { count: s.elsewhere, list: elsewhere.join('; ') }) : '';
      if (s.rule === 'advance') {
        const target = names.stage(s.nextId);
        const first = names.guidance(s.nextId);
        return {
          title: t('recx.advanceTitle', { stage: target }),
          summary: s.elsewhere
            ? t('recx.requiredDone', { stage, open, still })
            : s.open.length
              ? t('recx.nothingBlocks', { stage, open })
              : t('recx.nothingOutstanding', { stage }),
          rationale: {
            triggering_issue: t('recx.advanceTrigger', { stage }),
            relevant_stage: stage,
            expected_benefit: first ? t('recx.advanceBenefitGuide', { stage: target, first }) : t('recx.advanceBenefit', { stage: target }),
            scope: t('recx.projectScope'),
          },
        };
      }
      return {
        title: s.elsewhere ? t('recx.finishClose', { count: s.elsewhere }) : t('recx.finishTitle'),
        summary: s.elsewhere
          ? t('recx.finishDone', { stage, open, still })
          : s.open.length
            ? t('recx.finishNothingBlocks', { stage, open })
            : t('recx.finishNothing', { stage }),
        rationale: {
          triggering_issue: t('recx.finishTrigger', { stage }),
          relevant_stage: stage,
          expected_benefit: t('recx.finishBenefit'),
          scope: t('recx.projectScope'),
        },
      };
    }
  }
}
