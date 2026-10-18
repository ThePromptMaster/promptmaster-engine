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
const checkConflicts = vi.fn<(...args: unknown[]) => Promise<{ conflicts: unknown[] }>>(async () => ({ conflicts: [] }));
const recordConflictChoice = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const HELD = { id: 'held-1', status: 'pending', category: 'pending-change:1' };
const holdPendingChange = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => HELD);
const settlePendingChange = vi.fn<(...args: unknown[]) => Promise<unknown>>(async (id) => ({ ...HELD, id, status: 'accepted' }));
const supersedeFact = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}));

vi.mock('@/lib/supabase/facts', () => ({
  supersedeFact: (...args: unknown[]) => supersedeFact(...args),
}));

// PM-24's decision trail is Supabase; here it is the empty trail plus a spy.
// The check itself (findInstructionConflicts) is the real one; only where it
// reads the decision trail from and where it records the answer are stubbed.
vi.mock('@/lib/supabase/recommendations', () => ({
  listRecommendations: vi.fn(async () => []),
  insertRecommendation: vi.fn(),
  recordDecision: vi.fn(),
}));
vi.mock('@/lib/workflow/conflict-trail', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/workflow/conflict-trail')>()),
  recordConflictChoice: (...args: unknown[]) => recordConflictChoice(...args),
  holdPendingChange: (...args: unknown[]) => holdPendingChange(...args),
  settlePendingChange: (...args: unknown[]) => settlePendingChange(...args),
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    chatMessage: (...args: unknown[]) => chatMessage(...args),
    applyToAnswer: (...args: unknown[]) => applyToAnswer(...args),
    saveAsNewVersion: (...args: unknown[]) => saveAsNewVersion(...args),
    checkConflicts: (...args: unknown[]) => checkConflicts(...args),
  },
  ApiError: class ApiError extends Error {},
}));

// The thread persists to conversation_messages; that round trip is not what
// these tests are about, so it is stubbed to an in-memory echo.
const loadStageChat = vi.fn<(projectId: string, stageId: string) => Promise<unknown[]>>(async () => []);
vi.mock('@/lib/supabase/conversation', () => ({
  loadStageChat: (projectId: string, stageId: string) => loadStageChat(projectId, stageId),
  saveStageChatMessage: vi.fn(async (msg: Record<string, unknown>) => ({
    ...msg,
    id: `m${Math.random()}`,
    created_at: '2026-09-09T00:00:00Z',
  })),
  markStageChatApplied: vi.fn(async () => {}),
  markStageChatDiscarded: vi.fn(async () => {}),
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
  await user.click(screen.getByRole('tab', { name: /^ask/i }));
  await user.type(screen.getByLabelText('Ask a question'), text);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
}

async function instruct(text: string, scope: RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: /change it/i }));
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
    await user.click(screen.getByRole('tab', { name: /^ask/i }));
    expect(screen.queryByText('Apply to')).not.toBeInTheDocument();
  });

  it('says in words that it cannot change the document', async () => {
    panel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /^ask/i }));
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
    await user.click(screen.getByRole('tab', { name: /change it/i }));
    await user.click(screen.getByRole('button', { name: /^selection$/i }));

    expect(screen.getByText(/select text in the draft first/i)).toBeInTheDocument();

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
    expect(screen.getByRole('tab', { name: /change it/i })).toBeDisabled();
    expect(screen.getByText(/open the latest version to change it/i)).toBeInTheDocument();
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

