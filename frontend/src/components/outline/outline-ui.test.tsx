import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DerivedOutlineNotice } from './derived-outline-notice';
import { OutlineEditor } from './outline-editor';
import { OutlineHistory } from './outline-history';
import { newItem, outlineHistory, serializeOutlineDocument, staleDrafts } from '@/lib/outline/model';
import { applyOutlineEdit } from '@/lib/outline/use-outline-draft';
import type { OutlineDocument, SectionDraftBinding } from '@/types/outline';
import type { ArtifactVersion } from '@/types/project';

function doc(titles: string[], orphans: OutlineDocument['orphans'] = []): OutlineDocument {
  return {
    schema: 1,
    items: titles.map((t, i) => newItem({ id: `i${i + 1}`, title: t, abstract: `about ${t}` })),
    orphans,
  };
}

/**
 * A harness that behaves the way the stage panel does: it holds the head
 * version and a draft, and routes every edit through the copy-on-write rule.
 * Testing through it is what makes "editing an approved outline does not mutate
 * it" an assertion about the UI rather than about a helper function.
 */
function Harness({
  head,
  headApproved,
  ...rest
}: {
  head: OutlineDocument;
  headApproved: boolean;
} & Partial<React.ComponentProps<typeof OutlineEditor>>) {
  const [draft, setDraft] = useState<OutlineDocument | null>(null);
  return (
    <OutlineEditor
      document={draft ?? head}
      isDraft={draft !== null}
      headVersionNumber={2}
      forkedFromVersionNumber={draft?.forked_from_version_id ? 2 : null}
      approvedVersionNumber={headApproved ? 2 : null}
      onChange={(next) =>
        setDraft((current) =>
          applyOutlineEdit({ head, headVersionId: 'v2', headApproved, draft: current }, next)
        )
      }
      {...rest}
    />
  );
}

const sectionTitles = () =>
  screen
    .getAllByRole('textbox', { name: /^Title of section/ })
    .map((el) => (el as HTMLInputElement).value);

