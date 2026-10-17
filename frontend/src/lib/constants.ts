import type { ModeType } from '@/types';

export const MODE_DISPLAY: Record<ModeType, { display_name: string; tagline: string }> = {
  architect: { display_name: 'Architect', tagline: 'Structure, systems, and frameworks' },
  critic: { display_name: 'Critic', tagline: 'Finding weak points and contradictions' },
  clarity: { display_name: 'Clarity', tagline: 'Translating complexity into understanding' },
  coach: { display_name: 'Coach', tagline: 'Motivation and reframing obstacles' },
  therapist: { display_name: 'Therapist', tagline: 'Empathetic exploration and emotional processing' },
  cold_critic: { display_name: 'Cold Critic', tagline: 'Brutal honesty, zero praise, flaw-focused' },
  analyst: { display_name: 'Analyst', tagline: 'Data-driven, methodical, evidence-based reasoning' },
  custom: { display_name: 'Custom', tagline: 'Your own mode — define the persona' },
};

export const CONSTRAINT_PRESETS = [
  'Keep it under 300 words',
  'No jargon or technical language',
  'Include concrete examples',
  'Focus on actionable steps',
  'List pros and cons',
  'Avoid speculation',
  'Use formal tone',
  'Be concise and direct',
  'Cite sources for factual claims',
];

export const FORMAT_PRESETS = [
  'Bullet points',
  'Numbered list',
  'Short paragraphs',
  'Table or comparison',
  'Step-by-step guide',
  'Executive summary',
  'Q&A format',
];

/**
 * Prompt Stacks (Ch5 S6) — predefined multi-step workflows.
 *
 * Each stack is a "protocol" — a layered sequence of prompts that together
 * form a robust framework. Users pick a stack on the Input phase; it prefills
 * the first step (mode + objective placeholder + constraints) and shows the
 * full planned sequence as a guide.
 *
 * Book reference: "PromptMasters often have libraries of 'prompt protocols'
 * which are essentially predesigned stacks."
 */
export interface PromptStack {
  id: string;
  name: string;
  description: string;
  // Initial configuration for the first iteration
  initial: {
    mode: ModeType;
    objective_placeholder: string;
    constraints: string;
    output_format: string;
  };
  // Planned steps — shown as a guide so user knows what to do next
  steps: Array<{ label: string; hint: string }>;
}

export const PROMPT_STACKS: PromptStack[] = [
  {
    id: 'research',
    name: 'Research Stack',
    description: 'Structured research with outline → expansion → refinement',
    initial: {
      mode: 'architect',
      objective_placeholder: 'Research [topic] for [purpose]',
      constraints: 'Start with a hierarchical outline. Do not write final prose yet.',
      output_format: 'Numbered outline with sub-sections and dependency notes',
    },
    steps: [
      { label: 'Step 1 — Outline', hint: 'Get a hierarchical outline. Switch to Architect mode if not already.' },
      { label: 'Step 2 — Expand sections', hint: 'Use "Refine as… More concrete" to expand each section with examples.' },
      { label: 'Step 3 — Critic pass', hint: 'Use "Challenge This" to stress-test the research for gaps and bias.' },
      { label: 'Step 4 — Final draft', hint: 'Use "Refine as… More cautious" or switch modes for the final prose.' },
    ],
  },
  {
    id: 'strategy',
    name: 'Strategy Stack',
    description: 'Frame → options → trade-offs → recommendation',
    initial: {
      mode: 'analyst',
      objective_placeholder: 'Develop a strategy for [goal] given [constraints]',
      constraints: 'List 3-5 distinct strategic options. Do not recommend yet.',
      output_format: 'Numbered list of options with one-line framing for each',
    },
    steps: [
      { label: 'Step 1 — Frame options', hint: 'Generate distinct strategic options without recommending.' },
      { label: 'Step 2 — Trade-offs', hint: 'Use "Refine as… More concrete" to expand each with pros/cons.' },
      { label: 'Step 3 — Stress test', hint: 'Switch to Cold Critic mode or use "Challenge This" on the top option.' },
      { label: 'Step 4 — Final recommendation', hint: 'Use "Refine as… More cautious" to add caveats before finalizing.' },
    ],
  },
  {
    id: 'decision',
    name: 'Decision Stack',
    description: 'Facts → alternatives → evaluation → recommendation',
    initial: {
      mode: 'analyst',
      objective_placeholder: 'Help me decide: [decision] — key consideration is [criterion]',
      constraints: 'Start by listing established facts and assumptions explicitly.',
      output_format: 'Two sections: "Known Facts" and "Key Assumptions"',
    },
    steps: [
      { label: 'Step 1 — Facts & assumptions', hint: 'Establish the shared knowledge base. Pin the facts to Session Facts.' },
      { label: 'Step 2 — Alternatives', hint: 'Refine prompt to generate 3 alternatives grounded in those facts.' },
      { label: 'Step 3 — Evaluate each', hint: 'Use "Refine as… More cautious" to evaluate each with risks and trade-offs.' },
      { label: 'Step 4 — Recommend', hint: 'Finalize with the recommendation and rationale tied to the facts.' },
    ],
  },
  {
    id: 'writing',
    name: 'Writing Stack',
    description: 'Draft → critique → refine → finalize',
    initial: {
      mode: 'clarity',
      objective_placeholder: 'Write a [document type] about [topic] for [audience]',
      constraints: 'Produce a first draft focused on clarity. Length appropriate to audience.',
      output_format: 'Short paragraphs with clear section headings',
    },
    steps: [
      { label: 'Step 1 — First draft', hint: 'Get a clarity-focused first draft.' },
      { label: 'Step 2 — Critique', hint: 'Use "Challenge This" or switch to Critic mode to find weak points.' },
      { label: 'Step 3 — Refine', hint: 'Use "Refine as… More concrete" or "Different angle" based on critique.' },
      { label: 'Step 4 — Self-audit', hint: 'Use "Self-Audit" to verify the final draft addresses the original objective.' },
    ],
  },
  {
    id: 'debug',
    name: 'Debug Stack',
    description: 'Symptoms → hypotheses → test each → fix',
    initial: {
      mode: 'analyst',
      objective_placeholder: 'Debug: [symptom / unexpected behavior] in [system / context]',
      constraints: 'List observable symptoms precisely. Avoid guessing causes yet.',
      output_format: 'Numbered symptom list with reproducibility notes',
    },
    steps: [
      { label: 'Step 1 — Symptoms', hint: 'List everything observable. Pin key facts to Session Facts.' },
      { label: 'Step 2 — Hypotheses', hint: 'Refine prompt to generate 3-5 hypotheses that fit the symptoms.' },
      { label: 'Step 3 — Test each', hint: 'Use "Challenge This" or switch to Cold Critic to stress-test hypotheses.' },
      { label: 'Step 4 — Fix', hint: 'Finalize with the fix rooted in the most likely hypothesis.' },
    ],
  },
];

