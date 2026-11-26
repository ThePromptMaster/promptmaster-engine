/**
 * A project card dragged onto a folder (26 Nov, Sean: "It says you're allowed to drag the
 * projects into the folders, but I don't think it's working").
 *
 * The drag carries the project's id under its own type, so a folder row accepts only
 * projects. The id is also kept here for the length of the drag: a browser that hides a
 * custom type while the pointer moves (it may show only `Files` or `text/uri-list` for a
 * drag that starts on a link) still lets the folder row take the drop.
 */

/** The drag type a project card sets. */
export const PROJECT_DRAG_TYPE = 'application/x-pm-project';

let dragging: string | null = null;

/** On the card's dragstart. */
export function beginProjectDrag(dataTransfer: DataTransfer | null, projectId: string): void {
  dragging = projectId;
  if (!dataTransfer) return;
  try {
    dataTransfer.setData(PROJECT_DRAG_TYPE, projectId);
  } catch {
    // A browser that refuses the custom type: the id kept above still names the project.
  }
  dataTransfer.effectAllowed = 'move';
}

/** On the card's dragend, whether or not it was dropped anywhere. */
export function endProjectDrag(): void {
  dragging = null;
}

/** Whether what is being dragged is a project card. */
export function isProjectDrag(dataTransfer: DataTransfer | null): boolean {
  if (dragging) return true;
  // `types` was a DOMStringList in older browsers, with no `includes`.
  return Array.from(dataTransfer?.types ?? []).includes(PROJECT_DRAG_TYPE);
}

/** The dragged project's id at the drop, or null for anything else. */
export function draggedProjectId(dataTransfer: DataTransfer | null): string | null {
  let id = '';
  try {
    id = dataTransfer?.getData(PROJECT_DRAG_TYPE) ?? '';
  } catch {
    id = '';
  }
  return id || dragging;
}
