'use client';

import { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Spotlight } from '@/components/ui/spotlight';
import { ContainerScroll } from '@/components/ui/container-scroll-animation';
import { Card } from '@/components/ui/card';
import { useT } from '@/lib/i18n/i18n-provider';
import type { MessageKey } from '@/lib/i18n/messages/en';
import { LocaleSwitch } from '@/components/shared/locale-switch';

/**
 * What the product is for, in the words a first-time visitor asks in (Harold,
 * via Sean, 9 Oct: who is it for, and why this rather than another AI tool?).
 * Every line here is something the code does today; the assessment
 * docs/assessments/2026-10-10-first-tester-path.md says where each one lives.
 *
 * 14 Oct (Sean): "What a chat does not do" was too absolute — a chat handled
 * his basic report-and-update test — and three promises outran what can be
 * shown every time (one-click realignment, "only the affected work is
 * repaired", "approvals enforced in code"). The section now says how the
 * project is managed, and each card says only what the build does; see
 * docs/assessments/2026-10-14-revision-preservation-and-conflicts.md.
 */
const STEPS: { step: string; key: 'step1' | 'step2' | 'step3' | 'step4'; icon: string }[] = [
  { step: '01', key: 'step1', icon: 'edit_note' },
  { step: '02', key: 'step2', icon: 'account_tree' },
  { step: '03', key: 'step3', icon: 'rocket_launch' },
  { step: '04', key: 'step4', icon: 'verified_user' },
];

const AUDIENCE = ['analysts', 'auditors', 'lawyers', 'strategists', 'researchers', 'consultants'] as const;

const MANAGED = [
  { icon: 'account_tree', key: 'workflow' },
  { icon: 'fact_check', key: 'facts' },
  { icon: 'rule', key: 'checked' },
  { icon: 'gavel', key: 'approval' },
  { icon: 'history', key: 'history' },
  { icon: 'rocket_launch', key: 'go' },
] as const;