describe('PM-24: an instruction that conflicts asks which should control', () => {
  it('stops before any revision, asks, records the answer, and tells the model', async () => {
    checkConflicts.mockResolvedValueOnce({
      conflicts: [{ kind: 'decision', with_id: 'd1', with_text: 'Keep it to one page', explanation: 'A new chapter breaks the one-page decision.' }],
    });
    panel();
    await instruct('Add a whole new chapter.', /whole document/i);

    const prompt = await screen.findByRole('region', { name: 'Which takes priority?' });
    expect(prompt).toHaveTextContent('A new chapter breaks the one-page decision.');
    // One click answers it: the recommended side is the first button.
    expect(screen.getByRole('button', { name: 'Keep your earlier decision (recommended)' })).toBeTruthy();
    expect(applyToAnswer).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Follow the new instruction' }));

    await waitFor(() => expect(applyToAnswer).toHaveBeenCalledTimes(1));
    expect(recordConflictChoice).toHaveBeenCalledWith(expect.objectContaining({ controls: 'new', instruction: 'Add a whole new chapter.' }));
    const history = (applyToAnswer.mock.calls[0][0] as { chat_history: { content: string }[] }).chat_history;
    expect(history.at(-1)!.content).toContain('The user has decided this instruction takes precedence over your earlier decision (Keep it to one page)');
  });

  it('LANTERN (14 Oct): one question about the approval; overriding it is explicit', async () => {
    checkConflicts.mockResolvedValueOnce({
      conflicts: [
        { kind: 'constraint', with_id: '', with_text: 'Use only the provided record as of November 10, 2026.', explanation: 'Later than the record.' },
        {
          kind: 'fact', with_id: 'F2', with_text: 'Only Elena can approve a change.', explanation: 'Elena hasn’t approved this date change.',
          resolution: 'I’ll keep December 18 as the approved target and record Omar’s renewed request as unapproved.',
          keep_label: 'Keep December 18 approved', override_label: 'Treat January 15 as approved', protects_approval: true,
        },
      ],
    });
    panel();
    await instruct('Omar wants January 15 and his request removed from the log.', /whole document/i);
    const prompt = await screen.findByRole('region', { name: 'Which takes priority?' });
    expect(prompt).toHaveTextContent('Elena hasn’t approved this date change. I’ll keep December 18 as the approved target and record Omar’s renewed request as unapproved.');
    expect(prompt.textContent).not.toMatch(/""|My new instruction takes priority/);
    expect(prompt).toHaveTextContent('Also affected (1)');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Treat January 15 as approved' }));
    // Not yet: overriding a recorded approval asks once more.
    expect(screen.getByRole('alertdialog', { name: 'Override the recorded approval?' })).toHaveTextContent('Elena hasn’t approved this date change. Overriding the recorded approval treats the change as approved.');
    expect(applyToAnswer).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Keep December 18 approved (recommended)' }));

    await waitFor(() => expect(applyToAnswer).toHaveBeenCalledTimes(1));
    // The approval kept; the as-of constraint gives way, as recommended.
    expect(recordConflictChoice).toHaveBeenCalledWith(expect.objectContaining({ controls: 'existing' }));
    expect(recordConflictChoice).toHaveBeenCalledWith(expect.objectContaining({ controls: 'new' }));
    const history = (applyToAnswer.mock.calls[0][0] as { chat_history: { content: string }[] }).chat_history;
    expect(history.at(-1)!.content).toContain('record Omar’s renewed request as unapproved');
  });

  it('Cancel sends nothing and gives the instruction back', async () => {
    checkConflicts.mockResolvedValueOnce({
      conflicts: [{ kind: 'objective', with_id: '', with_text: 'the objective', explanation: 'x' }],
    });
    panel();
    await instruct('Rewrite it for adults.', /whole document/i);
    await screen.findByRole('region', { name: 'Which takes priority?' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(applyToAnswer).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Give a revision instruction')).toHaveValue('Rewrite it for adults.');
  });

  it('NORTHSTAR-2 (16 Oct): the change is held while the question is open, and settled by the answer', async () => {
    checkConflicts.mockResolvedValueOnce({
      conflicts: [{ kind: 'fact', with_id: 'F7', with_text: 'Cedar may train two days after testing.', explanation: 'This withdraws the Cedar exception.' }],
    });
    panel();
    await instruct('Withdraw the Cedar exception, effective March 6.', /whole document/i);
    await screen.findByRole('region', { name: 'Which takes priority?' });
    expect(holdPendingChange).toHaveBeenCalledWith(expect.objectContaining({ instruction: 'Withdraw the Cedar exception, effective March 6.', stageId: 'objective' }));
    await waitFor(() => expect(holdPendingChange).toHaveBeenCalledTimes(1));

    await userEvent.setup().click(screen.getByRole('button', { name: /^Follow the new instruction/ }));
    await waitFor(() => expect(settlePendingChange).toHaveBeenCalledWith('held-1', 'applied'));
  });

  it('Cancel withdraws the held change', async () => {
    checkConflicts.mockResolvedValueOnce({
      conflicts: [{ kind: 'objective', with_id: '', with_text: 'the objective', explanation: 'x' }],
    });
    panel();
    await instruct('Rewrite it for adults.', /whole document/i);
    await screen.findByRole('region', { name: 'Which takes priority?' });
    await waitFor(() => expect(holdPendingChange).toHaveBeenCalledTimes(1));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(settlePendingChange).toHaveBeenCalledWith('held-1', 'withdrawn'));
  });

  it('"Choose and apply" brings the held question back without asking the model again', async () => {
    const onResumeTaken = vi.fn();
    panel({
      resumeChange: {
        id: 'held-9', stageId: 'objective', instruction: 'Withdraw the Cedar exception.', createdAt: '2026-10-16T23:34:58Z',
        conflicts: [{ kind: 'fact', with_id: 'F7', with_text: 'Cedar exception', explanation: 'This withdraws the Cedar exception.', source: 'model' }],
      },
      onResumeTaken,
    });
    const prompt = await screen.findByRole('region', { name: 'Which takes priority?' });
    expect(prompt).toHaveTextContent('This withdraws the Cedar exception.');
    expect(onResumeTaken).toHaveBeenCalled();
    expect(checkConflicts).not.toHaveBeenCalled();
    expect(holdPendingChange).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: /^Follow the new instruction/ }));
    await waitFor(() => expect(settlePendingChange).toHaveBeenCalledWith('held-9', 'applied'));
    await waitFor(() => expect(applyToAnswer).toHaveBeenCalledTimes(1));
  });

  it('a failed check never blocks the instruction', async () => {
    checkConflicts.mockRejectedValueOnce(new Error('provider down'));
    panel();
    await instruct('Tighten this.', /whole document/i);
    await waitFor(() => expect(applyToAnswer).toHaveBeenCalledTimes(1));
  });
});

