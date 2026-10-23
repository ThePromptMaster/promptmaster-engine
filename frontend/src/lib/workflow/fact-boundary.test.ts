import { describe, expect, it } from 'vitest';
import { saysNoInvention } from './fact-boundary';

// The same sentences as backend/tests/test_fact_boundary.py: the two readings must agree.
describe('"don\'t invent details" in the offered languages (client, 21 Oct)', () => {
  it.each([
    "Don't invent memories or stories.",
    'No inventes detalles personales.',
    "N'invente pas de souvenirs ni d'anecdotes.",
    'Não invente histórias sobre os noivos.',
    'Keine Details erfinden.',
    'Non inventare dettagli sugli ospiti.',
    'Verzin geen details over de gasten.',
  ])('reads %s', (text) => {
    expect(saysNoInvention(text)).toBe(true);
  });

  it.each([
    'Inventa una historia sobre un dragón.',
    'No uses jerga. Inventa detalles divertidos.',
    'Do not invent citations.',
  ])('does not read %s as the rule', (text) => {
    expect(saysNoInvention(text)).toBe(false);
  });
});
