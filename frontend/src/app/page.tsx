'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Spotlight } from '@/components/ui/spotlight';
import { ContainerScroll } from '@/components/ui/container-scroll-animation';
import { Card } from '@/components/ui/card';

const MODES = [
  { icon: 'architecture', name: 'Architect', desc: 'Structure, systems, and frameworks' },
  { icon: 'rate_review', name: 'Critic', desc: 'Finding weak points and contradictions' },
  { icon: 'lightbulb', name: 'Clarity', desc: 'Translating complexity into understanding' },
  { icon: 'sports', name: 'Coach', desc: 'Motivation and reframing obstacles' },
  { icon: 'psychology', name: 'Therapist', desc: 'Empathetic exploration and insight' },
  { icon: 'ac_unit', name: 'Cold Critic', desc: 'Brutal honesty, zero praise' },
  { icon: 'analytics', name: 'Analyst', desc: 'Data-driven, evidence-based reasoning' },
  { icon: 'tune', name: 'Custom', desc: 'Your own mode — define the persona' },
];

const PHASES = [
  { step: '01', name: 'Define', desc: 'Choose a mode, set your objective, audience, and constraints.', icon: 'edit_note' },
  { step: '02', name: 'Review', desc: 'See the optimized prompt with invisible scaffolding built in.', icon: 'visibility' },
  { step: '03', name: 'Execute', desc: 'Generate output with a separate, independent AI evaluation.', icon: 'electric_bolt' },
  { step: '04', name: 'Evaluate', desc: 'See alignment, clarity, and drift scores with actionable suggestions.', icon: 'assessment' },
  { step: '05', name: 'Refine', desc: 'Iterate, realign, or finalize — every cycle improves the output.', icon: 'auto_fix_high' },
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
              Stop prompting.
              <br />
              Start thinking.
            </h1>

            <p className="text-lg md:text-xl text-white/50 max-w-xl leading-relaxed">
              Get clearer, more precise results by structuring how you interact
              with AI — using modes, evaluation, and iterative refinement.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Link
                href="/projects"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--pm-primary)] text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                Start Building
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
            alt="PromptMaster session interface"
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
              Five phases. One aligned output.
            </h2>
            <p className="text-sm text-white/40 max-w-2xl mx-auto leading-relaxed">
              PromptMaster structures every AI interaction into a repeatable loop:
              define, review, execute, evaluate, and refine — until the output
              matches your intent.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {PHASES.map((phase) => (
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

      {/* ===== MODES ===== */}
      <section className="py-32 section-offscreen">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-20 space-y-4">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              8 Modes
            </p>
            <h2 className="text-4xl md:text-5xl font-semibold text-white tracking-tight">
              Choose how the AI thinks.
            </h2>
            <p className="text-sm text-white/40 max-w-2xl mx-auto leading-relaxed">
              Each mode locks the AI into a specific persona with tailored tone,
              structure, and invisible scaffolding — so the output matches the
              task, not a generic response.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {MODES.map((mode) => (
              <Card
                key={mode.name}
                className="p-6 bg-white/[0.03] border-white/[0.06] cursor-default"
              >
                <span className="material-symbols-outlined text-blue-400 text-[28px] mb-4 block">
                  {mode.icon}
                </span>
                <h3 className="text-sm font-bold text-white mb-1">
                  {mode.name}
                </h3>
                <p className="text-xs text-white/40 leading-relaxed">
                  {mode.desc}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ===== KEY DIFFERENTIATORS ===== */}
      <section className="py-32 section-offscreen">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: 'verified', title: 'Independent Evaluation', desc: 'A separate AI call scores every output on alignment, clarity, and drift — the AI never grades itself.' },
              { icon: 'target', title: 'Drift Detection', desc: 'Every output is checked for scope deviation. When drift is detected, the system triggers a corrective realignment.' },
              { icon: 'auto_fix_high', title: 'Iterative Refinement', desc: 'Each cycle improves on the last. Actionable suggestions tell you exactly what to change and which action to take next.' },
            ].map((item) => (
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
            Ready to think with AI?
          </h2>
          <p className="text-lg text-white/50 max-w-xl mx-auto">
            Define your request. Let the system structure it. Evaluate the
            result. Refine until it&apos;s right.
          </p>
          <Link
            href="/projects"
            className="inline-flex items-center justify-center gap-2 px-10 py-4 bg-[var(--pm-primary)] text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            Start Your First Session
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
            A structured system for thinking with AI
          </p>
        </div>
      </footer>
    </div>
  );
}
