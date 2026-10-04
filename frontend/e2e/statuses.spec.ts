import { expect, test } from '@playwright/test';

import {
  createProject,
  criterion,
  pressTransition,
  servicePatch,
  serviceSelect,
  skipStage,
  transitionBar,
} from './helpers';

/**
 * A5 — PM-13 stage statuses and PM-14 objective-based completion, plus the
 * way out for projects pinned to an old workflow version.
 */

async function eventsOf(projectId: string) {
  return serviceSelect('workflow_events', `project_id=eq.${projectId}&select=type,stage_id,reason,payload&order=seq`);
}

test('moving on does not complete a stage; finished stages carry their evidence; blocked has a reason', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Book', name: 'E2E statuses', objective: 'A book about giraffes' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // Objective: requirements met -> complete, with its version as evidence.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Audience/ })).toBeVisible();

  // Audience: block it, then lift the block.
  await transitionBar(page).getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: 'Mark as stuck…' }).click();
  await page.getByRole('radio', { name: /Waiting on information/ }).click();
  await page.getByLabel('What exactly is missing').fill('Reader survey results');
  await page.getByRole('button', { name: 'Mark as stuck' }).click();
  await expect(page.getByText('Stuck — waiting on information')).toBeVisible();
  // No "Move on — nothing outstanding" beside a stuck stage (2 Oct, screenshot 2).
  await expect(page.getByText(/^Move on to Positioning/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('01-blocked-with-reason.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue this stage' }).click();
  await expect(page.getByText('Stuck — waiting on information')).toHaveCount(0);
  await expect(page.getByText(/^Move on to Positioning/)).toBeVisible();
  await pressTransition(page);

  // Positioning (v3): the comparables hint explains the requirement (PM-02).
  await expect(page.getByRole('heading', { name: /Positioning/ })).toBeVisible();
  await expect(criterion(page, 'I have named at least two comparable books')).toContainText('existing books your reader would shelve beside yours');
  // Its blocking "differentiator" is unticked: moving on is "anyway", and leaves it OPEN.
  await pressTransition(page);
  await expect(page.getByRole('heading', { name: /Research/ })).toBeVisible();
  const positioningRow = page.getByRole('navigation', { name: 'Workflow stages' }).getByRole('button', { name: /Positioning/ });
  await expect(positioningRow).toContainText('open');
  await page.screenshot({ path: test.info().outputPath('02-left-open-on-rail.png') });

  const log = await eventsOf(projectId);
  const byStage = (id: string) => log.filter((e: { stage_id: string }) => e.stage_id === id).map((e: { type: string }) => e.type);
  expect(byStage('objective')).toEqual(['project_created', 'stage_marked_complete']);
  expect(log.find((e: { stage_id: string; type: string }) => e.stage_id === 'objective' && e.type === 'stage_marked_complete').payload)
    .toHaveProperty('evidence_version_id');
  expect(byStage('audience')).toEqual(['stage_blocked', 'stage_unblocked', 'stage_marked_complete']);
  expect(byStage('positioning')).toEqual(['stage_advanced']);
});

test('finishing is about the deliverable, and a finished project can be reopened', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Single output', name: 'E2E complete', objective: 'Explain the plan to the board' });
  await pressTransition(page); // input
  await expect(page.getByRole('heading', { name: 'Review the prompt' })).toBeVisible();
  await pressTransition(page); // review
  await expect(page.getByRole('heading', { name: 'Output and evaluation' })).toBeVisible();
  await expect(page.getByText('Mock output').first()).toBeVisible();
  await pressTransition(page); // output
  await skipStage(page, 'Scores are already good');
  await expect(page.getByRole('heading', { name: 'Final review' })).toBeVisible();

  // Finish shows the summary first.
  // Finish is the primary action, or under More when something else leads.
  const bar = transitionBar(page);
  const finish = bar.getByRole('button', { name: /^Finish/ });
  if (await finish.count()) await finish.click();
  else {
    await bar.getByRole('button', { name: /^More/ }).click();
    await page.getByRole('menuitem', { name: /^Finish/ }).click();
  }
  const summary = page.getByRole('region', { name: 'Finish the project' });
  await expect(summary).toContainText('The deliverable (Output) is done.');
  await expect(summary).toContainText('skipped on purpose');
  await summary.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('03-completion-summary.png') });
  await summary.getByRole('button', { name: 'Finish project' }).click();
  await expect(page.getByText('This project is finished')).toBeVisible();

  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('This project is finished')).toHaveCount(0);
  const types = (await eventsOf(projectId)).map((e: { type: string }) => e.type);
  expect(types.slice(-2)).toEqual(['project_finalized', 'project_reopened']);
});

test('a project on an old workflow version can be upgraded, keeping its work', async ({ page }) => {
  const projectId = await createProject(page, { workflow: 'Research', name: 'E2E upgrade', objective: 'Does spaced repetition help adults remember?' });
  await expect(page.getByText('Mock output').first()).toBeVisible();

  // Pin it to Research v1, as Sean's project was.
  const [v1] = await serviceSelect('workflow_templates', 'key=eq.research&version=eq.1&select=id');
  const [latest] = await serviceSelect('workflow_templates', 'key=eq.research&order=version.desc&limit=1&select=id,version');
  await servicePatch('projects', `id=eq.${projectId}`, { workflow_template_id: v1.id });
  await page.reload();

  const banner = page.getByRole('region', { name: 'Workflow update' });
  await expect(banner).toContainText(`You are on v1; v${latest.version} is current.`);
  // The upgrade itself is on the banner's one line, not behind the disclosure.
  await expect(banner.getByRole('button', { name: `Upgrade to v${latest.version}` })).toBeVisible();
  await expect(banner).toContainText('keeps the older checks and wording until you upgrade');
  await page.screenshot({ path: test.info().outputPath('upgrade-banner.png') });
  await banner.getByRole('button', { name: 'What changes?' }).click();
  await expect(banner).toContainText('Experiment');
  await page.screenshot({ path: test.info().outputPath('04-upgrade-offer.png') });
  await banner.getByRole('button', { name: `Upgrade to v${latest.version}` }).click();
  await expect(page.getByRole('region', { name: 'Workflow update' })).toHaveCount(0);

  const [project] = await serviceSelect('projects', `id=eq.${projectId}&select=workflow_template_id`);
  await expect.poll(async () => (await serviceSelect('projects', `id=eq.${projectId}&select=workflow_template_id`))[0].workflow_template_id)
    .toBe(latest.id);
  expect(project).toBeTruthy();
  const types = (await eventsOf(projectId)).map((e: { type: string }) => e.type);
  expect(types).toContain('template_upgraded');
  // The work written before the upgrade is still there.
  await expect(page.getByText('Mock output').first()).toBeVisible();
});
