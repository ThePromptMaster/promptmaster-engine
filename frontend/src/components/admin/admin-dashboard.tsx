'use client';

/**
 * FR-19, rendered: "reasonable visibility into failed jobs, major errors, and
 * usage/cost information".
 *
 * **The audience is the product owner, not a developer.** That constraint does
 * most of the design work here:
 *
 *   - No uuids on the surface. A row says `owner@example.com` and
 *     `Tidal Energy Handbook`, resolved server-side where the joins are cheap,
 *     because a page of `8f3a…` is a page nobody reads twice.
 *   - No schema vocabulary. "Gave up after 3 tries", not `status: dead`. The
 *     FR-16 taxonomy codes are already plain-language on the client, so they
 *     are reused rather than re-explained.
 *   - Every number is labelled with what it counts and over what period. A
 *     dashboard whose figures require someone to remember the window is a
 *     dashboard that gets misread.
 *
 * **Unknown is shown as unknown.** `costUsd: null` renders as an em dash and,
 * where it matters, as an explicit "N calls at an unknown rate" note. It is
 * never rendered as $0.00. This is the same rule the migration and the parser
 * hold, carried to the last surface that could break it — which is the one that
 * matters, because this is where a person forms a belief about the number.
 *
 * This component holds no privilege. It fetches `/api/admin/overview` and
 * renders the result; the refusal for a non-admin happens in that route, where
 * the data is. See `lib/admin/access.ts`.
 */

import { useMemo } from 'react';

import { formatTokens, formatUsd } from '@/lib/observability/usage';
import type { AdminOverview } from '@/lib/admin/types';

interface Props {
  overview: AdminOverview;
  /** Reporting window control. Omitted on the preview surface. */
  onWindowChange?: (days: number) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}

const WINDOWS = [7, 30, 90];

