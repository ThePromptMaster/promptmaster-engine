'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api/client';
import { groupingItems, type QuestionGroup, type QueueItem } from '@/lib/agent/user-queue';
import { inputsFrom } from '@/lib/workflow/stage-requests';
import type { Project } from '@/types/project';

// Read once per set of waiting items, for the whole page (12 Nov).
const read = new Map<string, QuestionGroup[]>();
const reading = new Map<string, Promise<void>>();

/** For tests: what was read is forgotten. */
export function forgetQuestionGroups(): void {
  read.clear();
  reading.clear();
}

/**
 * Which of the waiting items one answer would settle together. Asked only
 * while something is shown (`enabled`) and two or more items can share an
 * answer. A failed read groups nothing: the items are asked one by one.
 */
export function useQuestionGroups(project: Project, queue: readonly QueueItem[], enabled: boolean): QuestionGroup[] {
  const [, bump] = useState(0);
  const items = groupingItems(queue);
  const key = enabled && items.length > 1 ? JSON.stringify(items.map((i) => [i.id, i.text])) : '';
  useEffect(() => {
    if (!key || read.has(key)) return;
    let live = true;
    let pending = reading.get(key);
    if (!pending) {
      pending = api
        .agentGroupQuestions({ inputs: inputsFrom(project), items, model: project.model })
        .then((r) => {
          read.set(key, Array.isArray(r?.groups) ? r.groups.filter((g) => Array.isArray(g?.ids) && typeof g?.question === 'string').map((g) => ({ ids: g.ids, question: g.question, choices: Array.isArray(g.choices) ? g.choices : [] })) : []);
        })
        .catch(() => {
          read.set(key, []);
        })
        .finally(() => {
          reading.delete(key);
        });
      reading.set(key, pending);
    }
    void pending.then(() => {
      if (live) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
    // The items are named by the key: the same items with the same words are the same read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key ? read.get(key) ?? [] : [];
}
