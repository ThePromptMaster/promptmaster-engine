import { describe, expect, it } from 'vitest';

import { isSaved, operationLabel } from './labels';

describe('isSaved (C6)', () => {
  it('keeps what the user chose and hides what the app produced on the way', () => {
    for (const op of ['stage_edit', 'applied_findings', 'applied_recommendations', 'chat_instruct', 'chat_save', 'restore', 'long_form_complete', 'manuscript_snapshot', 'outline_edit'])
      expect(isSaved(op), op).toBe(true);
    for (const op of ['stage_draft', 'stage_regenerate', 'refine', 'flow_refine_shorter', 'continuation', 'agent_draft', 'agent_revise', 'agent_outline', 'agent_triage', null, undefined])
      expect(isSaved(op), String(op)).toBe(false);
  });
  it('every saved operation has a label of its own', () => {
    for (const op of ['stage_edit', 'applied_findings', 'long_form_complete']) expect(operationLabel(op)).not.toMatch(/_/);
  });
});
