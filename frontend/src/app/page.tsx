'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Spotlight } from '@/components/ui/spotlight';
import { ContainerScroll } from '@/components/ui/container-scroll-animation';
import { Card } from '@/components/ui/card';

/**
 * What the product is for, in the words a first-time visitor asks in (Harold,
 * via Sean, 9 Oct: who is it for, and why this rather than another AI tool?).
 * Every line here is something the code does today; the assessment
 * docs/assessments/2026-10-10-first-tester-path.md says where each one lives.
 */
const STEPS = [
  { step: '01', name: 'Say what you need', desc: 'One sentence is enough. PromptMaster suggests how to set the work up; nothing to fill in first.', icon: 'edit_note' },
  { step: '02', name: 'It picks the workflow', desc: 'A memo, a report, a research study, a book — each has stages suited to it, and you can change any of them.', icon: 'account_tree' },
  { step: '03', name: 'Go does the stages', desc: 'Drafts, checks and repairs each stage against your objective, and tells you in three lines what it did.', icon: 'rocket_launch' },
  { step: '04', name: 'You approve what is yours', desc: 'Routine decisions it can take for you; the ones that matter stop for you. Then export to Word or PDF.', icon: 'verified_user' },
];

const AUDIENCE = ['Analysts', 'Auditors', 'Lawyers', 'Strategists', 'Researchers', 'Consultants'];

const VERSUS_CHAT = [
  { icon: 'rule', title: 'Checked against your objective', desc: 'A separate pass scores the work for alignment, clarity, drift and completeness, and suggests the fixes. One click realigns drifted work.' },
  { icon: 'fact_check', title: 'Your facts stay facts', desc: 'Figures and requirements you accept go into every stage. Change one and only the work that used it is reopened and repaired.' },
  { icon: 'history', title: 'Nothing is overwritten', desc: 'Every version is kept. Figures in the text are checked against your material, and estimates are labelled as estimates.' },
  { icon: 'rocket_launch', title: 'It does the stages, not just the reply', desc: 'Go moves the work forward stage by stage, runs calculations where they are needed, and says plainly what was run and what was only written.' },
  { icon: 'gavel', title: 'Your decisions stay yours', desc: 'Approvals are rules checked in code, not a model’s opinion. What only you can sign off on always waits for you.' },
  { icon: 'description', title: 'A record you can defend', desc: 'Every stage, check and decision is on record — and when an expert has to decide, it prepares the package for them.' },
];

/** Load Spline when visible, UNLOAD when scrolled away to free GPU for scroll animations */
function LazySpline() {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [SplineScene, setSplineScene] = useState<React.ComponentType<{ scene: string; className?: string }> | null>(null);
  const moduleLoaded = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (inView && !moduleLoaded.current) {
      moduleLoaded.current = true;
      import('@/components/ui/splite').then((mod) => setSplineScene(() => mod.SplineScene));
    }
  }, [inView]);

  return (
    <div ref={ref} className="w-full h-full">
      {SplineScene && inView ? (
        <SplineScene
          scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
          className="w-full h-full"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          {inView && (
            <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          )}
        </div>
      )}
    </div>
  );
}

