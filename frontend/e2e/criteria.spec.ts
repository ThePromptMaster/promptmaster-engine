import { expect, test } from '@playwright/test';

import {
  createProject,
  criterion,
  e2eUser,
  pressTransition,
  serviceInsert,
  servicePatch,
  serviceSelect,
  skipStage,
  transitionBar,
  stageArtifact,
} from './helpers';

/**
 * Exit criteria Sean could not satisfy (Sep 10 call and emails).
 */

test('Book: comparables can be ticked (PM-02) and the outline counter updates live (PM-01)', async ({ page }) => {
  await createProject(page, {
    workflow: 'Book',
    name: 'E2E criteria',
    objective: 'A book about giraffes for curious ten-year-olds',
  });

  // Objective -> Audience -> Positioning
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();
  await expect(stageArtifact(page).getByText(/Mock /).first()).toBeVisible();
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();

  // PM-02: "At least two comparables named" was a count rule on a prose stage,
  // so nothing the user did could satisfy it. It is now a box they tick.
  const comparables = criterion(page, 'At least two comparables named');
  await comparables.getByRole('checkbox').check();
  await expect(comparables.getByRole('checkbox')).toBeChecked();
  await criterion(page, 'One-sentence differentiator').getByRole('checkbox').check();
  await page.screenshot({ path: test.info().outputPath('01-comparables-ticked.png') });
  await pressTransition(page);

  // Research is optional.
  await skipStage(page, 'Not needed for this test');

  // PM-01: "Outline has sections — 0 of 2 NEEDED" never moved as sections were added.
  const sections = criterion(page, 'Outline has sections');
  await expect(sections).toContainText('0 of 2');

  await page.getByRole('button', { name: 'Add a section' }).click();
  await page.getByLabel('Title of section 1').fill('Where giraffes live');
  await expect(sections).toContainText('1 of 2');

  // An unnamed row is a placeholder, not a section.
  await page.getByRole('button', { name: /Insert a section after/ }).first().click();
  await expect(sections).toContainText('1 of 2');
  await page.getByLabel('Title of section 2').fill('Why the long neck');

  await expect(sections).not.toContainText('of 2');
  await expect(sections).not.toContainText('required');
  await page.screenshot({ path: test.info().outputPath('02-outline-counter-met.png') });
});

test('Research v1: a project stranded at Experiment can resolve its runs (Sean\'s screenshot)', async ({ page }) => {
  const projectId = await createProject(page, {
    workflow: 'Research',
    name: 'E2E research v1',
    objective: 'Does spaced repetition improve retention in adult learners?',
  });

  // Pin it to Research v1 — the version Sean's project was on — and bring the
  // cursor to Experiment, as a project that had walked there would be.
  const [v1] = await serviceSelect('workflow_templates', 'key=eq.research&version=eq.1&select=id');
  await servicePatch('projects', `id=eq.${projectId}`, { workflow_template_id: v1.id, stage: 'experiment' });
  const chain = ['question', 'literature', 'hypothesis', 'method', 'experiment'];
  for (let i = 0; i < chain.length - 1; i++) {
    await serviceInsert('workflow_events', {
      project_id: projectId,
      user_id: e2eUser().id,
      type: 'stage_completed',
      stage_id: chain[i],
      to_stage_id: chain[i + 1],
    });
  }
  await page.reload();

  await expect(page.getByRole('heading', { name: /Experiment/ })).toBeVisible();
  const gate = criterion(page, 'Every planned run has a result or a reason');
  await expect(gate).toContainText('still unresolved');

  // v1 drew this stage with the list renderer: no status control at all.
  const statuses = page.getByRole('table').getByRole('combobox');
  await expect(statuses.first()).toBeVisible();
  const count = await statuses.count();
  for (let i = 0; i < count; i++) {
    await statuses.nth(i).click();
    await page.getByRole('option', { name: 'Completed' }).click();
  }
  await page.getByRole('button', { name: 'Save as new version' }).click();

  await expect(gate).not.toContainText('still unresolved');
  await expect(transitionBar(page).getByText('Ready to move on')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('03-research-v1-resolved.png') });
});