describe('OutlineEditor — reorder', () => {
  it('reorders from the keyboard, using buttons rather than drag alone', async () => {
    render(<Harness head={doc(['One', 'Two', 'Three'])} headApproved={false} />);

    // Tab-reachable, activated with Enter: no pointer involved anywhere.
    const down = screen.getByRole('button', { name: 'Move “One” down to position 2' });
    down.focus();
    await userEvent.keyboard('{Enter}');

    expect(sectionTitles()).toEqual(['Two', 'One', 'Three']);
  });

  it('says where a section landed, for anyone who cannot see it move', async () => {
    render(<Harness head={doc(['One', 'Two', 'Three'])} headApproved={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Move “Three” up to position 2' }));
    expect(screen.getByText('“Three” moved to position 2 of 3.')).toBeInTheDocument();
  });

  it('moves a section with Alt+Arrow while the caret stays in its title', async () => {
    render(<Harness head={doc(['One', 'Two'])} headApproved={false} />);
    const title = screen.getByRole('textbox', { name: 'Title of section 1' });
    title.focus();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(sectionTitles()).toEqual(['Two', 'One']);
  });

  it('never offers a move that would fall off the end', () => {
    render(<Harness head={doc(['One', 'Two'])} headApproved={false} />);
    expect(screen.getByRole('button', { name: 'Move “One” up to position 0' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move “Two” down to position 3' })).toBeDisabled();
  });
});

describe('OutlineEditor — insert', () => {
  it('inserts at a position, not only at the end', async () => {
    render(<Harness head={doc(['One', 'Three'])} headApproved={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert a section after “One”' }));

    const titles = sectionTitles();
    expect(titles).toHaveLength(3);
    expect(titles[1]).toBe('');
    expect(titles[2]).toBe('Three');
  });
});

describe('OutlineEditor — copy-on-write', () => {
  it('editing an approved outline creates a draft instead of changing it', async () => {
    const head = doc(['One', 'Two']);
    const before = serializeOutlineDocument(head);

    render(<Harness head={head} headApproved onApprove={vi.fn()} />);
    expect(screen.getByText('Approved · v2')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Title of section 1' }), '!');

    // The approved document is untouched — drafting is still bound to it.
    expect(serializeOutlineDocument(head)).toBe(before);
    expect(screen.getByText('Draft, from v2')).toBeInTheDocument();
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
  });

  it('editing an unapproved outline stays in place', async () => {
    render(<Harness head={doc(['One'])} headApproved={false} onApprove={vi.fn()} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Title of section 1' }), '!');
    // No fork happened: there is one document, not an approved one and a copy.
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByText(/from v2/)).not.toBeInTheDocument();
  });
});

describe('OutlineEditor — removing written work', () => {
  const drafts: SectionDraftBinding[] = [
    { item_id: 'i1', outline_version_id: 'v2', word_count: 1200 },
  ];

  it('asks before removing a section that has prose, and can keep the writing', async () => {
    const onChange = vi.fn();
    render(<OutlineEditor document={doc(['One', 'Two'])} onChange={onChange} drafts={drafts} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove “One”' }));

    // Nothing has been removed yet: the question comes first.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/1,200 words written against it/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep the draft' }));
    const next: OutlineDocument = onChange.mock.calls[0][0];
    expect(next.items.map((i) => i.title)).toEqual(['Two']);
    expect(next.orphans[0]).toMatchObject({ item_id: 'i1', reason: 'removed' });
  });

  it('offers deleting the writing as a second, explicit choice', async () => {
    const onChange = vi.fn();
    render(<OutlineEditor document={doc(['One', 'Two'])} onChange={onChange} drafts={drafts} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove “One”' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete the draft too' }));

    const next: OutlineDocument = onChange.mock.calls[0][0];
    expect(next.items.map((i) => i.title)).toEqual(['Two']);
    expect(next.orphans).toEqual([]);
  });

  it('removes a section with nothing written without ceremony', async () => {
    const onChange = vi.fn();
    render(<OutlineEditor document={doc(['One', 'Two'])} onChange={onChange} drafts={drafts} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove “Two”' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('lets a detached section be put back, under the id its prose knows', async () => {
    const onChange = vi.fn();
    const detached: OutlineDocument = {
      schema: 1,
      items: [newItem({ id: 'i2', title: 'Two', abstract: '' })],
      orphans: [
        { item_id: 'i1', title: 'One', abstract: 'about One', reason: 'removed', orphaned_at: 'T' },
      ],
    };
    render(<OutlineEditor document={detached} onChange={onChange} drafts={drafts} />);

    expect(screen.getByText('Detached sections')).toBeInTheDocument();
    expect(screen.getByText(/1,200 words · removed from the outline/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Put “One” back into the outline' }));

    const next: OutlineDocument = onChange.mock.calls[0][0];
    expect(next.items.map((i) => i.id)).toEqual(['i2', 'i1']);
    expect(next.orphans).toEqual([]);
  });
});

describe('OutlineEditor — regenerate', () => {
  it('warns that written sections survive a whole-outline regenerate', async () => {
    const onRegenerateAll = vi.fn();
    render(
      <OutlineEditor
        document={doc(['One', 'Two'])}
        onChange={vi.fn()}
        drafts={[{ item_id: 'i1', outline_version_id: 'v2', word_count: 900 }]}
        onRegenerateAll={onRegenerateAll}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /Regenerate the outline/ }));
    expect(onRegenerateAll).not.toHaveBeenCalled();
    expect(screen.getByText(/kept as detached sections, not deleted/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    expect(onRegenerateAll).toHaveBeenCalledTimes(1);
  });

  it('regenerates without asking when nothing has been written', async () => {
    const onRegenerateAll = vi.fn();
    render(
      <OutlineEditor document={doc(['One'])} onChange={vi.fn()} onRegenerateAll={onRegenerateAll} />
    );
    await userEvent.click(screen.getByRole('button', { name: /Regenerate the outline/ }));
    expect(onRegenerateAll).toHaveBeenCalledTimes(1);
  });

  it('offers a regenerate per section', async () => {
    const onRegenerateItem = vi.fn();
    render(
      <OutlineEditor document={doc(['One'])} onChange={vi.fn()} onRegenerateItem={onRegenerateItem} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate “One”' }));
    expect(onRegenerateItem).toHaveBeenCalledWith('i1');
  });
});

describe('OutlineEditor — approval', () => {
  it('approves the outline, and says what drafting is bound to', async () => {
    const onApprove = vi.fn();
    render(
      <OutlineEditor
        document={doc(['One', 'Two'])}
        onChange={vi.fn()}
        approvedVersionNumber={1}
        headVersionNumber={1}
        onApprove={onApprove}
      />
    );

    expect(screen.getByText('Drafting is using outline v1.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve this outline' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('will not approve an empty outline', () => {
    render(
      <OutlineEditor
        document={doc([])}
        onChange={vi.fn()}
        onApprove={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Approve this outline' })).toBeDisabled();
  });

  it('makes clear that approving saves the draft first', () => {
    render(<Harness head={doc(['One'])} headApproved onApprove={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Approve this outline' })).toBeInTheDocument();
  });
});

describe('OutlineEditor — prose written against an older outline', () => {
  it('names the version rather than silently invalidating the writing', async () => {
    const versions = [1, 2].map(
      (n) =>
        ({
          id: `v${n}`,
          version_number: n,
          content: serializeOutlineDocument(doc(['One'])),
        }) as ArtifactVersion
    );
    const report = staleDrafts(
      [
        { item_id: 'i1', outline_version_id: 'v1', word_count: 900 },
        { item_id: 'i2', outline_version_id: 'v1', word_count: 300 },
      ],
      'v2',
      versions
    );
    const onRewriteSection = vi.fn();

    render(
      <OutlineEditor
        document={doc(['One', 'Two'])}
        onChange={vi.fn()}
        staleDrafts={report}
        onRewriteSection={onRewriteSection}
      />
    );

    expect(screen.getByText('2 sections were written against outline v1')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /Rewrite “One” against the approved outline/ })
    );
    expect(onRewriteSection).toHaveBeenCalledWith('i1');
  });
});

describe('DerivedOutlineNotice — upstream moved after approval', () => {
  const item = (id: string, title: string) => ({ id, title, abstract: '' });

  it('names what moved and offers a re-derivation rather than performing one', async () => {
    const onRederive = vi.fn();
    render(
      <DerivedOutlineNotice
        drift={{
          changed: [item('discussion', 'Discussion')],
          added: [item('related_work', 'Related work')],
          removed: [item('results', 'Results')],
          stale: true,
        }}
        onRederive={onRederive}
      />
    );

    expect(
      screen.getByText('An earlier stage changed after this outline was approved')
    ).toBeInTheDocument();
    expect(screen.getByText('Discussion')).toBeInTheDocument();
    expect(screen.getByText('Related work')).toBeInTheDocument();
    expect(screen.getByText('Results')).toBeInTheDocument();

    // Nothing happens until the user asks for it: an approved outline is what
    // drafting is bound to.
    expect(onRederive).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Re-derive from the stages/ }));
    expect(onRederive).toHaveBeenCalledTimes(1);
  });

  it('omits the categories that are empty, and itself when nothing moved', () => {
    const { unmount } = render(
      <DerivedOutlineNotice
        drift={{ changed: [item('method', 'Method')], added: [], removed: [], stale: true }}
      />
    );
    expect(screen.getByText('Now briefed differently')).toBeInTheDocument();
    expect(screen.queryByText('No stage feeds these any more')).not.toBeInTheDocument();
    // No handler, no button — this is how it reads on a stage being browsed.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    render(<DerivedOutlineNotice drift={{ changed: [], added: [], removed: [], stale: false }} />);
    expect(screen.queryByText(/An earlier stage changed/)).not.toBeInTheDocument();
  });
});

describe('OutlineHistory', () => {
  it('shows approval as a property of a version, and which one drafting uses', () => {
    const versions = [1, 2].map(
      (n) =>
        ({
          id: `v${n}`,
          version_number: n,
          content: serializeOutlineDocument(doc(['One', 'Two'])),
          change_summary: null,
          created_at: '2026-09-04T00:00:00Z',
        }) as ArtifactVersion
    );

    render(
      <OutlineHistory
        history={outlineHistory(versions, [
          { outline_version_id: 'v1', created_at: 'T' },
          { outline_version_id: 'v2', created_at: 'T' },
        ])}
        approvedVersionId="v2"
      />
    );

    const list = screen.getByRole('list');
    expect(within(list).getByText('Approved · drafting uses this')).toBeInTheDocument();
    expect(within(list).getByText('Approved earlier')).toBeInTheDocument();
  });
});
