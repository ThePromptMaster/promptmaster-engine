import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    continuity_snapshot: null, colour_scheme: 'grey/calm', colour: null, created_at: '2026-10-26T00:00:00Z', ...over,
  } as ArtifactVersion;
}

describe('choosing a version\'s colour (Sean, 25 Oct)', () => {
  beforeEach(() => {
    setVersionColourRow.mockClear();
    useProjectStore.setState({ versions: [], stages: { s1: { artifact: null, versions: [version(1), version(2)] } } });
  });

  it('saves the colour picked for the version on show, and shows it on its pill', async () => {
    const versions = [version(1), version(2)];
    const { rerender } = render(
      <VersionBar versions={versions} activeVersionId="v2" headVersionId="v2" onSelect={() => {}} onRestore={async () => {}} readOnly={false} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Colour of this version' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gold' }));
    expect(setVersionColourRow).toHaveBeenCalledWith('v2', 'gold');
    // The store's copy of the version now carries it, wherever it is shown.
    const stored = useProjectStore.getState().stages.s1.versions.find((v) => v.id === 'v2')!;
    expect(stored.colour).toBe('gold');
    rerender(
      <VersionBar versions={[version(1), stored]} activeVersionId="v2" headVersionId="v2" onSelect={() => {}} onRestore={async () => {}} readOnly={false} />
    );
    const dot = screen.getByRole('button', { name: /v2/, pressed: true }).querySelector('[data-version-colour]') as HTMLElement;
    expect(dot.style.background).toBe('rgb(242, 169, 0)');
  });

  it('goes back to the colour it was made with', async () => {
    render(
      <VersionBar versions={[version(1), version(2, { colour: 'gold' })]} activeVersionId="v2" headVersionId="v2" onSelect={() => {}} onRestore={async () => {}} readOnly={false} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Colour of this version' }));
    await userEvent.click(screen.getByRole('button', { name: 'As it was made' }));
    expect(setVersionColourRow).toHaveBeenCalledWith('v2', null);
  });
});
