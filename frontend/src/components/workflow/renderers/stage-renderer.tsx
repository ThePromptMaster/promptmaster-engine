'use client';

/**
 * Renderer dispatch.
 *
 * `stage.renderer` has been in the template type since the engine landed and
 * nothing read it — the workspace took an opaque `children` prop, so every
 * stage of a thirteen-stage Book showed the same single-output pane. This is
 * the switch that makes the declaration mean something.
 *
 * The switch is on the renderer, never on the workflow. That is the whole
 * point: Book's fact-check table and Research's reproduction table are the
 * same `review` renderer with different columns.
 *
 * Each renderer is wrapped in the ErrorBoundary so a stage that fails to render
 * — a malformed artifact from an older build, say — costs the user that stage
 * and not the workspace around it, including the rail they need to leave.
 */

import { ErrorBoundary } from '@/components/shared/error-boundary';
import { ListRenderer } from './list-renderer';
import { ProseRenderer } from './prose-renderer';
import { ReviewRenderer } from './review-renderer';
import type { StageRendererProps } from './types';

export function StageRenderer(props: StageRendererProps) {
  const { stage } = props;

  let body: React.ReactNode;
  switch (stage.renderer) {
    case 'prose':
      body = <ProseRenderer {...props} />;
      break;
    case 'list':
      body = <ListRenderer {...props} />;
      break;
    case 'review':
      body = <ReviewRenderer {...props} />;
      break;
    // Outline and long-form land in their own streams. A named placeholder is
    // honest about that; falling through to prose would silently render an
    // outline as a wall of text and look like a bug rather than a gap.
    case 'outline':
    case 'long_form':
    default:
      body = <NotYetRenderer renderer={stage.renderer} />;
  }

  // Keyed by stage so moving between stages remounts rather than reusing a
  // renderer's local edit state under a different artifact.
  return <ErrorBoundary key={stage.id}>{body}</ErrorBoundary>;
}

const PENDING_LABEL: Record<string, string> = {
  outline: 'The outline editor',
  long_form: 'Section-by-section drafting',
};

function NotYetRenderer({ renderer }: { renderer: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-container-low)] px-8 py-12 text-center">
      <p className="text-body text-[var(--on-surface)]">
        {PENDING_LABEL[renderer] ?? `The ${renderer} view`} is not built yet.
      </p>
      <p className="mt-1 text-label text-[var(--on-surface-variant)]">
        You can still move past this stage, or skip it with a reason.
      </p>
    </div>
  );
}
