/**
 * Small, pure helpers over the HTML tree react-markdown builds (M1, 8 Oct).
 * Kept dependency-free: two functions do not justify a unist package.
 */

export interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** The text a node holds, exactly — what Copy and Download put out. */
export function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

function classes(node: HastNode): string[] {
  const c = node.properties?.className;
  return Array.isArray(c) ? (c as string[]) : typeof c === 'string' ? c.split(/\s+/) : [];
}

function find(node: HastNode, test: (n: HastNode) => boolean): HastNode | null {
  if (test(node)) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, test);
    if (hit) return hit;
  }
  return null;
}

/**
 * After KaTeX has drawn a display equation, keep its LaTeX beside it so it
 * can be copied as written (Sean, 7 Oct: "physicists should also be able to
 * copy and edit the underlying LaTeX"). KaTeX leaves the source in its
 * MathML annotation; this lifts it onto a wrapper the renderer reads.
 */
export function rehypeTexSource() {
  const walk = (node: HastNode) => {
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.type === 'element' && classes(child).includes('katex-display')) {
        const note = find(child, (n) => n.tagName === 'annotation');
        children[i] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['pm-math-display'], dataTex: hastText(note ?? undefined).trim() },
          children: [child],
        };
      } else {
        walk(child);
      }
    }
  };
  return (tree: HastNode) => walk(tree);
}

const EXTENSIONS: Record<string, string> = {
  python: 'py', py: 'py', typescript: 'ts', ts: 'ts', tsx: 'tsx', javascript: 'js', js: 'js', jsx: 'jsx',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', json: 'json', r: 'R', julia: 'jl', matlab: 'm', octave: 'm',
  latex: 'tex', tex: 'tex', c: 'c', cpp: 'cpp', 'c++': 'cpp', fortran: 'f90', rust: 'rs', go: 'go', java: 'java',
  sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'toml', html: 'html', css: 'css', mathematica: 'wl',
};

/** The language a fenced block names, from its `language-…` class. */
export function codeLanguage(code: HastNode | undefined): string {
  const lang = code ? classes(code).find((c) => c.startsWith('language-')) : undefined;
  return lang ? lang.slice('language-'.length) : '';
}

/** A download name for a block of code in that language. */
export function codeFilename(language: string, index = 1): string {
  return `code-${index}.${EXTENSIONS[language.toLowerCase()] ?? 'txt'}`;
}
