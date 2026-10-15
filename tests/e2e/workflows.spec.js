import { expect, test } from '@playwright/test';

const pages = [
  { route: '/generic', heading: /Generic Constraint Page/ },
  { route: '/school', heading: 'School Class Creation' },
  { route: '/wedding', heading: 'Wedding Table Plan' },
  { route: '/event-staffing', heading: 'Event Staffing' },
];

const viewports = [
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

const workflowSteps = ['Setup', 'Data', 'Rules', 'Review', 'Results'];

async function openRoute(page, route) {
  await page.goto(`.#${route}`);
}

async function expectNoDocumentOverflow(page) {
  const dimensions = await page.locator('html').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

for (const appPage of pages) {
  for (const viewport of viewports) {
    test(`${appPage.route} loads every workflow at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openRoute(page, appPage.route);

      await expect(page.getByRole('heading', { level: 1, name: appPage.heading })).toBeVisible();
      await expect(page.getByRole('tablist', { name: 'Workflow steps' })).toBeVisible();

      for (const step of workflowSteps) {
        const tab = page.getByRole('tab', { name: step, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator(`#${await tab.getAttribute('aria-controls')}`)).toBeVisible();
        await expectNoDocumentOverflow(page);
      }
    });
  }

  test(`${appPage.route} workflow tabs support keyboard navigation`, async ({ page }) => {
    await openRoute(page, appPage.route);

    const setup = page.getByRole('tab', { name: 'Setup', exact: true });
    const data = page.getByRole('tab', { name: 'Data', exact: true });
    const results = page.getByRole('tab', { name: 'Results', exact: true });

    await setup.focus();
    await page.keyboard.press('ArrowRight');
    await expect(data).toBeFocused();
    await expect(data).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('End');
    await expect(results).toBeFocused();
    await expect(results).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Home');
    await expect(setup).toBeFocused();
    await expect(setup).toHaveAttribute('aria-selected', 'true');
  });
}

test('primary navigation moves between all pages', async ({ page }) => {
  await openRoute(page, '/generic');

  for (const appPage of pages.slice(1)) {
    await page.getByRole('link', { name: appPage.heading === 'Event Staffing' ? 'Event staffing' : appPage.heading.toString().split(' ')[0] }).click();
    await expect(page.getByRole('heading', { level: 1, name: appPage.heading })).toBeVisible();
    await expect(page.getByRole('link', { current: 'page' })).toHaveCount(1);
  }

  await page.getByRole('link', { name: 'Generic' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Generic Constraint Page/ })).toBeVisible();
});

test('Generic project changes persist across reload', async ({ page }) => {
  await openRoute(page, '/generic');
  const title = page.getByRole('textbox', { name: 'Title', exact: true });

  await title.fill('Persisted browser project');
  await expect(page.getByRole('status')).toContainText('Draft saved locally.');
  await page.reload();

  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Persisted browser project');
  await expect(page.getByText('Recovered local draft.')).toBeVisible();
});

test('Event Staffing completes a deterministic solve in a Worker', async ({ page }) => {
  const project = {
    modelVersion: 2,
    title: 'Worker fixture',
    events: [{
      id: 'morning',
      label: 'Morning shift',
      dateKey: '2026-10-15',
      date: '2026-10-15',
      slotLabel: 'Morning shift',
      orderIndex: 0,
    }],
    groupTypes: [{ id: 'greeter', label: 'Greeter' }],
    requirements: [{ eventId: 'morning', groupTypeId: 'greeter', min: 1, max: 1 }],
    people: [{
      id: 'alex',
      name: 'Alex',
      allowedGroupTypeIds: ['greeter'],
      forbiddenGroupTypeIds: [],
      maxAssignments: 1,
      targetAssignments: 1,
      maxAssignmentsPerGroupType: {},
      targetAssignmentsPerGroupType: {},
    }],
    globalLimits: {
      maxAssignmentsPerPerson: null,
      maxAssignmentsPerGroupType: null,
      targetAssignmentsPerGroupType: null,
    },
    cooldownRules: [],
    forcedAssignments: [],
    forbiddenAssignments: [],
    preferences: [],
  };

  await page.addInitScript((fixture) => {
    localStorage.setItem('constraint-management:draft:v1:event-staffing', JSON.stringify({
      version: 1,
      page: 'event-staffing',
      data: fixture,
    }));
  }, project);
  await openRoute(page, '/event-staffing');
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  const workerStarted = page.waitForEvent('worker');
  await page.getByRole('button', { name: 'Transform + solve', exact: true }).click();
  await workerStarted;

  await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Staffing schedule' })).toBeVisible();
  await expect(page.getByText('solved', { exact: true })).toBeVisible();
  await expect(page.getByText('Alex', { exact: true })).toBeVisible();
});