/** A change, handled: what the workshop test showed, as it now works (14 Oct). */
const EXAMPLE = {
  changed: ['land.ex.changed1', 'land.ex.changed2'],
  kept: ['land.ex.kept1', 'land.ex.kept2'],
} as const satisfies Record<string, readonly MessageKey[]>;

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
  // The whole site in the chosen language (23 Oct); the layout reads the cookie.
  const t = useT();
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
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/80">
              {t('land.beta')}
            </span>
            <LocaleSwitch tone="dark" className="hidden sm:flex" />
            <Link
              href="/auth/login"
              className="text-sm text-white/80 hover:text-white transition-colors"
            >
              {t('land.signIn')}
            </Link>
          </div>
        </div>
      </nav>

      {/* ===== HERO SECTION (only section with Spotlight) ===== */}
      <section className="relative lg:min-h-screen overflow-hidden">
        <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="#2563eb" />

        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-28 pb-10 md:pt-32 md:pb-20 flex flex-col lg:flex-row items-center lg:min-h-screen">
          <div className="flex-1 space-y-8 text-center lg:text-left">
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/40 leading-[1.1]">
              {t('land.heroA')}
              <br />
              {t('land.heroB')}
            </h1>

            <p className="text-lg md:text-xl text-white/75 max-w-xl leading-relaxed">
              {t('land.heroLead')}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Link
                href="/projects"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[var(--pm-primary)] text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                {t('land.start')}
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white/5 text-white/80 text-sm font-semibold rounded-xl border border-white/10 hover:bg-white/10 transition-all"
              >
                {t('land.seeHow')}
              </a>
            </div>
          </div>

          <div className="flex-1 relative h-[260px] sm:h-[400px] lg:h-[500px] w-full mt-8 lg:mt-0">
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
                {t('land.interface')}
              </p>
              <h2 className="text-4xl md:text-[3.5rem] font-bold text-white leading-tight tracking-tight">
                {t('land.notChatA')}
                <br />
                <span className="text-blue-400">{t('land.notChatB')}</span>
              </h2>
            </div>
          }
        >
          <Image
            src="/app-screenshot.png"
            alt={t('land.screenshotAlt')}
            height={720}
            width={1400}
            className="mx-auto rounded-2xl object-cover h-full object-left-top"
            draggable={false}
            priority={false}
          />
        </ContainerScroll>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how-it-works" className="py-16 md:py-32 section-offscreen">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-10 md:mb-20 space-y-4">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              {t('land.howKicker')}
            </p>
            <h2 className="text-4xl md:text-5xl font-semibold text-white tracking-tight">
              {t('land.howTitle')}
            </h2>
            <p className="text-base text-white/75 max-w-2xl mx-auto leading-relaxed">
              {t('land.howLead')}
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
                    {t(`land.${phase.key}.name`)}
                  </h3>
                  <p className="text-sm md:text-[15px] text-white/75 leading-relaxed">
                    {t(`land.${phase.key}.desc`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== WHO IT IS FOR ===== */}
      <section className="py-16 md:py-32 section-offscreen">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-10 md:mb-20 space-y-4">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              {t('land.whoKicker')}
            </p>
            <h2 className="text-4xl md:text-5xl font-semibold text-white tracking-tight">
              {t('land.whoTitle')}
            </h2>
            <p className="text-base text-white/75 max-w-2xl mx-auto leading-relaxed">
              {t('land.whoLead')}
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-3">
            {AUDIENCE.map((who) => (
              <Card
                key={who}
                className="px-6 py-3 bg-white/[0.03] border-white/[0.06] cursor-default"
              >
                <span className="text-sm font-semibold text-white">{t(`land.who.${who}`)}</span>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ===== HOW PROMPTMASTER MANAGES YOUR PROJECT ===== */}
      <section className="py-16 md:py-32 section-offscreen">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-10 md:mb-20 space-y-4">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">
              {t('land.beyondKicker')}
            </p>
            <h2 className="text-4xl md:text-5xl font-semibold text-white tracking-tight">
              {t('land.beyondTitle')}
            </h2>
            <p className="text-base text-white/75 max-w-2xl mx-auto leading-relaxed">
              {t('land.beyondLead')}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            {MANAGED.map((item) => (
              <div key={item.icon} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 md:p-8 space-y-3 md:space-y-4">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <span className="material-symbols-outlined text-blue-400">{item.icon}</span>
                </div>
                <h3 className="text-lg font-bold text-white">{t(`land.m.${item.key}.title`)}</h3>
                <p className="text-sm md:text-[15px] text-white/75 leading-relaxed">{t(`land.m.${item.key}.desc`)}</p>
              </div>
            ))}
          </div>

          {/* A change, handled */}
          <div aria-label={t('land.change')} className="mt-10 md:mt-16 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-6 md:p-8">
            <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-400">{t('land.change')}</p>
            <p className="mt-3 text-lg text-white">&ldquo;{t('land.ex.asked')}&rdquo;</p>
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <p className="text-sm font-semibold text-white">{t('land.ex.changedTitle')}</p>
                <ul className="mt-2 space-y-1.5">
                  {EXAMPLE.changed.map((line) => (
                    <li key={line} className="flex gap-2 text-sm md:text-[15px] text-white/75">
                      <span className="material-symbols-outlined text-[18px] text-blue-400">edit</span>
                      {t(line)}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{t('land.ex.keptTitle')}</p>
                <ul className="mt-2 space-y-1.5">
                  {EXAMPLE.kept.map((line) => (
                    <li key={line} className="flex gap-2 text-sm md:text-[15px] text-white/75">
                      <span className="material-symbols-outlined text-[18px] text-emerald-400">check_circle</span>
                      {t(line)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-5 text-sm text-white/65">
              {t('land.ex.note')}
            </p>
          </div>
        </div>
      </section>

      {/* ===== CTA ===== */}
      <section className="py-16 md:py-32 relative overflow-hidden">
        <Spotlight className="-top-40 right-0 md:right-60 md:-top-20" fill="#2563eb" />
        <div className="relative z-10 max-w-3xl mx-auto px-6 text-center space-y-8">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
            {t('land.ctaTitle')}
          </h2>
          <p className="text-lg text-white/75 max-w-xl mx-auto">
            {t('land.ctaLead')}
          </p>
          <Link
            href="/projects"
            className="inline-flex items-center justify-center gap-2 px-10 py-4 bg-[var(--pm-primary)] text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            {t('land.ctaButton')}
          </Link>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="pt-10 pb-24 md:py-12 border-t border-white/5">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="PromptMaster" className="w-6 h-6 rounded" />
            <span className="text-sm text-white/70">PromptMaster</span>
          </div>
          <p className="text-xs text-white/60">
            {t('land.footer')}
          </p>
          <LocaleSwitch tone="dark" />
        </div>
      </footer>
    </div>
  );
}
