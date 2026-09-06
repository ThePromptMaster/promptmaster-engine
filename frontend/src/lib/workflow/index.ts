import { BOOK_V1 } from './templates/book.v1';
import { RESEARCH_V1 } from './templates/research.v1';
import { SINGLE_OUTPUT_V1 } from './templates/single-output.v1';
import type { WorkflowTemplate } from './types';

export * from './types';
export * from './engine';

/**
 * Templates live in the repo so they can be validated offline by tests, and
 * are seeded into workflow_templates for the app to pin a version against.
 * A project references a specific version, so revising a template never
 * disturbs work already in flight.
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  BOOK_V1,
  RESEARCH_V1,
  SINGLE_OUTPUT_V1,
];

export function getTemplate(key: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.key === key);
}

export { BOOK_V1, RESEARCH_V1, SINGLE_OUTPUT_V1 };