export const EXAMPLES: Array<{ label: string; objective: string; audience: string; constraints: string; mode: ModeType }> = [
  {
    label: 'Architect — structured planning',
    objective: 'Design a structured plan for launching an online course, including content outline, timeline, platform requirements, and marketing strategy',
    audience: 'General',
    constraints: 'Must be actionable within 90 days, budget under $5K',
    mode: 'architect',
  },
  {
    label: 'Critic — strategy review',
    objective: 'Evaluate this product strategy: We plan to launch a social media app targeting users aged 18-25 by competing directly with Instagram on photo sharing',
    audience: 'Executive',
    constraints: 'Budget is $50K, team of 3 developers, 6-month timeline',
    mode: 'critic',
  },
  {
    label: 'Clarity — simplify a concept',
    objective: 'Explain how supply chain logistics work, from manufacturer to end consumer, including the role of distributors, warehouses, and last-mile delivery',
    audience: 'Student',
    constraints: 'No jargon, use everyday analogies, under 300 words',
    mode: 'clarity',
  },
  {
    label: 'Coach — personal roadmap',
    objective: "I'm starting a new management role and feeling overwhelmed. Help me create a 30-day plan to build trust with my team and get up to speed",
    audience: 'General',
    constraints: 'Focus on practical steps, not theory. Include daily time commitments under 2 hours',
    mode: 'coach',
  },
  {
    label: 'Therapist — explore a dilemma',
    objective: "I'm feeling overwhelmed and burned out at work but I don't know if I should quit or push through. Help me explore what's really going on.",
    audience: 'General',
    constraints: 'Focus on understanding feelings, not giving career advice yet',
    mode: 'therapist',
  },
  {
    label: 'Cold Critic — tear apart a pitch',
    objective: "Our startup pitch: We're building an AI-powered personal finance app that uses GPT to give investment advice to millennials. We plan to launch in 3 months with a team of 2.",
    audience: 'Executive',
    constraints: 'No praise. Only risks, flaws, and problems.',
    mode: 'cold_critic',
  },
  {
    label: 'Analyst — market research',
    objective: 'Analyze the remote work software market: key players, trends, growth drivers, and risks for a new entrant targeting small businesses',
    audience: 'Executive',
    constraints: 'Separate facts from assumptions. Quantify where possible.',
    mode: 'analyst',
  },
  {
    label: 'Clarity — refine a rough idea',
    objective: "I have a vague idea about improving team productivity at my company, but I'm not sure where to start or what the real problem is. Help me structure this into something clear and actionable.",
    audience: 'General',
    constraints: 'Focus on clarifying the core problem before suggesting solutions',
    mode: 'clarity',
  },
];

export const AUDIENCE_OPTIONS = ['General', 'Technical', 'Executive', 'Academic', 'Student', 'Other'];

export const TIER_INFO = {
  1: { name: 'Prompt Starter', color: '#9CA3AF', bg: '#F3F4F6' },
  2: { name: 'Prompt Practitioner', color: '#3B82F6', bg: '#EFF6FF' },
  3: { name: 'Prompt Architect', color: '#8B5CF6', bg: '#F5F3FF' },
  4: { name: 'PromptMaster', color: '#F59E0B', bg: '#FFFBEB' },
} as const;

export const DEFAULT_MODEL = 'openai/gpt-5.4';

/**
 * The models a project can be set to from its brief (17 Oct, Sean: compare
 * PromptMaster with a plain chat on the same underlying model). Any other
 * OpenRouter id still works through the recovery panel's model list.
 */
export const MODEL_CHOICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: DEFAULT_MODEL, label: 'GPT-5.4 (default)' },
  { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5' },
];
