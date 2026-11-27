/**
 * The drain's calls to the backend's sending routes (26 Nov): the worker credential names the
 * person, and the approval's ticket covers the one email. Without both, the backend sends nothing.
 */
import { OutreachCallError, type Ids, type OutreachClient, type Ticketed } from './outreach-job';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const TIMEOUT_MS = 60_000;

export class HttpOutreachClient implements OutreachClient {
  constructor(private readonly workerSecret: string) {}

  private async post<T>(path: string, t: Ticketed, extra: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.workerSecret}`,
          'X-PromptMaster-User': t.userId,
        },
        body: JSON.stringify({ approval_id: t.approval.id, purpose: t.approval.purpose, snapshot: t.approval.snapshot, ticket: t.approval.ticket, ...extra }),
        signal: controller.signal,
      });
    } catch (e) {
      // The request may have reached the mailbox before the connection went.
      throw new OutreachCallError(e instanceof Error ? e.message : 'The backend could not be reached.', 'uncertain', 0);
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return (await res.json()) as T;
    let detail: unknown = null;
    try {
      detail = ((await res.json()) as { detail?: unknown }).detail;
    } catch {
      detail = null;
    }
    const d = (detail && typeof detail === 'object' ? detail : {}) as { code?: string; message?: string };
    const message = d.message ?? (typeof detail === 'string' ? detail : `HTTP ${res.status}`);
    if (res.status === 409) throw new OutreachCallError(message, 'mailbox_changed', 409);
    if (res.status === 403) throw new OutreachCallError(message, 'not_approved', 403);
    if (res.status === 503) throw new OutreachCallError(message, 'off', 503);
    if (d.code === 'uncertain' || d.code === 'not_sent') throw new OutreachCallError(message, d.code, res.status);
    // A 5xx without a code: the backend itself failed, possibly after the mailbox took it.
    throw new OutreachCallError(message, res.status >= 500 ? 'uncertain' : 'other', res.status);
  }

  createDraft(t: Ticketed) {
    return this.post<{ draft_id: string }>('/api/outreach/send', t, { step: 'draft' });
  }

  sendDraft(t: Ticketed, draftId: string) {
    return this.post<Ids>('/api/outreach/send', t, { step: 'send', draft_id: draftId });
  }

  findSent(t: Ticketed, afterEpochSeconds: number) {
    return this.post<{ found: boolean } & Partial<Ids>>('/api/outreach/find-sent', t, { after_epoch: afterEpochSeconds });
  }

  confirm(t: Ticketed, messageId: string) {
    return this.post<{ sent: boolean; thread_id: string; thread_url: string; matches: boolean }>('/api/outreach/confirm', t, { message_id: messageId });
  }
}
