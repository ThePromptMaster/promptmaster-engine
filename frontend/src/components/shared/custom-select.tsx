'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface CustomSelectOption {
  value: string;
  label: string;
  description?: string;
}

interface CustomSelectProps {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Names the control when there is no visible label beside it. */
  ariaLabel?: string;
}

/**
 * A select.
 *
 * Was a button that opened a list of buttons: operable by keyboard, but
 * announced as "button", with no indication that it opens a list, what is
 * selected, or how many options there are. It now carries combobox/listbox
 * semantics and the arrow-key navigation people expect from a select, because
 * a status control on a review table is exactly where that matters.
 */
export function CustomSelect({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  className = '',
  ariaLabel,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Opening lands on the current value rather than the top of the list. Done
  // at the point of opening rather than in an effect on `open`, which would
  // set state during render and cascade.
  function openList() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function commit(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    // Focus returns to the trigger, or the user is stranded where the list was.
    triggerRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        className={`w-full flex items-center justify-between gap-2 px-4 py-3 bg-[var(--surface-container-low)] rounded-lg text-sm text-left transition-all duration-200 outline-none ${
          open
            ? 'ring-2 ring-[var(--pm-primary)]/40 bg-white'
            : 'hover:bg-[var(--surface-container-high)]'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`truncate ${selected ? 'text-[var(--on-surface)]' : 'text-[var(--outline)]'}`}>
          {selected?.label ?? placeholder}
        </span>
        <span
          aria-hidden
          className={`material-symbols-outlined text-[18px] text-[var(--outline)] transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        >
          expand_more
        </span>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-xl bg-white shadow-lg shadow-black/10 border border-[var(--outline-variant)]/20 py-1 custom-scrollbar"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              onClick={() => commit(index)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`cursor-pointer px-4 py-2.5 text-sm transition-colors ${
                option.value === value
                  ? 'bg-[var(--primary-fixed)]/30 text-[var(--pm-primary)] font-medium'
                  : index === activeIndex
                    ? 'bg-[var(--surface-container-low)] text-[var(--on-surface)]'
                    : 'text-[var(--on-surface)]'
              }`}
            >
              <span className="block">{option.label}</span>
              {option.description && (
                <span className="block text-[11px] text-[var(--on-surface-variant)] leading-tight mt-0.5">
                  {option.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
