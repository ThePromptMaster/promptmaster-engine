'use client';

import Link from 'next/link';

const PRINCIPLES = [
  {
    number: 1,
    title: 'See Through the Interface Illusion — Always Seek the Structure.',
    body: 'I will not be fooled by simplicity. I recognize that what looks like a chat is actually a complex system. I will always look beyond the surface of the AI\'s interface and design the structure behind our interaction. This means I frame my prompts intentionally, supply context, and define roles, rather than assuming the AI "just knows" what I mean. In every session, I will consciously build an environment for intelligence to emerge — because intelligence thrives on structure, not on guesswork.',
  },
  {
    number: 2,
    title: 'Define Goals and Align Every Step to Them.',
    body: 'I will begin with the end in mind. Whether my goal is a precise answer, a creative idea, or a strategic plan, I will state it clearly (to the AI and to myself). I will use goal anchors to keep the AI focused and I will regularly check that each response is serving the objective. If the conversation drifts, I will course-correct immediately. I won\'t blame the AI for confusion that comes from vague direction — I take ownership of alignment. Every prompt I send will have a purpose tied to my true goal.',
  },
  {
    number: 3,
    title: 'Embrace Iteration, Avoid One-Shot Thinking.',
    body: 'I will treat complex tasks as a process, not a single prompt. I commit to an iterative approach: breaking problems into sub-tasks, asking follow-up questions, refining answers, and building solutions step by step. I won\'t settle for the first output if it can be improved through clarification or additional prompts. This principle reminds me that depth is achieved through dialogue, and persistence often unlocks insights that a single query would never yield.',
  },
  {
    number: 4,
    title: 'Use Modes and Personas Deliberately.',
    body: 'I will actively shape the AI\'s role and style as needed. Rather than accept whatever default voice or approach the AI starts with, I will invoke the mode or persona that best suits my task — be it a strict logician, a brainstorming creative, a compassionate advisor, or a Cold Critic. I will lock in the mode firmly (through explicit instructions) and maintain it until a change is needed. If a different perspective or style becomes beneficial, I will intentionally switch modes. In short, I control the tone and lens of the AI, not the other way around.',
  },
  {
    number: 5,
    title: 'Never Trust the First Draft — Verify and Validate.',
    body: 'I remain skeptical of outputs until proven. No matter how confident or eloquent an AI answer sounds, I will verify critical facts and test the solution\'s robustness. This might mean asking the AI to show its reasoning, provide sources, or run a self-check. It could also mean using external verification or common sense. I understand that AI can sound right and still be wrong. As a PromptMaster, I treat AI outputs as hypotheses or drafts — starting points to examine and improve, not absolute truths.',
  },
  {
    number: 6,
    title: 'Leverage the Mirror — Learn from the AI about Myself.',
    body: 'I will use each interaction as a reflection on my own thinking. If an output is unclear, I consider how my question might have been unclear. Patterns in the AI\'s responses (good or bad) give me insight into how I\'m steering the conversation. I welcome this feedback. I will even ask the AI to summarize or critique my approach (as a mirror) to reveal my blind spots. My goal is not just to get answers, but to continually refine my ability to ask the right questions.',
  },
  {
    number: 7,
    title: 'Prioritize Clarity Over Comfort.',
    body: 'I won\'t shy away from hard truths in pursuit of pleasing answers. If there\'s a flaw in my idea or a weakness in a plan, I want to know — better now than later. I will regularly deploy critical modes (like Cold Critic) to sniff out nonsense, fluff, or errors, even if it\'s unpleasant. I won\'t let ego or impatience prevent me from seeing where my approach is wrong or could be better. Clarity sometimes requires critique; I will seek that clarity relentlessly.',
  },
  {
    number: 8,
    title: 'Adapt and Continue Learning Endlessly.',
    body: 'I acknowledge that mastery is a moving target. Technologies evolve, and so will I. I commit to staying curious and experimenting with new techniques, prompts, and AI capabilities. If a new tool or model emerges, I will approach it with the same structured mindset and integrate it into my practice. Challenges or failures are just data for improvement. I will never consider myself "done" learning. The moment I stop actively refining my skills, I\'ve lost the spirit of PromptMastery.',
  },
  {
    number: 9,
    title: 'Share Knowledge and Uphold Ethics.',
    body: 'I will use my skills responsibly and for good. Mastery confers influence — I can shape powerful outputs and even guide how others use AI. I will share my frameworks and insights to help others rise (there\'s no scarcity in knowledge). I\'ll also guard against misuse: if I see unethical or harmful application of AI, I\'ll speak up or design solutions to prevent it. I commit to considering the broader impact of the systems I design — respecting privacy, fairness, and human dignity. A true PromptMaster leads by example, ensuring AI augments humanity positively.',
  },
  {
    number: 10,
    title: 'Remember the Human at the Core.',
    body: 'I will not forget that AI is ultimately a tool to serve human needs. Whether I\'m using AI to write, code, brainstorm or analyze, I remain the responsible agent. I use AI to amplify creativity and intelligence, but not to replace my judgment. I maintain empathy in my outcomes — considering how they affect people. I ensure the workflows I build keep humans in the loop where it matters. In sum, I align AI\'s use with human values and purposes, never losing sight of why I started the task in the first place.',
  },
];

