/**
 * The side chat, and the one property that would break quietly.
 *
 * FR-08's acceptance criteria are "Selection-based revision creates a
 * recoverable new version" and "Section-level revision can be accepted,
 * discarded, or restored" — so accept, discard and restore are each exercised,
 * and discard is checked for leaving the artifact alone rather than merely
 * being clickable.
 *
 * The mode boundary gets its own tests because it is the failure nobody would
 * notice. A Discuss message that quietly reached an apply endpoint would still
 * look like a working chat: the reply arrives, the panel behaves, and the only
 * symptom is a version the user never asked for, discovered later.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ChatPanel } from './chat-panel';
import type { NewVersion } from '@/lib/supabase/versions';
import type { ArtifactVersion, Project } from '@/types/project';

const chatMessage = vi.fn();
const applyToAnswer = vi.fn();
const saveAsNewVersion = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    chatMessage: (...args: unknown[]) => chatMessage(...args),
    applyToAnswer: (...args: unknown[]) => applyToAnswer(...args),
    saveAsNewVersion: (...args: unknown[]) => saveAsNewVersion(...args),
  },
  ApiError: class ApiError extends Error {},
}));

// The thread persists to conversation_messages; that round trip is not what
// these tests are about, so it is stubbed to an in-memory echo.
vi.mock('@/lib/supabase/conversation', () => ({
  loadStageChat: vi.fn(async () => []),
  saveStageChatMessage: vi.fn(async (msg: Record<string, unknown>) => ({
    ...msg,
    id: `m${Math.random()}`,
    created_at: '2026-09-09T00:00:00Z',
  })),
  markStageChatApplied: vi.fn(async () => {}),
}));

const CONTENT = `# Opening

The case for governing AI-assisted work.

## Why now

Regulators have started asking.
`;

const PROJECT = {
  id: 'p1',
  user_id: 'u1',
  title: 'A field guide',
  objective: 'Explain how to govern AI-assisted work.',
  audience: 'Engineering leads',
  constraints: '',
  output_format: '',
  mode: 'architect',
  model: 'test/model',
  workflow: 'book',
  stage: 'objective',
} as unknown as Project;

const HEAD = {
  id: 'v1',
  version_number: 1,
  content: CONTENT,
} as unknown as ArtifactVersion;

function panel(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  const appendStageVersion =
    vi.fn<(stageId: string, name: string, version: NewVersion) => Promise<unknown>>(
      async () => undefined
    );
  const restoreStageVersion =
    vi.fn<(stageId: string, versionId: string) => Promise<void>>(async () => {});
  render(
    <ChatPanel
      project={PROJECT}
      stageId="objective"
      stageLabel="Objective"
      content={CONTENT}
      headVersion={HEAD}
      appendStageVersion={appendStageVersion}
      restoreStageVersion={restoreStageVersion}
      {...overrides}
    />
  );
  return { appendStageVersion, restoreStageVersion };
}

beforeEach(() => {
  vi.clearAllMocks();
  chatMessage.mockResolvedValue({
    assistant_message: { content: 'It reads as a governance argument, not a prompting one.' },
  });
  applyToAnswer.mockResolvedValue({
    iteration: { output: 'Because the rules changed.', summary: 'Tightened the section.' },
    suggestions: [],
  });
});

async function ask(text: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /discuss/i }));
  await user.type(screen.getByLabelText('Ask a question'), text);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
}

async function instruct(text: string, scope: RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /instruct/i }));
  await user.click(screen.getByRole('button', { name: scope }));
  await user.type(screen.getByLabelText('Give a revision instruction'), text);
  await user.click(screen.getByRole('button', { name: /draft revision/i }));
}

// --- the mode boundary ------------------------------------------------------

describe('Discuss mode cannot touch the artifact', () => {
  it('reaches the chat endpoint and no apply endpoint', async () => {
    panel();
    await ask('Does this suit the audience?');

    await waitFor(() => expect(chatMessage).toHaveBeenCalledTimes(1));
    // The assertion the feature rests on.
    expect(applyToAnswer).not.toHaveBeenCalled();
    expect(saveAsNewVersion).not.toHaveBeenCalled();
  });

  it('never appends a version', async () => {
    const { appendStageVersion } = panel();
    await ask('Does this suit the audience?');

    await waitFor(() =>
      expect(screen.getByText(/reads as a governance argument/i)).toBeInTheDocument()
    );
    expect(appendStageVersion).not.toHaveBeenCalled();
  });

  it('offers no scope picker, because there is nothing to scope', async () => {
    panel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /discuss/i }));
    expect(screen.queryByText('Apply to')).not.toBeInTheDocument();
  });

  it('says in words that it cannot change the document', async () => {
    panel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /discuss/i }));
    // A user who has to infer this from the button label will not infer it.
    expect(screen.getByText(/cannot change your document/i)).toBeInTheDocument();
  });
});

// --- FR-08: accept, discard, restore ---------------------------------------

describe('Instruct mode proposes before it applies', () => {
  it('writes nothing until the proposal is accepted', async () => {
    const { appendStageVersion } = panel();
    await instruct('Tighten this.', /whole document/i);

    await waitFor(() => expect(screen.getByLabelText('Proposed revision')).toBeInTheDocument());
    // FR-09: the scope is shown *before* application.
    expect(appendStageVersion).not.toHaveBeenCalled();
  });

  it('shows the affected scope and the passage it would replace', async () => {
    panel();
    await instruct('Tighten this.', /section/i);

    const card = await screen.findByLabelText('Proposed revision');
    expect(card).toHaveTextContent(/Opening/);
    expect(card).toHaveTextContent(/The case for governing AI-assisted work/);
    expect(card).toHaveTextContent(/Because the rules changed/);
    // The recoverability promise sits at the point of decision.
    expect(card).toHaveTextContent(/can be restored/i);
  });

  it('accepting a section revision appends a new version, spliced in place', async () => {
    const { appendStageVersion } = panel();
    await instruct('Tighten this.', /section/i);
    await screen.findByLabelText('Proposed revision');

    await userEvent.setup().click(screen.getByRole('button', { name: /apply as new version/i }));

    await waitFor(() => expect(appendStageVersion).toHaveBeenCalledTimes(1));
    const [stageId, , version] = appendStageVersion.mock.calls[0]!;
    expect(stageId).toBe('objective');
    expect(version.source_operation).toBe('chat_instruct');
    expect(version.instruction).toBe('Tighten this.');
    // Spliced, not replaced: the rest of the document is still there.
    expect(version.content).toContain('Because the rules changed.');
    expect(version.content).toContain('## Why now');
  });

  it('discarding leaves the artifact untouched', async () => {
    const { appendStageVersion, restoreStageVersion } = panel();
    await instruct('Tighten this.', /section/i);
    await screen.findByLabelText('Proposed revision');

    await userEvent.setup().click(screen.getByRole('button', { name: /discard/i }));

    await waitFor(() =>
      expect(screen.queryByLabelText('Proposed revision')).not.toBeInTheDocument()
    );
    // Nothing was written when it was proposed, so there is nothing to undo.
    expect(appendStageVersion).not.toHaveBeenCalled();
    expect(restoreStageVersion).not.toHaveBeenCalled();
  });

  it('restores the previous version after an accepted revision', async () => {
    const { restoreStageVersion } = panel();
    const user = userEvent.setup();

    await instruct('Tighten this.', /section/i);
    await screen.findByLabelText('Proposed revision');
    await user.click(screen.getByRole('button', { name: /apply as new version/i }));

    const notice = await screen.findByLabelText('Revision applied');
    expect(notice).toHaveTextContent(/previous version is still/i);

    await user.click(screen.getByRole('button', { name: /restore the previous version/i }));
    await waitFor(() => expect(restoreStageVersion).toHaveBeenCalledWith('objective', 'v1'));
  });

  it('sends only the scoped passage to be revised, not the whole document', async () => {
    // This is what makes a selection scope mean anything: the endpoint revises
    // what it is given, and it is given the section.
    panel();
    await instruct('Tighten this.', /section/i);

    await waitFor(() => expect(applyToAnswer).toHaveBeenCalledTimes(1));
    const request = applyToAnswer.mock.calls[0][0];
    expect(request.active_iteration.output).toContain('The case for governing');
    expect(request.active_iteration.output).not.toContain('Regulators have started asking.');
  });

  it('refuses a selection scope until something is selected', async () => {
    panel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /instruct/i }));
    await user.click(screen.getByRole('button', { name: /^selection$/i }));

    expect(screen.getByText(/select text in the artifact first/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Give a revision instruction'), 'Tighten this.');
    // Never silently widened to the whole document.
    expect(screen.getByRole('button', { name: /draft revision/i })).toBeDisabled();
    expect(applyToAnswer).not.toHaveBeenCalled();
  });
});

describe('reading an older version', () => {
  it('will not instruct against it, and says why', async () => {
    // Revising splices into the content it was handed. Instructing while
    // reading version 1 of a stage on version 3 would append a version 4 built
    // from version 1 and silently drop two versions of work.
    panel({ canInstruct: false });
    expect(screen.getByRole('tab', { name: /instruct/i })).toBeDisabled();
    expect(screen.getByText(/open the latest one to revise/i)).toBeInTheDocument();
  });

  it('still allows discussion of it', async () => {
    panel({ canInstruct: false });
    await ask('What was wrong with this draft?');
    await waitFor(() => expect(chatMessage).toHaveBeenCalledTimes(1));
    expect(applyToAnswer).not.toHaveBeenCalled();
  });

  it('cannot be forced into instruct mode by an initialMode', async () => {
    // Derived, not corrected after the fact — there is no render in which the
    // composer offers a power the panel will not honour.
    panel({ canInstruct: false, initialMode: 'instruct' });
    expect(screen.getByLabelText('Ask a question')).toBeInTheDocument();
    expect(screen.queryByText('Apply to')).not.toBeInTheDocument();
  });
});

describe('a stage being browsed rather than worked on', () => {
  it('keeps the thread readable but takes the composer away', () => {
    panel({ readOnly: true });
    expect(screen.getByLabelText('Side chat')).toBeInTheDocument();
    expect(screen.queryByLabelText('Ask a question')).not.toBeInTheDocument();
  });
});
