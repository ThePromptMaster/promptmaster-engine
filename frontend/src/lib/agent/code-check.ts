/**
 * Code in a deliverable that the objective asks to have checked (M3, 8 Oct).
 *
 * Sean, 7 Oct (email 3): a Single output Python debugging test produced
 * corrected code and nine test cases, and PromptMaster said code execution was
 * unavailable — running code was offered only in research workflows. When a
 * written stage holds a Python block and the objective asks for it to be
 * tested, checked or run, Go may run it in the sandbox like any computation,
 * and the result is labelled as executed. Pure.
 */

export interface CodeToCheck {
  language: 'python';
  code: string;
}

const PYTHON_FENCE = /```(?:python|py|python3)[^\n]*\n([\s\S]*?)```/gi;
const ASKS_FOR_CHECKS = /\b(test(s|ed|ing)?|check(s|ed|ing)?|verif(y|ied|ication)|run(s|ning)?|debug(ging)?|cases?|assert(s|ions)?|execute[sd]?)\b/i;

/** The Python in a draft, when the objective asks for it to be checked; else null. */
export function codeToCheck(draft: string | null | undefined, objective: string): CodeToCheck | null {
  if (!draft || !ASKS_FOR_CHECKS.test(objective)) return null;
  const blocks = [...draft.matchAll(PYTHON_FENCE)].map((m) => m[1].replace(/\s+$/, '')).filter((c) => c.trim());
  if (!blocks.length) return null;
  return { language: 'python', code: blocks.join('\n\n') };
}

/** What the code-writing step is asked to do with it: run it as written, then the cases. */
export function checkGoal(code: CodeToCheck, objective: string): string {
  return [
    'Run the code below EXACTLY as written (do not fix or rewrite it), then run every test case the objective names against it.',
    'For each case print: the case, the input, the expected result, the actual result, and PASS or FAIL. End with a line "N of M passed".',
    `OBJECTIVE: ${objective.slice(0, 3_000)}`,
    'THE CODE:',
    code.code.slice(0, 30_000),
  ].join('\n');
}