// --- a revision that changes an accepted fact (10 Oct, Sean: lunch invitation) ---

describe('a revision that changes an accepted fact', () => {
  const INVITE = 'Join me for lunch on Thursday at 12:30. Bring your own lunch.';
  const facts = [
    { id: 'f1', statement: 'Lunch is Thursday at 12:30.', subject: null, kind: 'fact', source_kind: 'chat', source_ref: {}, retired_at: null, supersedes: null, created_at: '2026-10-10T00:00:00Z' },
    { id: 'f2', statement: 'Under 120 words.', subject: null, kind: 'requirement', source_kind: 'chat', source_ref: {}, retired_at: null, supersedes: null, created_at: '2026-10-10T00:00:00Z' },
  ];
  const project = { ...PROJECT, facts } as unknown as Project;

  beforeEach(() => {
    applyToAnswer.mockResolvedValue({
      iteration: { output: 'Join me for lunch on Wednesday at 1:00 p.m. Bring your own lunch.', summary: 'Moved the lunch.' },
      suggestions: [],
    });
  });

  it('offers to update the facts with the revision, and updates the ticked ones on apply', async () => {
    const onFactsChanged = vi.fn();
    const { appendStageVersion } = panel({ project, content: INVITE, headVersion: { ...HEAD, content: INVITE } as ArtifactVersion, onFactsChanged });
    await instruct('Make it Wednesday at 1:00 p.m., under 70 words.', /whole document/i);

    const card = await screen.findByLabelText('Proposed revision');
    expect(card).toHaveTextContent('This changes 2 accepted facts');
    expect(card).toHaveTextContent('Lunch is Wednesday at 1:00 p.m.');
    expect(card).toHaveTextContent('Under 70 words.');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /apply and record 2 changes/i }));

    await waitFor(() => expect(appendStageVersion).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(supersedeFact).toHaveBeenCalledTimes(2));
    expect(supersedeFact.mock.calls[0]![2]).toBe('Lunch is Wednesday at 1:00 p.m.');
    expect(supersedeFact.mock.calls[1]![2]).toBe('Under 70 words.');
    expect(onFactsChanged).toHaveBeenCalled();
  });

  it('a fact left unticked is kept, with a warning that Go may change the draft back', async () => {
    panel({ project, content: INVITE, headVersion: { ...HEAD, content: INVITE } as ArtifactVersion });
    await instruct('Make it Wednesday at 1:00 p.m., under 70 words.', /whole document/i);
    await screen.findByLabelText('Proposed revision');

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[1]!);
    expect(screen.getByLabelText('Proposed revision')).toHaveTextContent(/may change the draft back/);
    await user.click(screen.getByRole('button', { name: /apply and record 1 change/i }));

    await waitFor(() => expect(supersedeFact).toHaveBeenCalledTimes(1));
    expect(supersedeFact.mock.calls[0]![2]).toBe('Lunch is Wednesday at 1:00 p.m.');
  });
});

