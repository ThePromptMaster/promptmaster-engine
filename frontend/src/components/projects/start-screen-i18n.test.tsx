/**
 * The start screen in the interface language (client, 21 Oct: "Can we do pick
 * your language?", part 2). What is sent to the model stays as the user wrote
 * it; only PromptMaster's own words change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { FrontDoor } from './front-door';
import { SetupCard, type SetupDraft } from './setup-card';
import { WorkflowPicker } from './workflow-picker';
import { DraftStatus } from './draft-status';
import { resetLocaleForTests, setLocale } from '@/lib/i18n/store';
import { describeDraft } from '@/lib/projects/setup-draft';
import { sourceAccessNote } from '@/lib/projects/links';
import { startLanguage } from '@/lib/workflow/languages';
import type { WorkflowTemplate } from '@/lib/workflow/types';

const frontDoor = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { frontDoor: (...a: unknown[]) => frontDoor(...a) } }));

const TEMPLATES = [
  { id: 't-so', key: 'single_output', name: 'Single output', description: 'x', version: 5, outline_stage: 'none', stages: [{ short_label: 'Brief' }] },
  { id: 't-mine', key: 'custom_abc', name: 'My cookbook flow', description: 'mine', version: 1, outline_stage: 'none', stages: [] },
] as unknown as (WorkflowTemplate & { id: string })[];

const DRAFT: SetupDraft = { title: 'T', objective: 'Un libro de recetas', audience: 'General', constraints: '', output_format: '', context: '', mode: 'clarity' };

afterEach(() => {
  act(() => setLocale('en'));
  window.localStorage.clear();
  resetLocaleForTests();
});

describe('the start screen in Spanish', () => {
  it('speaks Spanish in the conversation and the outline', () => {
    act(() => setLocale('es'));
    frontDoor.mockReturnValue(new Promise(() => undefined));
    render(<FrontDoor opening="" onReady={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Esquema: aún no es un proyecto')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy();
    expect(screen.getByLabelText('Tu mensaje')).toBeTruthy();
  });

  it('names system workflows in Spanish and leaves a user\'s own as written', () => {
    act(() => setLocale('es'));
    render(<WorkflowPicker templates={TEMPLATES} selectedId="t-so" onSelect={vi.fn()} />);
    expect(screen.getByText('Entrega única')).toBeTruthy();
    expect(screen.getByText('My cookbook flow')).toBeTruthy();
    expect(screen.getByText('1 etapa')).toBeTruthy();
    expect(screen.getByText('0 etapas')).toBeTruthy();
  });

  it('labels the simple setup in Spanish', () => {
    act(() => setLocale('es'));
    render(
      <SetupCard simple start={<button>x</button>} templates={TEMPLATES} templateId="t-so" onSelectTemplate={vi.fn()}
        workflowReason="" recommendedKey="single_output" draft={DRAFT} rationale={null} onChange={vi.fn()} />
    );
    expect(screen.getByText('Lo que obtendrás')).toBeTruthy();
    expect(screen.getByText('Más opciones')).toBeTruthy();
  });

  it('says the draft state in French', () => {
    act(() => setLocale('fr'));
    render(<DraftStatus state="saving" />);
    expect(screen.getByText('Enregistrement de votre configuration…')).toBeTruthy();
  });
});

describe('words made outside a component follow the language', () => {
  it('describes an unfinished setup and the links note', () => {
    act(() => setLocale('es'));
    const said = describeDraft({ step: 'ask', objective: 'Recetas', draft: null } as never, 'not a date');
    expect(said).toBe('Tienes una configuración sin terminar: lo que estabas pidiendo — "Recetas".');
    expect(sourceAccessNote('mira https://example.com')).toMatch(/^PromptMaster no puede abrir enlaces/);
  });
});

describe('what a new project writes in', () => {
  it('follows the interface language, else the browser', () => {
    expect(startLanguage('es')).toBe('es');
    expect(startLanguage('pt')).toBe('pt');
    expect(startLanguage('en')).toBe('en'); // jsdom's navigator is en-US
  });
});
