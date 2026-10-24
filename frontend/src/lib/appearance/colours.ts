/**
 * The user's colours (Sean, 18 Oct: "should be able to pick your starting
 * colors and different version colors too").
 *
 * Four choices, each from a short list so every combination stays legible:
 * the accent (buttons, the selected version), the starting version's colour
 * (v1), the palette later versions cycle through, and the background tint
 * (Sean, 21 Oct: "remember pink!"). Kept in this browser's
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

/**
 * A background tint: the whole surface ramp, lightest to darkest, so cards,
 * panels and the page keep their tonal separation in any tint.
 */
export interface Background {
  id: string;
  label: string;
  /** The swatch shown in the picker. */
  colour: string;
  /** null: the stylesheet's own surfaces. */
  ramp: {
    lowest: string;
    base: string;
    low: string;
    container: string;
    high: string;
    highest: string;
    dim: string;
  } | null;
}

export interface ColourPreferences {
  accent: string;
  starting: string;
  palette: string;
  background: string;
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

export const BACKGROUNDS: readonly Background[] = [
  { id: 'default', label: 'Grey', colour: '#f2f4f6', ramp: null },
  {
    id: 'pink', label: 'Pink', colour: '#f7d9e3',
    ramp: { lowest: '#fffbfc', base: '#fdf3f6', low: '#fbebf0', container: '#f7e1e8', high: '#f2d6df', highest: '#ecccd7', dim: '#e2bccb' },
  },
  {
    id: 'cream', label: 'Cream', colour: '#f0e8d6',
    ramp: { lowest: '#fffefa', base: '#fbf8f1', low: '#f6f1e6', container: '#f0eadc', high: '#ebe3d2', highest: '#e5dcc9', dim: '#d9cfba' },
  },
  {
    id: 'mint', label: 'Mint', colour: '#d5ece0',
    ramp: { lowest: '#fbfefc', base: '#f2f9f5', low: '#e9f4ee', container: '#e0efe6', high: '#d7e9de', highest: '#cfe3d6', dim: '#c0d6c8' },
  },
  {
    id: 'lavender', label: 'Lavender', colour: '#e1dcf2',
    ramp: { lowest: '#fdfcff', base: '#f6f4fc', low: '#efecf8', container: '#e8e4f4', high: '#e1dcef', highest: '#d9d3ea', dim: '#ccc4e0' },
  },
];

export const DEFAULT_COLOURS: ColourPreferences = { accent: 'slate', starting: 'grey', palette: 'calm', background: 'default' };

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
    background: pick(BACKGROUNDS, value.background, DEFAULT_COLOURS.background),
  };
}

/** Every variable a background sets, so choosing the default clears them all. */
export const BACKGROUND_VARIABLES = [
  '--surface-container-lowest', '--card', '--popover',
  '--surface', '--surface-bright', '--background',
  '--surface-container-low', '--secondary', '--accent', '--input', '--sidebar',
  '--surface-container', '--muted',
  '--surface-container-high', '--border', '--sidebar-accent',
  '--surface-container-highest',
  '--surface-dim',
] as const;

