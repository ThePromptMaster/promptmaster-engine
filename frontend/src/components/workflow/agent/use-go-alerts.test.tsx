import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stopKind, useGoAlerts } from './use-go-alerts';

type Props = { running: boolean; status: string | null; reason: string | null; projectName: string };
const start: Props = { running: true, status: 'running', reason: null, projectName: 'Rollout' };

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

const shown: { title: string; body?: string }[] = [];
class FakeNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    shown.push({ title, body: options?.body });
  }
  close() {}
}

beforeEach(() => {
  shown.length = 0;
  localStorage.clear();
  FakeNotification.permission = 'granted';
  vi.stubGlobal('Notification', FakeNotification);
  setHidden(false);
  document.title = 'PromptMaster';
});

afterEach(() => vi.unstubAllGlobals());

describe('the browser alert when Go stops (8 Nov)', () => {
  it('says which stops need the user, and which are finished', () => {
    expect(stopKind('awaiting_decision')).toBe('needs_you');
    expect(stopKind('blocked')).toBe('needs_you');
    expect(stopKind('completed')).toBe('finished');
    expect(stopKind('running')).toBeNull();
  });

  it('with the tab hidden and alerts on: an alert and a title marker, and the title returns', async () => {
    localStorage.setItem('pm.go.alerts', 'on');
    const { result, rerender } = renderHook((p: Props) => useGoAlerts(p), { initialProps: start });
    await waitFor(() => expect(result.current.on).toBe(true));
    setHidden(true);
    rerender({ ...start, running: false, status: 'awaiting_decision', reason: 'Needs your approval.' });
    expect(shown).toEqual([{ title: 'Go needs you on Rollout', body: 'Needs your approval.' }]);
    expect(document.title).toBe('Needs you: Rollout');
    act(() => setHidden(false));
    expect(document.title).toBe('PromptMaster');
  });

  it('waits for the run status that lands just after Go stops, and alerts once', () => {
    localStorage.setItem('pm.go.alerts', 'on');
    const { rerender } = renderHook((p: Props) => useGoAlerts(p), { initialProps: start });
    setHidden(true);
    rerender({ ...start, running: false, status: 'running' });
    expect(shown).toEqual([]);
    rerender({ ...start, running: false, status: 'awaiting_decision', reason: 'Needs your approval.' });
    expect(shown).toEqual([{ title: 'Go needs you on Rollout', body: 'Needs your approval.' }]);
    rerender({ ...start, running: false, status: 'awaiting_decision', reason: 'Needs your approval, again.' });
    expect(shown).toHaveLength(1);
  });

  it('with the tab in view nothing fires', () => {
    localStorage.setItem('pm.go.alerts', 'on');
    const { rerender } = renderHook((p: Props) => useGoAlerts(p), { initialProps: start });
    rerender({ ...start, running: false, status: 'completed' });
    expect(shown).toEqual([]);
    expect(document.title).toBe('PromptMaster');
  });

  it('alerts off: the tab title still says it, and no alert is sent', () => {
    const { rerender } = renderHook((p: Props) => useGoAlerts(p), { initialProps: start });
    setHidden(true);
    rerender({ ...start, running: false, status: 'completed' });
    expect(shown).toEqual([]);
    expect(document.title).toBe('Finished: Rollout');
  });

  it('permission is asked on the click, and a refusal leaves alerts off', async () => {
    FakeNotification.permission = 'default';
    FakeNotification.requestPermission.mockImplementationOnce(async () => {
      FakeNotification.permission = 'denied';
      return 'denied';
    });
    const { result } = renderHook((p: Props) => useGoAlerts(p), { initialProps: { ...start, running: false } });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    await act(async () => result.current.enable());
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    expect(result.current.on).toBe(false);
    expect(result.current.permission).toBe('denied');
  });

  it('takes the wake lock while running, only with alerts on', async () => {
    localStorage.setItem('pm.go.alerts', 'on');
    const release = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ released: false, release }));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const { rerender, unmount } = renderHook((p: Props) => useGoAlerts(p), { initialProps: start });
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    rerender({ ...start, running: false, status: 'completed' });
    await waitFor(() => expect(release).toHaveBeenCalled());
    unmount();
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
  });
});
