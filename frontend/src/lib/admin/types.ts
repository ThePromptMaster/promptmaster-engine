/**
 * The shape the admin route returns. Client-safe: no secrets, no server imports.
 *
 * Kept separate from `access.ts` on purpose — that module reads
 * `ADMIN_USER_IDS` and `SUPABASE_SERVICE_ROLE_KEY`, and a client component
 * importing it for a type would drag those into the bundle graph. Types live
 * here; privilege lives there.
 *
 * A note on what these rows contain. The audience is the product owner, not a
 * developer, so the route resolves ids into things a person recognises — a
 * user's email rather than a uuid, a project's title rather than its id. Every
 * number that could be null stays null all the way here, because "we do not
 * know what this cost" and "this cost nothing" are different facts and the page
 * has to be able to say which.
 */

/** One user's spend over the reporting window. */
export interface AdminUsageRow {
  userId: string;
  /** Resolved from auth.users. Null if the account has since been deleted. */
  email: string | null;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** null when nothing in the window had a known price. */
  costUsd: number | null;
  /** Calls whose model price was unknown, so the cost above understates. */
  unpricedCalls: number;
  /** ISO-8601. The most recent call in the window. */
  lastCallAt: string | null;
}

/** A job that failed or died, across every project. */
export interface AdminFailedJob {
  id: string;
  kind: string;
  status: string;
  projectId: string | null;
  projectTitle: string | null;
  userEmail: string | null;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

/** A failure a user was actually shown. */
export interface AdminErrorRow {
  id: string;
  code: string;
  title: string;
  message: string;
  route: string;
  requestId: string;
  httpStatus: number | null;
  userEmail: string | null;
  projectTitle: string | null;
  source: string;
  createdAt: string;
}

/** How often each failure code occurred in the window — what to fix next. */
export interface AdminErrorTally {
  code: string;
  count: number;
}

export interface AdminOverview {
  /** Days covered by the roll-ups. */
  windowDays: number;
  generatedAt: string;
  totals: {
    calls: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number | null;
    unpricedCalls: number;
    activeUsers: number;
    failedJobs: number;
    errors: number;
  };
  usageByUser: AdminUsageRow[];
  failedJobs: AdminFailedJob[];
  recentErrors: AdminErrorRow[];
  errorTally: AdminErrorTally[];
  /**
   * Set when a section could not be read — a missing table, a permissions
   * problem. Surfaced rather than swallowed: an admin page that silently shows
   * an empty list when a query failed is worse than no page, because it reads
   * as "nothing is wrong".
   */
  warnings: string[];
}