export default function CompactPage() {
  return (
    <div className="min-h-screen bg-[var(--surface)]">
      {/* Header */}
      <header className="border-b border-[var(--outline-variant)]/20 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-6 flex items-center">
          <Link href="/projects" className="flex items-center gap-2 text-sm text-[var(--on-surface-variant)] hover:text-[var(--on-surface)] transition-colors">
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            Back to session
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-12 text-center space-y-4">
        <p className="text-xs uppercase tracking-[0.25em] font-bold text-[var(--pm-primary)]">
          Principles of Structured, Ethical AI Mastery
        </p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-[var(--on-surface)] leading-tight">
          The PromptMaster&apos;s Compact
        </h1>
        <p className="text-sm md:text-base text-[var(--on-surface-variant)] max-w-xl mx-auto italic leading-relaxed pt-4">
          &ldquo;This is the return to signal. This is the end of drift. This is the beginning of the real work.&rdquo;
        </p>
      </section>

      {/* Intro */}
      <section className="max-w-3xl mx-auto px-6 pb-12">
        <div className="bg-white rounded-xl shadow-ambient p-8 space-y-4 text-sm leading-relaxed text-[var(--on-surface-variant)]">
          <p>
            These ten principles encapsulate what it means to practice prompt mastery at
            the highest level. Think of them as a code of conduct and mindset in one — a
            guide to ensure that the power you wield with AI is grounded in clarity,
            purpose, and responsibility.
          </p>
          <p>
            Taken together, they form a Compact — an agreement you make with yourself
            (and indirectly with any AI you work with) to uphold the highest standard of
            interactive intelligence.
          </p>
        </div>
      </section>

      {/* Principles */}
      <section className="max-w-3xl mx-auto px-6 pb-16 space-y-6">
        {PRINCIPLES.map((p) => (
          <article key={p.number} className="bg-white rounded-xl shadow-ambient p-8 space-y-4">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--pm-primary)] text-white flex items-center justify-center font-bold text-sm">
                {p.number}
              </div>
              <h2 className="text-lg md:text-xl font-bold text-[var(--on-surface)] leading-tight pt-1">
                {p.title}
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-[var(--on-surface-variant)] pl-14">
              {p.body}
            </p>
          </article>
        ))}
      </section>

      {/* Footer */}
      <footer className="max-w-3xl mx-auto px-6 pb-20 text-center space-y-6">
        <p className="text-sm italic text-[var(--on-surface-variant)] leading-relaxed">
          Prompt with purpose. Design with clarity. Lead with ethics.
          <br />
          And never stop learning.
        </p>
        <div>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--pm-primary)] text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            Return to session
          </Link>
        </div>
      </footer>
    </div>
  );
}
