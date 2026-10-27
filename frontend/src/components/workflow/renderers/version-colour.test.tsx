import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const setVersionColourRow = vi.fn(async () => undefined);
vi.mock('@/lib/supabase/versions', async (original) => ({
  ...(await original<typeof import('@/lib/supabase/versions')>()),
  setVersionColour: (...a: unknown[]) => (setVersionColourRow as unknown as (...x: unknown[]) => unknown)(...a),
}));

import { VersionBar } from './stage-chrome';
import { useProjectStore } from '@/stores/project-store';
import type { ArtifactVersion } from '@/types/project';

function version(n: number, over: Partial<ArtifactVersion> = {}): ArtifactVersion {
  return {
    id: `v${n}`, user_id: 'u', project_id: 'p', artifact_id: 'a', version_number: n, parent_version_id: null,
    source_operation: 'generate', instruction: null, system_prompt: null, content: `text ${n}`, model: 'm', mode: 'architect',
    change_summary: null, restored_from_version_id: null, finish_reason: 'stop', user_rating: null,
    continuity_snapshot: null, colour_scheme: 'grey/calm', colour: null, background_colour: null, created_at: '2026-10-26T00:00:00Z', ...over,
  } as ArtifactVersion;
}

describe('choosing a version\'s colours (Sean, 25 and 26 Oct)', () => {
  beforeEach(() => {
    setVersionColourRow.mockClear();
    useProjectStore.setState({ versions: [], stages: { s1: { artifact: null, versions: [version(1), version(2)] } } });
  });

  const bar = (versions: ArtifactVersion[]) => (
    <VersionBar versions={versions} activeVersionId="v2" headVersionId="v2" onSelect={() => {}} onRestore={async () => {}} readOnly={false} />
  );
  const row = (name: string) => within(screen.getByRole('group', { name }));

  it('saves the button colour picked for the version on show, and outlines its pill in it', async () => {
    const { rerender } = render(bar([version(1), version(2)]));
    await userEvent.click(screen.getByRole('button', { name: 'Colour of this version' }));
    await userEvent.click(row('Button').getByRole('button', { name: 'Gold' }));
    expect(setVersionColourRow).toHaveBeenCalledWith('v2', 'gold', 'colour');
    // The store's copy of the version now carries it, wherever it is shown.
    const stored = useProjectStore.getState().stages.s1.versions.find((v) => v.id === 'v2')!;
    expect(stored.colour).toBe('gold');
    rerender(bar([version(1), stored]));
    const pill = screen.getByRole('button', { name: /v2/, pressed: true });
    expect(pill.style.borderColor).toBe('rgb(242, 169, 0)');
    // With no background chosen, the inside follows the button colour.
    expect(pill.getAttribute('data-version-background')).toBe('#f2a900');
  });

  it('a background colour fills the pill while the outline keeps the button colour (Sean, 26 Oct)', async () => {
    useProjectStore.setState({ stages: { s1: { artifact: null, versions: [version(1), version(2, { colour: 'gold' })] } } });
    const { rerender } = render(bar([version(1), version(2, { colour: 'gold' })]));
    await userEvent.click(screen.getByRole('button', { name: 'Colour of this version' }));
    await userEvent.click(row('Background').getByRole('button', { name: 'Navy' }));
    expect(setVersionColourRow).toHaveBeenCalledWith('v2', 'navy', 'background_colour');
    const stored = useProjectStore.getState().stages.s1.versions.find((v) => v.id === 'v2')!;
    expect(stored.background_colour).toBe('navy');
    rerender(bar([version(1), stored]));
    const pill = screen.getByRole('button', { name: /v2/, pressed: true });
    expect(pill.style.borderColor).toBe('rgb(242, 169, 0)');
    expect(pill.getAttribute('data-version-background')).toBe('#1e3a8a');
    expect(pill.getAttribute('style')).toContain('#1e3a8a');
  });

  it('goes back to the colours it was made with, one at a time', async () => {
    render(bar([version(1), version(2, { colour: 'gold', background_colour: 'navy' })]));
    await userEvent.click(screen.getByRole('button', { name: 'Colour of this version' }));
    await userEvent.click(screen.getByRole('button', { name: 'Same as the button' }));
    expect(setVersionColourRow).toHaveBeenCalledWith('v2', null, 'background_colour');
    await userEvent.click(screen.getByRole('button', { name: 'As it was made' }));
    expect(setVersionColourRow).toHaveBeenCalledWith('v2', null, 'colour');
  });
});
