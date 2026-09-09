import type { StageFailure } from '@/lib/errors/recovery';
import type { StageDefinition } from '@/lib/workflow/types';
import type { StageItem, StageItemSchema } from '@/lib/workflow/stage-artifact';
import type { Evaluation, ArtifactVersion, Project } from '@/types/project';
import type { LongFormState } from '@/types';

/**
 * What the drafting renderer needs beyond the common props.
 *
 * It is a separate optional block rather than more top-level fields because
 * drafting is the one renderer whose work outlives the component: it enqueues
 * server jobs, so it needs the project row (for the model and the PMInput the
 * drain will use hours later) and the artifact to write into. Folding those
 * into the shared props would hand every renderer a project it has no business
 * touching.
 */
export interface LongFormContext {
  project: Project;
  artifactId: string | null;
  stageId: string;
  /** The stage artifact's long-form state — the authority on what is written. */
  state: LongFormState | null;
  /** FR-07: the outline version drafting is bound to. */
  approvedOutlineVersionId: string | null;
  /** Ask the workspace to reload the artifact after the server changed it. */
  onRefresh: () => void;
}

/**
 * The contract every stage renderer implements.
 *
 * Deliberately says nothing about which workflow the stage came from. A
 * renderer that could tell Book from Research would be the first crack in the
 * "one engine, two workflows" claim, so the props carry a stage definition, an
 * item schema and version history — all of which are data — and nothing else.
 *
 * The renderer never talks to Supabase or the API. It reports edits upward and
 * the workspace decides what becomes a version, which is what keeps
 * "generation, autosave and versioning" in one place rather than three.
 */
export interface StageRendererProps {
  stage: StageDefinition;
  /** The shape of one item, for list and review stages. */
  schema: StageItemSchema;

  /** Every version of this stage's artifact, oldest first. */
  versions: ArtifactVersion[];
  /** Scores for the version being viewed, when one was ever stored. */
  evaluation?: Evaluation;
  /** Which version is being *displayed*. Never implies a restore. */
  activeVersionId: string | null;
  onSelectVersion: (versionId: string | null) => void;
  onRestore: (versionId: string) => Promise<void>;

  /** Prose stages: save edited markdown as a new version. */
  onSaveContent?: (content: string) => Promise<void>;
  /** List and review stages: save the whole item array as a new version. */
  onSaveItems?: (items: StageItem[]) => Promise<void>;

  /** True while a draft is being generated for this stage. */
  generating: boolean;
  generationError: string | null;
  /** Regenerate. `force` skips the "this would overwrite your edits" guard. */
  onGenerate: (options?: { force?: boolean }) => void;
  onCancelGeneration: () => void;

  /**
   * FR-11: score this stage's artifact. Absent when it cannot be evaluated —
   * an earlier stage being browsed, or a surface with no store behind it.
   *
   * Deliberately shaped like `onGenerate`: a renderer receives the ability to
   * evaluate as data and knows nothing about which workflow it is in.
   */
  onEvaluate?: () => void;
  evaluating?: boolean;
  evaluationError?: string | null;

  /**
   * FR-16: the failure, classified, with the recovery actions that apply to it.
   *
   * Additive rather than a replacement for `generationError`. The string is the
   * floor — a renderer with no classification still shows something — and the
   * classified failure is what carries the code, the action set, and the
   * sentence saying what survived.
   */
  generationFailure?: StageFailure | null;
  evaluationFailure?: StageFailure | null;
  /** Clear a failure without retrying: FR-16's "pause". */
  onDismissFailure?: () => void;
  /** FR-16's "switch configured model". Absent on surfaces with no store. */
  onSwitchModel?: (model: string) => void;
  /**
   * The project's configured model id, so the switcher can show what is set.
   *
   * The id alone rather than the project row: a renderer that could reach the
   * project could reach its workflow, and "no renderer branches on which
   * workflow it is" is a property worth keeping unreachable rather than merely
   * unexercised.
   */
  currentModel?: string;

  /**
   * Browsing an earlier stage. Everything stays readable; nothing is editable,
   * because editing a stage you are only looking at is how work gets lost.
   */
  readOnly: boolean;

  /** Present only for `long_form` stages. */
  longForm?: LongFormContext;
}
