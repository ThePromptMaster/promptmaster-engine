'use client';

import { useState } from 'react';

import { TOOLKITS, toolkitLogoUrl, type ToolkitSlug } from '@/lib/connections/items';

/**
 * A connected account's logo (8 Nov): Gmail's, Outlook's and so on, as Composio
 * serves them, beside the account's name, so the mark is the real one. Decorative:
 * the name is always written next to it. If the logo can't be loaded, or the account
 * isn't known, a Material icon takes its place (`fallback`, else the toolkit's own).
 */
export function ToolkitLogo({
  slug,
  size = 20,
  fallback,
  className = '',
}: {
  slug: ToolkitSlug | string | null | undefined;
  size?: number;
  fallback?: string;
  className?: string;
}) {
  const toolkit = TOOLKITS.find((t) => t.slug === slug);
  const [failed, setFailed] = useState(false);
  if (!toolkit || failed) {
    return (
      <span aria-hidden data-logo-fallback className={`material-symbols-outlined shrink-0 ${className}`} style={{ fontSize: size }}>
        {fallback ?? toolkit?.icon ?? 'link'}
      </span>
    );
  }
  return (
    // A remote SVG at a fixed size: next/image would only add a proxy hop.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={toolkitLogoUrl(toolkit.slug)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