// --- one project's thread never shows in another (Sean, 10 Oct, email 6.9) ---

describe('the side chat belongs to its project', () => {
  it('moving to another project with the same stage id clears the thread while the new one loads', async () => {
    loadStageChat.mockImplementation(async (projectId: string) =>
      projectId === 'p1'
        ? [{ id: 'm1', role: 'assistant', content: 'Tariffs are mostly bad for the overall economy.', mode: 'discuss', iteration_number: 1, created_at: '2026-10-01T00:00:00Z' }]
        : new Promise(() => {})
    );
    const props = { stageId: 'final_review', stageLabel: 'Final review', content: CONTENT, headVersion: HEAD };
    const view = render(<ChatPanel project={PROJECT} {...props} />);
    expect(await screen.findByText(/Tariffs are mostly bad/)).toBeInTheDocument();
    view.rerender(<ChatPanel project={{ ...PROJECT, id: 'p2' } as Project} {...props} />);
    await waitFor(() => expect(screen.queryByText(/Tariffs are mostly bad/)).not.toBeInTheDocument());
  });

  it('a reply that comes back after moving to another project is not shown there', async () => {
    loadStageChat.mockImplementation(async () => []);
    let answer: (v: unknown) => void = () => undefined;
    chatMessage.mockImplementation(() => new Promise((r) => { answer = r; }));
    const props = { stageId: 'final_review', stageLabel: 'Final review', content: CONTENT, headVersion: HEAD };
    const view = render(<ChatPanel project={PROJECT} {...props} />);
    await ask('Are tariffs good for the economy?');
    view.rerender(<ChatPanel project={{ ...PROJECT, id: 'p2' } as Project} {...props} />);
    answer({ assistant_message: { content: 'Tariffs are mostly bad for the overall economy.' } });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Tariffs are mostly bad/)).not.toBeInTheDocument();
  });
});

// --- a revision refused because Go saved meanwhile (16 Oct, NORTHSTAR-2) ---

describe('a change refused because the stage moved on', () => {
  it('offers "Apply my change to the new version", which drafts the same instruction again', async () => {
    const { RefusedRevision } = await import('@/lib/workflow/commit-check');
    const appendStageVersion = vi.fn<(stageId: string, name: string, version: NewVersion) => Promise<unknown>>(async () => {
      throw new RefusedRevision('The stage changed while this revision was being made (an earlier Go step was saved meanwhile), so nothing was overwritten');
    });
    panel({ appendStageVersion });
    await instruct('Tighten the opening.', /whole document/i);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /apply as new version/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your change is not applied yet.');
    await user.click(screen.getByRole('button', { name: 'Apply my change to the new version' }));
    await waitFor(() => expect(applyToAnswer).toHaveBeenCalledTimes(2));
    const history = (applyToAnswer.mock.calls[1][0] as { chat_history: { content: string }[] }).chat_history;
    expect(history.at(-1)!.content).toContain('Instruction: Tighten the opening.');
  });
});

describe('a stage that cannot change the deliverable says where it is changed (17 Oct, Sean)', () => {
  it('names the stage and opens it', async () => {
    const onOpen = vi.fn();
    panel({ canInstruct: false, isTable: true, editElsewhere: { label: 'Output', onOpen } });
    expect(screen.getByText(/To change the Output, open it and press Edit this stage\./)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Output' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
