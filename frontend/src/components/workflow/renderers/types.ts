import type { StageDefinition } from '@/lib/workflow/types';
import type { StageItem, StageItemSchema } from '@/lib/workflow/stage-artifact';
import type { ArtifactVersion } from '@/types/project';

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
   * Browsing an earlier stage. Everything stays readable; nothing is editable,
   * because editing a stage you are only looking at is how work gets lost.
   */
  readOnly: boolean;
}