/** The surface tokens a background tint sets; empty for the stylesheet's own. */
export function backgroundVariables(id: string): Record<string, string> {
  const ramp = BACKGROUNDS.find((b) => b.id === id)?.ramp;
  if (!ramp) return {};
  return {
    '--surface-container-lowest': ramp.lowest, '--card': ramp.lowest, '--popover': ramp.lowest,
    '--surface': ramp.base, '--surface-bright': ramp.base, '--background': ramp.base,
    '--surface-container-low': ramp.low, '--secondary': ramp.low, '--accent': ramp.low, '--input': ramp.low, '--sidebar': ramp.low,
    '--surface-container': ramp.container, '--muted': ramp.container,
    '--surface-container-high': ramp.high, '--border': ramp.high, '--sidebar-accent': ramp.high,
    '--surface-container-highest': ramp.highest,
    '--surface-dim': ramp.dim,
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
    ...backgroundVariables(prefs.background),
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

/**
 * The palette in force, as recorded on a version when it is made:
 * "<starting>/<palette>" (Sean, 22 Oct: a new palette should colour new
 * versions, not repaint old ones).
 */
export function colourScheme(prefs: ColourPreferences): string {
  return `${prefs.starting}/${prefs.palette}`;
}

/**
 * A version's colour: from the palette recorded on it, for good; a version
 * with none recorded (or an unknown one) follows the current palette.
 */
export function colourOfVersion(versionNumber: number, scheme?: string | null): string {
  const [startingId, paletteId] = (scheme ?? '').split('/');
  const starting = STARTING.find((s) => s.id === startingId);
  const palette = PALETTES.find((p) => p.id === paletteId);
  if (!starting || !palette) return versionColour(versionNumber);
  return versionNumber <= 1 ? starting.colour : palette.colours[(versionNumber - 2) % palette.colours.length];
}

/** Sets the variables on :root, or clears them to the stylesheet's own for the defaults. */
export function applyColours(prefs: ColourPreferences, root: HTMLElement = document.documentElement): void {
  const isDefault = prefs.accent === DEFAULT_COLOURS.accent && prefs.starting === DEFAULT_COLOURS.starting && prefs.palette === DEFAULT_COLOURS.palette;
  const surfaces: readonly string[] = BACKGROUND_VARIABLES;
  for (const [name, value] of Object.entries(colourVariables(prefs))) {
    if (surfaces.includes(name)) continue;
    if (isDefault) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  // The tint on its own: the default background clears every surface it set.
  const tint = backgroundVariables(prefs.background);
  for (const name of BACKGROUND_VARIABLES) {
    if (tint[name]) root.style.setProperty(name, tint[name]);
    else root.style.removeProperty(name);
  }
  // Pages with a look of their own (the landing page) follow a tint by this.
  if (prefs.background === DEFAULT_COLOURS.background) root.removeAttribute('data-tint');
  else root.setAttribute('data-tint', prefs.background);
}

/**
 * The colours applied before the first paint, as an inline script for the
 * root layout (Sean, 22 Oct: a demo in pink should open pink, not flash grey
 * while the page loads). Every variable each choice sets is worked out here,
 * so the script only looks them up; a stored id it does not know is skipped.
 */
export function prePaintScript(): string {
  const table = (ids: readonly string[], vars: (id: string) => Record<string, string>, fallback: string) =>
    Object.fromEntries(ids.filter((id) => id !== fallback).map((id) => [id, vars(id)]));
  const only = (keep: (name: string) => boolean) => (prefs: ColourPreferences) =>
    Object.fromEntries(Object.entries(colourVariables(prefs)).filter(([n]) => keep(n)));
  const surfaces: readonly string[] = BACKGROUND_VARIABLES;
  const vars = {
    accent: table(ACCENTS.map((a) => a.id), (id) => only((n) => n.startsWith('--pm-primary'))({ ...DEFAULT_COLOURS, accent: id }), DEFAULT_COLOURS.accent),
    starting: table(STARTING.map((s) => s.id), (id) => only((n) => n === '--version-1')({ ...DEFAULT_COLOURS, starting: id }), DEFAULT_COLOURS.starting),
    palette: table(PALETTES.map((p) => p.id), (id) => only((n) => n.startsWith('--version-') && n !== '--version-1')({ ...DEFAULT_COLOURS, palette: id }), DEFAULT_COLOURS.palette),
    background: table(BACKGROUNDS.map((b) => b.id), (id) => only((n) => surfaces.includes(n))({ ...DEFAULT_COLOURS, background: id }), DEFAULT_COLOURS.background),
  };
  return (
    `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(COLOURS_KEY)})||'{}')||{};` +
    `var V=${JSON.stringify(vars)};var d=document.documentElement;` +
    `for(var k in V){var m=V[k][p[k]];if(m){for(var n in m){d.style.setProperty(n,m[n]);}}}` +
    `if(V.background[p.background]){d.setAttribute('data-tint',p.background);}}catch(e){}})();`
  );
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
