'use client';

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string };

/**
 * A textarea that is always as tall as what it holds.
 *
 * Fixed-row boxes clipped long entries mid-sentence with no visible scrollbar
 * on iPad ("…among others" cut off in Sean's Research screenshot), so it looked
 * as if the text had been lost. `rows` stays the minimum height.
 *
 * Measured in JS rather than with CSS `field-sizing: content`, which iPad
 * Safari does not reliably support.
 */
export function AutoGrowTextarea({ value, className = '', style, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      className={`resize-none overflow-hidden ${className}`}
      style={style}
      {...rest}
    />
  );
}
