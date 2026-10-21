/**
 * The user's colours (Sean, 18 Oct: "should be able to pick your starting
 * colors and different version colors too").
 *
 * Three choices, each from a short list so every combination stays legible:
 * the accent (buttons, the selected version), the starting version's colour
 * (v1), and the palette later versions cycle through. Kept in this browser's
 * localStorage — a convenience, not project data — and applied as CSS-variable
 * overrides on :root, so every component that reads the tokens follows.
 * Pure, apart from `loadColours`, `saveColours` and `applyColours`.
 */

export interface Swatch {
  id: string;
  label: string;
  colour: string;
}

export interface Accent extends Swatch {
  /** The lighter partner, `--pm-primary-container`. */
  container: string;
}

export interface VersionPalette {
  id: string;
  label: string;
  colours: readonly string[];
}

export interface ColourPreferences {
  accent: string;
  starting: string;
  palette: string;
}

export const ACCENTS: readonly Accent[] = [
  { id: 'slate', label: 'Slate blue', colour: '#004ac6', container: '#2563eb' },
  { id: 'teal', label: 'Teal', colour: '#00696b', container: '#0f8a8c' },
  { id: 'plum', label: 'Plum', colour: '#6a3d9a', container: '#8456b8' },
  { id: 'forest', label: 'Forest', colour: '#2d6a35', container: '#3f8a48' },
  { id: 'rust', label: 'Rust', colour: '#9c3f0f', container: '#bd5520' },
  { id: 'ink', label: 'Ink', colour: '#24304a', container: '#3a4a6b' },
];

export const STARTING: readonly Swatch[] = [
  { id: 'grey', label: 'Grey', colour: '#737686' },
  { id: 'blue', label: 'Blue', colour: '#2563eb' },
  { id: 'green', label: 'Green', colour: '#0f6b45' },
  { id: 'amber', label: 'Amber', colour: '#b26a00' },
  { id: 'rose', label: 'Rose', colour: '#b3264f' },
];

export const PALETTES: readonly VersionPalette[] = [
  { id: 'calm', label: 'Calm', colours: ['#2563eb', '#0f8a8c', '#6a3d9a', '#b26a00', '#3f8a48'] },
  { id: 'bright', label: 'Bright', colours: ['#e0452b', '#f2a900', '#16a34a', '#0284c7', '#a21caf'] },
  { id: 'mono', label: 'One colour', colours: ['#1e3a8a', '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd'] },
];

export const DEFAULT_COLOURS: ColourPreferences = { accent: 'slate', starting: 'grey', palette: 'calm' };

export const COLOURS_KEY = 'pm.colours';

const pick = <T extends { id: string }>(list: readonly T[], id: unknown, fallback: string): string =>
  typeof id === 'string' && list.some((x) => x.id === id) ? id : fallback;

/** Whatever was stored, as valid preferences: unknown or missing ids fall back to the defaults. */
export function parseColours(raw: string | null | undefined): ColourPreferences {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') value = parsed as Record<string, unknown>;
  } catch {
    // A damaged entry is the defaults, not an error.
  }
  return {
    accent: pick(ACCENTS, value.accent, DEFAULT_COLOURS.accent),
    starting: pick(STARTING, value.starting, DEFAULT_COLOURS.starting),
    palette: pick(PALETTES, value.palette, DEFAULT_COLOURS.palette),
  };
}

/** The CSS variables the preferences set. */
export function colourVariables(prefs: ColourPreferences): Record<string, string> {
  const accent = ACCENTS.find((a) => a.id === prefs.accent) ?? ACCENTS[0];
  const starting = STARTING.find((s) => s.id === prefs.starting) ?? STARTING[0];
  const palette = PALETTES.find((p) => p.id === prefs.palette) ?? PALETTES[0];
  return {
    '--pm-primary': accent.colour,
    '--pm-primary-container': accent.container,
    '--version-1': starting.colour,
    ...Object.fromEntries(palette.colours.map((c, i) => [`--version-${i + 2}`, c])),
  };
}

/**
 * A project's own accent (14 Oct call: "the whole thing could change color
 * based on what project you're working on"), as the variables to set on the
 * project's page. Empty for none or an unknown id: the user's own accent shows.
 */
export function accentVariables(id: string | null | undefined): Record<string, string> {
  const accent = ACCENTS.find((a) => a.id === id);
  return accent ? { '--pm-primary': accent.colour, '--pm-primary-container': accent.container } : {};
}

/** The colour token for a version: v1 is the starting colour, later ones cycle the palette. */
export function versionColour(versionNumber: number): string {
  if (versionNumber <= 1) return 'var(--version-1)';
  return `var(--version-${((versionNumber - 2) % 5) + 2})`;
}

/** Sets the variables on :root, or clears them to the stylesheet's own for the defaults. */
export function applyColours(prefs: ColourPreferences, root: HTMLElement = document.documentElement): void {
  const isDefault = prefs.accent === DEFAULT_COLOURS.accent && prefs.starting === DEFAULT_COLOURS.starting && prefs.palette === DEFAULT_COLOURS.palette;
  for (const [name, value] of Object.entries(colourVariables(prefs))) {
    if (isDefault) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
}

export function loadColours(): ColourPreferences {
  try {
    return parseColours(window.localStorage.getItem(COLOURS_KEY));
  } catch {
    return DEFAULT_COLOURS;
  }
}

export function saveColours(prefs: ColourPreferences): void {
  try {
    window.localStorage.setItem(COLOURS_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
}
