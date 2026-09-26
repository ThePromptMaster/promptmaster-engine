/**
 * The action registry exists twice — here for performing, in
 * backend/promptmaster/agent_actions.py for the planner prompt. A key the
 * planner can choose that the client cannot perform (or the reverse) would be
 * a silent dead end, so the two are compared field by field.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AGENT_ACTIONS } from './actions';

const PY = readFileSync(join(process.cwd(), '..', 'backend', 'promptmaster', 'agent_actions.py'), 'utf8');

function pythonActions() {
  const out: { key: string; family: string; important: boolean }[] = [];
  const re = /AgentAction\(\s*key="([a-z_]+)",\s*family="([a-z]+)",([\s\S]*?)\)(?=,\s*(?:#[^\n]*\n\s*)*(?:AgentAction|\]))/g;
  for (const m of PY.matchAll(re)) out.push({ key: m[1], family: m[2], important: /important=True/.test(m[3]) });
  return out;
}

describe('agent action registry drift', () => {
  it('parses the Python registry', () => {
    expect(pythonActions().length).toBeGreaterThan(10);
  });

  it('has the same keys, in the same order, with the same family and importance', () => {
    expect(AGENT_ACTIONS.map(({ key, family, important }) => ({ key, family, important }))).toEqual(pythonActions());
  });

  it('agrees on which moves are reasoning', () => {
    const block = PY.slice(PY.indexOf('REASONING_ACTIONS'));
    const py = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    const ts = AGENT_ACTIONS.filter((a) => a.performer === 'reason').map((a) => a.key).sort();
    expect(ts).toEqual(py);
  });
});
