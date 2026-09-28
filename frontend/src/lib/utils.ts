import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { EvaluationResult, Iteration, ScoreLevel } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function needsRealignment(evaluation: EvaluationResult): boolean {
  return evaluation.alignment.score === 'Low' || evaluation.drift.score === 'High';
}

const SCORE_MAP: Record<ScoreLevel, number> = { Low: 1, Medium: 2, High: 3 };

export function scoreTrend(
  label: string,
  prev: ScoreLevel,
  curr: ScoreLevel
): 'improved' | 'declined' | 'unchanged' {
  const isDrift = label.toLowerCase().includes('drift');
  const delta = isDrift
    ? SCORE_MAP[prev] - SCORE_MAP[curr] // Lower drift is better
    : SCORE_MAP[curr] - SCORE_MAP[prev]; // Higher alignment/clarity is better

  if (delta > 0) return 'improved';
  if (delta < 0) return 'declined';
  return 'unchanged';
}

export function assessTier(
  savedSessionCount: number,
  currentIterations: Iteration[],
  state: {
    constraints: string;
    outputFormat: string;
    audience: string;
    mode: string;
    selfAudit: string | null;
  }
): 1 | 2 | 3 | 4 {
  let score = 0;

  const hasConstraints = state.constraints.trim().length > 0;
  const hasFormat = state.outputFormat.trim().length > 0;
  const hasAudience = state.audience !== 'General';
  const iterationCount = currentIterations.length;
  const usedCustom = state.mode === 'custom';
  const ranSelfAudit = state.selfAudit !== null;

  // Tier 2 signals
  if (hasConstraints) score += 1;
  if (hasFormat) score += 1;
  if (hasAudience) score += 1;
  if (iterationCount >= 2) score += 1;

  // Tier 3 signals
  if (iterationCount >= 3) score += 1;
  const modesUsed = new Set(currentIterations.map((it) => it.mode));
  if (modesUsed.size > 1) score += 2;

  // Tier 4 signals
  if (ranSelfAudit) score += 2;
  if (usedCustom) score += 1;
  if (savedSessionCount >= 3) score += 1;
  if (savedSessionCount >= 5) score += 1;

  if (score >= 8) return 4;
  if (score >= 5) return 3;
  if (score >= 2) return 2;
  return 1;
}

export function downloadFile(content: string, filename: string, mimeType: string = 'text/plain') {
  downloadBlob(new Blob([content], { type: mimeType }), filename);
}

/** Save a file the browser already holds as a Blob (the Word export). */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
