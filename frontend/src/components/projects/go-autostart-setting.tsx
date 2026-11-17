'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { useT } from '@/lib/i18n/i18n-provider';
import { loadGoAutostart, saveGoAutostart } from '@/lib/supabase/preferences';

/**
 * Whether Go starts by itself when a project is made (17 Nov, Sean: "whether Go should
 * start automatically once the user starts the project"). On unless turned off here.
 */
export function GoAutostartSetting() {
  const t = useT();
  const { user } = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void loadGoAutostart(user.id).then((v) => {
      if (live) setOn(v);
    });
    return () => {
      live = false;
    };
  }, [user]);

  if (!user || on === null) return null;
  return (
    <section aria-label={t('auto.title')} className="mt-8 rounded-xl bg-[var(--surface-container-low)] px-5 py-4">
      <label className="flex items-start gap-3 text-body text-[var(--on-surface)]">
        <input
          type="checkbox"
          data-go-autostart
          className="mt-1"
          checked={on}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            setFailed(false);
            void saveGoAutostart(user.id, next).catch(() => {
              setOn(!next);
              setFailed(true);
            });
          }}
        />
        <span>
          <span className="block font-semibold">{t('auto.title')}</span>
          <span className="block text-label text-[var(--on-surface-variant)]">{t('auto.lead')}</span>
        </span>
      </label>
      {failed && <p role="alert" className="mt-2 text-label text-[var(--pm-error)]">{t('auto.failed')}</p>}
    </section>
  );
}