export function AdminDashboard({ overview, onWindowChange, refreshing, onRefresh }: Props) {
  const { totals } = overview;

  return (
    <div className="flex flex-col gap-6">
      <AdminHeader
        overview={overview}
        onWindowChange={onWindowChange}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />

      {overview.warnings.length > 0 && <WarningBanner warnings={overview.warnings} />}

      {/* The four numbers that answer "is anything wrong, and what did it cost". */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon="payments"
          label={`Spend, last ${overview.windowDays} days`}
          value={formatUsd(totals.costUsd)}
          note={
            totals.unpricedCalls > 0
              ? `${formatTokens(totals.unpricedCalls)} calls at an unknown rate are not included`
              : undefined
          }
        />
        <StatTile
          icon="bolt"
          label="Model calls"
          value={formatTokens(totals.calls)}
          note={`${formatTokens(totals.tokensIn + totals.tokensOut)} tokens in total`}
        />
        <StatTile
          icon="group"
          label="People who generated"
          value={formatTokens(totals.activeUsers)}
        />
        <StatTile
          icon={totals.failedJobs > 0 ? 'error' : 'check_circle'}
          label="Background jobs needing attention"
          value={formatTokens(totals.failedJobs)}
          tone={totals.failedJobs > 0 ? 'alert' : 'good'}
          note={totals.failedJobs === 0 ? 'Nothing is stuck' : 'Across every project'}
        />
      </section>

      <FailedJobsPanel overview={overview} />
      <UsagePanel overview={overview} />
      <ErrorsPanel overview={overview} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function AdminHeader({ overview, onWindowChange, refreshing, onRefresh }: Props) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-headline text-[var(--on-surface)]">Operations</h1>
        <p className="mt-1 max-w-[68ch] text-body text-[var(--on-surface-variant)]">
          Failed background jobs, recent errors, and what the beta has spent with the
          model provider. Updated {relativeTime(overview.generatedAt)}.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {onWindowChange && (
          <div
            className="flex items-center gap-1 rounded-full bg-[var(--surface-container-high)] p-1"
            role="group"
            aria-label="Reporting period"
          >
            {WINDOWS.map((days) => {
              const active = days === overview.windowDays;
              return (
                <button
                  key={days}
                  type="button"
                  onClick={() => onWindowChange(days)}
                  aria-pressed={active}
                  className={`rounded-full px-3 py-1 text-label transition-colors ${
                    active
                      ? 'bg-[var(--surface-container-lowest)] text-[var(--on-surface)]'
                      : 'text-[var(--on-surface-variant)] hover:text-[var(--on-surface)]'
                  }`}
                >
                  {days}d
                </button>
              );
            })}
          </div>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-full bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)] transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            <span aria-hidden className="material-symbols-outlined text-[16px]">
              refresh
            </span>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
    </header>
  );
}

function WarningBanner({ warnings }: { warnings: string[] }) {
  return (
    <div
      role="status"
      className="rounded-xl bg-[var(--surface-container-high)] px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-[var(--pm-tertiary)]"
        >
          warning
        </span>
        <div>
          <p className="text-title text-[var(--on-surface)]">
            Some of this page could not be loaded
          </p>
          {/* Surfaced rather than swallowed: an empty list where a query failed
              reads as "nothing is wrong", which is the opposite of the truth. */}
          <ul className="mt-1 space-y-0.5">
            {warnings.map((warning) => (
              <li key={warning} className="text-body text-[var(--on-surface-variant)]">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  note,
  tone = 'neutral',
}: {
  icon: string;
  label: string;
  value: string;
  note?: string;
  tone?: 'neutral' | 'alert' | 'good';
}) {
  const accent =
    tone === 'alert'
      ? 'var(--pm-error)'
      : tone === 'good'
        ? 'var(--pm-success)'
        : 'var(--on-surface-variant)';

  return (
    <div className="rounded-xl bg-[var(--surface-container-low)] px-5 py-4 shadow-ambient">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="material-symbols-outlined text-[18px]"
          style={{ color: accent }}
        >
          {icon}
        </span>
        <p className="text-label text-[var(--on-surface-variant)]">{label}</p>
      </div>
      <p className="mt-2 text-headline text-[var(--on-surface)]">{value}</p>
      {note && <p className="mt-1 text-label text-[var(--on-surface-variant)]">{note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-[var(--surface-container-low)] px-5 py-5 shadow-ambient">
      <h2 className="text-title text-[var(--on-surface)]">{title}</h2>
      <p className="mt-1 max-w-[68ch] text-label text-[var(--on-surface-variant)]">
        {description}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyState({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-container)] px-4 py-6">
      <span
        aria-hidden
        className="material-symbols-outlined text-[20px] text-[var(--pm-success)]"
      >
        {icon}
      </span>
      <p className="text-body text-[var(--on-surface-variant)]">{children}</p>
    </div>
  );
}

/**
 * Wide content scrolls inside its own container rather than pushing the page
 * sideways — these tables have five or six columns and the workspace is a
 * fixed-width well.
 */
function TableScroll({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 overflow-x-auto px-1">{children}</div>;
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 text-label font-medium text-[var(--on-surface-variant)] ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  muted = false,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2.5 text-body ${align === 'right' ? 'text-right tabular-nums' : ''} ${
        muted ? 'text-[var(--on-surface-variant)]' : 'text-[var(--on-surface)]'
      }`}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------

function FailedJobsPanel({ overview }: { overview: AdminOverview }) {
  return (
    <Panel
      title="Background jobs that need attention"
      description="Drafting work that stopped and did not recover on its own, across every project. Not limited to the reporting period — a job that died three weeks ago is still stuck today."
    >
      {overview.failedJobs.length === 0 ? (
        <EmptyState icon="check_circle">
          Nothing is stuck. Every drafting job has either finished or is still running.
        </EmptyState>
      ) : (
        <TableScroll>
          <table className="w-full min-w-[46rem] border-collapse">
            <thead>
              <tr className="bg-[var(--surface-container)]">
                <Th>Project</Th>
                <Th>Who</Th>
                <Th>What went wrong</Th>
                <Th>State</Th>
                <Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {overview.failedJobs.map((job) => (
                <tr key={job.id} className="odd:bg-[var(--surface-container-lowest)]">
                  <Td>{job.projectTitle ?? 'Deleted project'}</Td>
                  <Td muted>{job.userEmail ?? 'Unknown account'}</Td>
                  <Td muted>
                    {job.errorMessage || job.errorCode || 'No reason was recorded'}
                  </Td>
                  <Td>
                    <JobState job={job} />
                  </Td>
                  <Td align="right" muted>
                    {relativeTime(job.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </Panel>
  );
}

/** `status: dead` means nothing to the reader. This says what happened. */
function JobState({ job }: { job: AdminOverview['failedJobs'][number] }) {
  const dead = job.status === 'dead';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label"
      style={{
        backgroundColor: dead ? 'var(--error-container)' : 'var(--surface-container-high)',
        color: dead ? 'var(--on-error-container)' : 'var(--on-surface-variant)',
      }}
    >
      <span aria-hidden className="material-symbols-outlined text-[14px]">
        {dead ? 'block' : 'replay'}
      </span>
      {dead
        ? `Gave up after ${job.attempts} ${job.attempts === 1 ? 'try' : 'tries'}`
        : `Failed, ${Math.max(0, job.maxAttempts - job.attempts)} retries left`}
    </span>
  );
}

// ---------------------------------------------------------------------------

function UsagePanel({ overview }: { overview: AdminOverview }) {
  return (
    <Panel
      title="Usage and cost per person"
      description={`What each account spent with the model provider over the last ${overview.windowDays} days, largest first. Cost is the price the provider quoted at the time of each call.`}
    >
      {overview.usageByUser.length === 0 ? (
        <EmptyState icon="info">
          Nobody has generated anything in this period.
        </EmptyState>
      ) : (
        <TableScroll>
          <table className="w-full min-w-[42rem] border-collapse">
            <thead>
              <tr className="bg-[var(--surface-container)]">
                <Th>Account</Th>
                <Th align="right">Cost</Th>
                <Th align="right">Model calls</Th>
                <Th align="right">Tokens in</Th>
                <Th align="right">Tokens out</Th>
                <Th align="right">Last activity</Th>
              </tr>
            </thead>
            <tbody>
              {overview.usageByUser.map((row) => (
                <tr key={row.userId} className="odd:bg-[var(--surface-container-lowest)]">
                  <Td>{row.email ?? shortId(row.userId)}</Td>
                  <Td align="right">
                    {formatUsd(row.costUsd)}
                    {row.unpricedCalls > 0 && (
                      <span
                        className="ml-1 text-label text-[var(--on-surface-variant)]"
                        title={`${row.unpricedCalls} calls used a model whose price was not known, so this figure understates.`}
                      >
                        +{row.unpricedCalls}?
                      </span>
                    )}
                  </Td>
                  <Td align="right" muted>
                    {formatTokens(row.calls)}
                  </Td>
                  <Td align="right" muted>
                    {formatTokens(row.tokensIn)}
                  </Td>
                  <Td align="right" muted>
                    {formatTokens(row.tokensOut)}
                  </Td>
                  <Td align="right" muted>
                    {relativeTime(row.lastCallAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <p className="mt-3 max-w-[68ch] text-label text-[var(--on-surface-variant)]">
        A “+N?” beside a cost means N calls used a model whose price was not known when
        they ran, so the figure understates rather than guessing. The provider account is
        always the final word on billing.
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function ErrorsPanel({ overview }: { overview: AdminOverview }) {
  const tally = useMemo(() => overview.errorTally.slice(0, 6), [overview.errorTally]);

  return (
    <Panel
      title="Errors people saw"
      description={`Failures shown to someone in the app over the last ${overview.windowDays} days. Grouped first, so the most common problem is the one at the top.`}
    >
      {overview.recentErrors.length === 0 ? (
        <EmptyState icon="check_circle">
          Nobody has hit an error in this period.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {tally.map((entry) => (
              <span
                key={entry.code}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-container-high)] px-3 py-1.5 text-label text-[var(--on-surface)]"
              >
                {friendlyCode(entry.code)}
                <span className="tabular-nums text-[var(--on-surface-variant)]">
                  {entry.count}
                </span>
              </span>
            ))}
          </div>

          <TableScroll>
            <table className="w-full min-w-[46rem] border-collapse">
              <thead>
                <tr className="bg-[var(--surface-container)]">
                  <Th>What happened</Th>
                  <Th>Who</Th>
                  <Th>Where</Th>
                  <Th align="right">When</Th>
                </tr>
              </thead>
              <tbody>
                {overview.recentErrors.map((row) => (
                  <tr key={row.id} className="odd:bg-[var(--surface-container-lowest)]">
                    <Td>
                      <span className="block">{row.title || friendlyCode(row.code)}</span>
                      <span className="mt-0.5 block max-w-[52ch] text-label text-[var(--on-surface-variant)]">
                        {row.message}
                      </span>
                    </Td>
                    <Td muted>{row.userEmail ?? 'Unknown account'}</Td>
                    <Td muted>
                      <span className="block">{row.projectTitle ?? '—'}</span>
                      {/* The correlation id, so a report can be traced into the
                          server log. Small, and last, because it is for the one
                          time someone needs it. */}
                      {row.requestId && (
                        <span className="mt-0.5 block font-mono text-[10px] text-[var(--outline)]">
                          {row.requestId.slice(0, 12)}
                        </span>
                      )}
                    </Td>
                    <Td align="right" muted>
                      {relativeTime(row.createdAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * The FR-16 taxonomy codes, in the words the page uses elsewhere.
 *
 * An unrecognised code degrades to a de-slugged version of itself rather than
 * to "Unknown" — a new code added to the backend should still read sensibly
 * here on the day it ships, not on the day someone remembers to update a map.
 */
const CODE_LABELS: Record<string, string> = {
  insufficient_credits: 'Out of model credits',
  rate_limited: 'Rate limited',
  context_length: 'Prompt too long',
  output_truncated: 'Output cut short',
  function_timeout: 'Timed out mid-run',
  job_dead: 'Gave up retrying',
  provider_unavailable: 'Provider unavailable',
  invalid_request: 'Request refused',
  unknown: 'Unclassified failure',
};

export function friendlyCode(code: string): string {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  const words = code.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unclassified failure';
}

/**
 * "3 hours ago". Absolute timestamps make a reader do arithmetic to answer the
 * only question they have, which is whether this is happening now.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '—';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(then).toLocaleDateString();
}

function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}
