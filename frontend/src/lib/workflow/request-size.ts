/**
 * How much process a request needs, as the browser uses it (11 Nov). Pure.
 *
 * A client, 8 Nov: the two start buttons "should determine how someone starts,
 * while the actual request determines the depth and workflow". The backend
 * decides the depth (`POST /api/size-request`); this says what each way in does
 * with it. Concise is the one-stage workflow with its final check, whichever
 * button was pressed. Anything larger is a designed workflow: at once on the
 * planning route, and offered around the first draft on the quick one — offered,
 * not done, because re-pinning a project's workflow is the user's press.
 */

export type RequestDepth = 'concise' | 'standard' | 'full';

export interface RequestSize {
  depth: RequestDepth;
  reason: string;
  by: 'rule' | 'model' | 'default';
}

/** The one-stage workflow serves it. */
export function isConcise(size: Pick<RequestSize, 'depth'> | null | undefined): boolean {
  return size?.depth === 'concise';
}

/**
 * A first draft whose request is more than one sitting is taken toward the
 * full process. A size that could not be read ("default") moves nothing: only
 * a rule or a reading does.
 */
export function outgrowsOneStage(size: RequestSize | null | undefined): boolean {
  return Boolean(size) && size!.by !== 'default' && size!.depth !== 'concise';
}

/**
 * The depth the designer is told. A concise request is not designed, and a
 * size that could not be read tells the designer nothing: it designs as before.
 */
export function designDepth(size: Pick<RequestSize, 'depth' | 'by'> | null | undefined): 'standard' | 'full' | undefined {
  if (!size || size.by === 'default') return undefined;
  return size.depth === 'standard' || size.depth === 'full' ? size.depth : undefined;
}

/** One size per project and request: a changed objective is sized again. */
export function sizeKey(projectId: string, request: string): string {
  let h = 0;
  for (let i = 0; i < request.length; i += 1) h = (h * 31 + request.charCodeAt(i)) | 0;
  return `pm.size.${projectId}.${(h >>> 0).toString(36)}`;
}

export function readSize(key: string): RequestSize | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as RequestSize) : null;
    return parsed && ['concise', 'standard', 'full'].includes(parsed.depth) ? parsed : null;
  } catch {
    return null;
  }
}

export function keepSize(key: string, size: RequestSize): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(size));
  } catch {
    // A convenience only: without it the request is sized again.
  }
}
