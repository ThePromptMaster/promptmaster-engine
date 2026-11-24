import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RAIL_WIDTH, StageRailAside, clampRailWidth, forgetRailChoices, initialRailOpen } from './stage-rail-aside';
import { StageRail } from './stage-rail';
import { projectState } from '@/lib/workflow/engine';
import { RESEARCH_V1 } from '@/lib/workflow/templates/research.v1';

// 24 Nov, Sean: "Can we get a moving thingy to shorten the stage side like the side chat has one
// where you can expand and retract".

describe('clampRailWidth and initialRailOpen', () => {
  it('reads what was stored and holds it between the bounds', () => {
    expect(clampRailWidth('300')).toBe(300);
    expect(clampRailWidth(50)).toBe(RAIL_WIDTH.min);
    expect(clampRailWidth(5000)).toBe(RAIL_WIDTH.max);
    expect(clampRailWidth(null)).toBe(RAIL_WIDTH.initial);
    expect(clampRailWidth('wide')).toBe(RAIL_WIDTH.initial);
  });

  it('is open unless it was pulled in last time', () => {
    expect(initialRailOpen(null)).toBe(true);
    expect(initialRailOpen('1')).toBe(true);
    expect(initialRailOpen('0')).toBe(false);
  });
});

function rail(onSelect = vi.fn()) {
  const state = projectState(RESEARCH_V1, []);
  const second = RESEARCH_V1.stages[1];
  state.stages[second.id] = { ...state.stages[second.id], status: 'stale', stale: { reason: 'The brief changed.' } } as never;
  render(
    <StageRailAside
      header={<div>Research workflow</div>}
      rail={(compact) => <StageRail template={RESEARCH_V1} state={state} nextSuggestedId={null} onSelect={onSelect} compact={compact} />}
    />
  );
  return { onSelect, first: RESEARCH_V1.stages[0], second };
}

const shell = () => document.querySelector('[data-stage-rail]') as HTMLElement;

describe('the stages beside the work', () => {
  beforeEach(() => {
    window.localStorage.clear();
    forgetRailChoices();
  });
  afterEach(() => document.documentElement.style.removeProperty('--pm-rail-w'));

  it('pulls in to a strip of icons that still says each stage and its state, and comes back out', async () => {
    const { onSelect, first, second } = rail();
    expect(shell().dataset.stageRail).toBe('open');
    expect(screen.getByText('Research workflow')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Hide stages' }));
    expect(shell().dataset.stageRail).toBe('collapsed');
    expect(shell().style.width).toBe(`${RAIL_WIDTH.collapsed}px`);
    expect(document.querySelector('[data-rail-compact]')).not.toBeNull();
    expect(screen.queryByText('Research workflow')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('pm.stageRailOpen')).toBe('0');
    // The page header's gutter follows it.
    expect(document.documentElement.style.getPropertyValue('--pm-rail-w')).toBe(`${RAIL_WIDTH.collapsed}px`);

    const here = screen.getByRole('button', { name: new RegExp(first.short_label ?? first.label) });
    expect(here).toHaveAttribute('aria-current', 'step');
    const recheck = screen.getByRole('button', { name: new RegExp(`${second.short_label ?? second.label} · awaiting recheck`) });
    await userEvent.click(recheck);
    expect(onSelect).toHaveBeenCalledWith(second.id);

    await userEvent.click(screen.getByRole('button', { name: 'Show stages' }));
    expect(shell().dataset.stageRail).toBe('open');
    expect(window.localStorage.getItem('pm.stageRailOpen')).toBe('1');
  });

  it('starts pulled in when that was the last choice, at the width last dragged when out', async () => {
    window.localStorage.setItem('pm.stageRailOpen', '0');
    window.localStorage.setItem('pm.stageRailWidth', '320');
    rail();
    expect(shell().dataset.stageRail).toBe('collapsed');
    await userEvent.click(screen.getByRole('button', { name: 'Show stages' }));
    expect(shell().style.width).toBe('320px');
  });

  it('is made wider or narrower from the keyboard, and remembers it', () => {
    rail();
    const handle = screen.getByRole('separator', { name: 'Drag to resize the stages' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(shell().style.width).toBe(`${RAIL_WIDTH.initial + RAIL_WIDTH.step}px`);
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(shell().style.width).toBe(`${RAIL_WIDTH.initial - RAIL_WIDTH.step}px`);
    expect(window.localStorage.getItem('pm.stageRailWidth')).toBe(String(RAIL_WIDTH.initial - RAIL_WIDTH.step));
  });

  it('is dragged wider, held to its bounds', () => {
    rail();
    const handle = screen.getByRole('separator', { name: 'Drag to resize the stages' });
    fireEvent.pointerDown(handle, { clientX: 248 });
    fireEvent.pointerMove(window, { clientX: 348 });
    expect(shell().style.width).toBe('348px');
    fireEvent.pointerMove(window, { clientX: 2000 });
    fireEvent.pointerUp(window);
    expect(shell().style.width).toBe(`${RAIL_WIDTH.max}px`);
    expect(window.localStorage.getItem('pm.stageRailWidth')).toBe(String(RAIL_WIDTH.max));
  });
});