export default function LandingPage() {
  // Sync body background with landing page dark theme
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    body.style.backgroundColor = '#0a0a1a';
    html.style.backgroundColor = '#0a0a1a';
    return () => {
      body.style.backgroundColor = '';
      html.style.backgroundColor = '';
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a1a]">
      {/* ===== NAVIGATION ===== */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a1a]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="PromptMaster" className="w-8 h-8 rounded-lg" />
            <span className="text-white font-semibold tracking-tight">PromptMaster</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/auth/login"
              className="text-sm text-white/60 hover:text-white transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </nav>

      {/* ===== HERO SECTION (only section with Spotlight) ===== */}
      <section className="relative min-h-screen overflow-hidden">
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="#2563eb" />

        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-20 flex flex-col lg:flex-row items-center min-h-screen">
          <div className="flex-1 space-y-8 text-center lg:text-left">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/40 leading-[1.1]">
              Work you can
              <br />
              stand behind.
            </h1>

            <p className="text-lg md:text-xl text-white/50 max-w-xl leading-relaxed">
              Give PromptMaster a goal. It takes the work through the stages a
              careful professional would — drafting, checking, repairing — and
              hands you a finished deliverable with the record of how it got there.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Link
                href="/projects"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--pm-primary)] text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                Start a project
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/5 text-white/80 text-sm font-semibold rounded-xl border border-white/10 hover:bg-white/10 transition-all"
              >
                See How It Works
              </a>
            </div>
          </div>

          <div className="flex-1 relative h-[400px] lg:h-[500px] w-full mt-12 lg:mt-0">
            <LazySpline />
          </div>
        </div>
      </section>

      {/* ===== PRODUCT SHOWCASE (ContainerScroll) ===== */}
      <section className="relative">
        <ContainerScroll
          titleComponent={
            <div className="space-y-4 mb-8">
              <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
                The Interface
              </p>
              <h2 className="text-4xl md:text-[3.5rem] font-bold text-white leading-tight tracking-tight">
                Not another chatbox.
                <br />
                <span className="text-blue-400">A structured workflow.</span>
              </h2>
            </div>
          }
        >
          <Image
            src="/app-screenshot.png"
            alt="A PromptMaster project: the stages on the left, the deliverable in the middle"
            height={720}
            width={1400}
            className="mx-auto rounded-2xl object-cover h-full object-left-top"
            draggable={false}
            priority={false}
          />
        </ContainerScroll>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how-it-works" className="py-32 section-offscreen">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20 space-y-4">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              How It Works
            </p>
            <h2 className="text-4xl md:text-5xl font-semibold text-white tracking-tight">
              From a goal to a finished deliverable.
            </h2>
            <p className="text-sm text-white/40 max-w-2xl mx-auto leading-relaxed">
              No prompt engineering, no blank form. Say what you need, and the
              structure is set up for you.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {STEPS.map((phase) => (
              <div key={phase.step}>
                <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 h-full space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-extrabold text-blue-400 tracking-widest">
                      {phase.step}
                    </span>
                    <span className="material-symbols-outlined text-blue-400 text-[20px]">
                      {phase.icon}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    {phase.name}
                  </h3>
                  <p className="text-sm text-white/40 leading-relaxed">
                    {phase.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== WHO IT IS FOR ===== */}
      <section className="py-32 section-offscreen">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20 space-y-4">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              Who it is for
            </p>
            <h2 className="text-4xl md:text-5xl font-semibold text-white tracking-tight">
              For people who answer for their work.
            </h2>
            <p className="text-sm text-white/40 max-w-2xl mx-auto leading-relaxed">
              If you need a quick answer, a chat is faster. PromptMaster is for the
              memo, report or study you will have to defend afterwards.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {AUDIENCE.map((who) => (
              <Card
                key={who}
                className="px-6 py-3 bg-white/[0.03] border-white/[0.06] cursor-default"
              >
                <span className="text-sm font-semibold text-white">{who}</span>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ===== KEY DIFFERENTIATORS ===== */}
      <section className="py-32 section-offscreen">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20 space-y-4">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              Why not just a chat
            </p>
            <h2 className="text-4xl md:text-5xl font-semibold text-white tracking-tight">
              What a chat does not do.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {VERSUS_CHAT.map((item) => (
              <div key={item.icon} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 space-y-4">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-blue-400">{item.icon}</span>
                </div>
                <h3 className="text-lg font-bold text-white">{item.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="py-32 relative overflow-hidden">
        <Spotlight className="-top-40 right-0 md:right-60 md:-top-20" fill="#2563eb" />
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center space-y-8">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
            What do you need to get done?
          </h2>
          <p className="text-lg text-white/50 max-w-xl mx-auto">
            Say it in a sentence. You will have a first draft in a couple of
            minutes, and you decide how far Go takes it.
          </p>
          <Link
            href="/projects"
            className="inline-flex items-center justify-center gap-2 px-10 py-4 bg-[var(--pm-primary)] text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            Start your first project
          </Link>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="py-12 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="PromptMaster" className="w-6 h-6 rounded" />
            <span className="text-sm text-white/40">PromptMaster</span>
          </div>
          <p className="text-xs text-white/30">
            From a goal to work you can stand behind
          </p>
        </div>
      </footer>
    </div>
  );
}
