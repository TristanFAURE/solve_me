import { expect, test } from '@playwright/test';
import { encryptEnvelope } from '../../src/pages/eventStaffing/collaboration/cryptoEnvelope.js';

const pages = [
  { route: '/generic', heading: /Generic Constraint Page/, hasDisplay: false },
  { route: '/school', heading: 'School Class Creation', hasDisplay: true },
  { route: '/wedding', heading: 'Wedding Table Plan', hasDisplay: true },
  { route: '/event-staffing', heading: 'Event Staffing', hasDisplay: false },
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

async function seedDraft(page, pageId, project) {
  await page.addInitScript(({ id, data }) => {
    localStorage.setItem(`constraint-management:draft:v1:${id}`, JSON.stringify({ version: 1, page: id, data }));
  }, { id: pageId, data: project });
}

function specializedProject(viewHint, assignmentMode = 'container') {
  return {
    modelVersion: 2,
    title: `${viewHint} display fixture`,
    description: '',
    viewHint,
    assignmentMode,
    assignmentMultiplicity: 'single',
    items: [], groups: [], containers: [], positions: [], containments: [], topologies: [],
    constraints: [], preferences: [], fixedAssignments: [], forbiddenAssignments: [],
    assignmentExclusions: [], assignmentCountUpperBounds: [], softAssignmentScores: [], softItemCountTargets: [],
  };
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

      for (const step of appPage.hasDisplay ? [...workflowSteps, 'Display'] : workflowSteps) {
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
    const endTab = appPage.hasDisplay ? page.getByRole('tab', { name: 'Display', exact: true }) : results;

    await setup.focus();
    await page.keyboard.press('ArrowRight');
    await expect(data).toBeFocused();
    await expect(data).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('End');
    await expect(endTab).toBeFocused();
    await expect(endTab).toHaveAttribute('aria-selected', 'true');

    if (appPage.hasDisplay) {
      await page.keyboard.press('ArrowLeft');
      await expect(results).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(endTab).toBeFocused();
    }

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
    await expect(page.locator('a[aria-current="page"]')).toHaveCount(1);
  }

  await page.getByRole('link', { name: 'Generic' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Generic Constraint Page/ })).toBeVisible();
});

test('Generic project changes persist across reload', async ({ page }) => {
  await openRoute(page, '/generic');
  const setupPanel = page.getByRole('tabpanel', { name: 'Setup' });
  const title = setupPanel.locator('input[name="projectTitle"]');

  await title.fill('Persisted browser project');
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('constraint-management:draft:v1:generic');
    return raw && JSON.parse(raw).data?.title === 'Persisted browser project';
  });
  await page.reload();

  await expect(page.getByRole('tabpanel', { name: 'Setup' }).locator('input[name="projectTitle"]')).toHaveValue('Persisted browser project');
  await expect(page.getByText('Recovered local draft.')).toBeVisible();
});

test('Event Staffing completes a deterministic HiGHS WASM solve in a Worker', async ({ page }) => {
  const project = {
    modelVersion: 3,
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
  await page.locator('input[name="staffingMaxSolutions"]').fill('1');
  await page.getByRole('tab', { name: 'Review', exact: true }).click();

  const workerStarted = page.waitForEvent('worker');
  const wasmLoaded = page.waitForResponse((response) => /highs.*\.wasm/i.test(response.url()));
  await page.getByRole('button', { name: 'Transform + solve', exact: true }).click();
  const worker = await workerStarted;
  expect(worker.url()).toContain('solveHighsWorker');
  await wasmLoaded;

  await expect(page.getByRole('tab', { name: 'Results', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  const resultsPanel = page.getByRole('tabpanel', { name: 'Results' });
  await expect(resultsPanel.getByRole('heading', { name: 'Staffing schedule' })).toBeVisible();
  const solveStatus = resultsPanel.locator('dt', { hasText: 'Status' }).locator('xpath=following-sibling::dd');
  await expect(solveStatus).toHaveText(/^(solved|partial)$/);
  const personView = resultsPanel
    .getByRole('heading', { name: 'Person-centric view', exact: true })
    .locator('xpath=..');
  await expect(personView.getByRole('cell', { name: 'Alex', exact: true })).toBeVisible();
}, 60_000);

test('Event Staffing imports the representative JSON configuration into an empty workspace', async ({ page }) => {
  await openRoute(page, '/event-staffing');
  await page.locator('[data-action="import-event-staffing-json"]').setInputFiles('event-staffing-jun-dec-2026.json');

  await expect(page.getByRole('tabpanel', { name: 'Setup' }).getByRole('status')).toHaveText(/JSON configuration imported from event-staffing-jun-dec-2026\.json/);
  await expect(page.locator('input[name="eventStaffingTitle"]')).toHaveValue('Planning de permanence - Juin a Decembre 2026');
  await page.getByRole('tab', { name: 'Data', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Data' }).locator('.event-staffing-people-list-card tbody tr')).toHaveCount(200);
});

test('School solves into a classroom Display with synchronized alternatives', async ({ page }) => {
  const project = specializedProject('school');
  project.items = [
    { id: 'student-alice', kind: 'item', label: 'Alice', metadata: { schoolRole: 'student' } },
    { id: 'teacher-morgan', kind: 'item', label: 'Teacher Morgan', metadata: { schoolRole: 'teacher' } },
    { id: 'teacher-taylor', kind: 'item', label: 'Teacher Taylor', metadata: { schoolRole: 'teacher' } },
  ];
  project.groups = [{ id: 'level-one', kind: 'group', label: 'Level One', metadata: {} }];
  project.containers = [
    { id: 'class-blue', kind: 'container', label: 'Blue Class', metadata: { minCapacity: 0, maxCapacity: 1, acceptedLevelIds: ['level-one'], teacherIds: ['teacher-morgan'] } },
    { id: 'class-gold', kind: 'container', label: 'Gold Class', metadata: { minCapacity: 0, maxCapacity: 1, acceptedLevelIds: ['level-one'], teacherIds: [] } },
  ];
  project.containments = [
    { kind: 'contains', from: { kind: 'group', id: 'level-one' }, to: { kind: 'item', id: 'student-alice' }, metadata: {} },
    { kind: 'contains', from: { kind: 'group', id: 'level-one' }, to: { kind: 'item', id: 'teacher-morgan' }, metadata: {} },
    { kind: 'contains', from: { kind: 'group', id: 'level-one' }, to: { kind: 'item', id: 'teacher-taylor' }, metadata: {} },
  ];
  await seedDraft(page, 'school', project);
  await openRoute(page, '/school');
  await page.locator('select[name="solveMode"]').selectOption('first');
  await page.getByRole('tab', { name: 'Review' }).click();
  await page.getByRole('tabpanel', { name: 'Review' }).locator('[data-action="solve-school"]').click();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Display' }).click();
  await expect(page.locator('.school-classroom')).toHaveCount(2);
  const displayPanel = page.getByRole('tabpanel', { name: 'Display' });
  await expect(displayPanel.getByText('Teacher Morgan', { exact: true })).toBeVisible();
  await expect(displayPanel.getByText('Alice', { exact: true })).toBeVisible();
  await expect(page.getByText(/Desk positions are illustrative/)).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test('Wedding Display distinguishes shapes and table-only positioning', async ({ page }) => {
  const project = specializedProject('wedding');
  project.items = [{ id: 'guest-alex', kind: 'item', label: 'Guest Alex', metadata: {} }];
  project.containers = [
    { id: 'round-table', kind: 'container', label: 'Round Table', metadata: { minCapacity: 0, maxCapacity: 1, shape: 'round' } },
    { id: 'square-table', kind: 'container', label: 'Square Table', metadata: { minCapacity: 0, maxCapacity: 1, shape: 'square' } },
  ];
  await seedDraft(page, 'wedding', project);
  await openRoute(page, '/wedding');
  await page.locator('select[name="solveMode"]').selectOption('first');
  await page.getByRole('tab', { name: 'Review' }).click();
  await page.getByRole('tabpanel', { name: 'Review' }).locator('[data-action="solve-wedding"]').click();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Display' }).click();
  await expect(page.locator('.wedding-table-card.wedding-table-round')).toBeVisible();
  await expect(page.locator('.wedding-table-card.wedding-table-square')).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Display' }).getByText('Guest Alex', { exact: true })).toBeVisible();
  await expect(page.getByText(/positions around the table are illustrative/).first()).toBeVisible();
  await expectNoDocumentOverflow(page);
});

test('Wedding seat-aware Display shows configured seat labels', async ({ page }) => {
  const project = specializedProject('wedding', 'position');
  project.items = [{ id: 'guest-sam', kind: 'item', label: 'Guest Sam', metadata: {} }];
  project.containers = [{ id: 'rectangle-table', kind: 'container', label: 'Rectangle Table', metadata: { minCapacity: 0, maxCapacity: 2, shape: 'rectangle' } }];
  project.positions = [
    { id: 'seat-one', kind: 'position', label: 'Seat One', metadata: { generated: true, seatIndex: 0 } },
    { id: 'seat-two', kind: 'position', label: 'Seat Two', metadata: { generated: true, seatIndex: 1 } },
  ];
  project.containments = project.positions.map((seat) => ({ kind: 'contains', from: { kind: 'container', id: 'rectangle-table' }, to: { kind: 'position', id: seat.id }, metadata: {} }));
  await seedDraft(page, 'wedding', project);
  await openRoute(page, '/wedding');
  await page.locator('select[name="solveMode"]').selectOption('first');
  await page.getByRole('tab', { name: 'Review' }).click();
  await page.getByRole('tabpanel', { name: 'Review' }).locator('[data-action="solve-wedding"]').click();
  await expect(page.getByRole('tab', { name: 'Results' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Display' }).click();
  const displayPanel = page.getByRole('tabpanel', { name: 'Display' });
  await expect(page.locator('.wedding-table-card.wedding-table-rectangle')).toBeVisible();
  await expect(displayPanel.getByText('Seat One', { exact: true })).toBeVisible();
  await expect(displayPanel.getByText('Seat Two', { exact: true })).toBeVisible();
  await expect(displayPanel.getByText('Guest Sam', { exact: true })).toBeVisible();
  await expect(displayPanel.getByText(/Seat positions reflect the selected solution/)).toBeVisible();
});

test('Event Staffing collaborative administrator verifies GitHub through stubs and locks people', async ({ page }) => {
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && /\/repos\/TristanFAURE\/solve_me$/.test(request.url())) {
      await route.fulfill({ json: { default_branch: 'main' } });
      return;
    }
    if (request.method() === 'PUT') {
      await route.fulfill({ json: { content: { sha: 'probe-sha' } } });
      return;
    }
    if (request.method() === 'DELETE') {
      await route.fulfill({ json: { commit: { sha: 'deleted' } } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: 'stubbed not found' } });
  });
  await page.goto('.?collab=true&token=test-token&owner=TristanFAURE&repo=solve_me#/event-staffing');
  await expect(page.getByRole('heading', { name: 'Collaborative session' })).toBeVisible();
  await expect(page.locator('.event-staffing-people-fieldset')).toHaveAttribute('disabled', '');
  expect(page.url()).not.toContain('token=');
});

test('Event Staffing participant mode loads an encrypted manifest through GitHub stubs', async ({ page }) => {
  const password = 'a-long-session-password';
  const manifest = {
    version: 1, sessionId: 'session-id', folder: 'summer--abcdef1234567890', slug: 'summer', title: 'Summer Festival', status: 'open', revision: 1,
    dateKeys: ['2027-06-12'], groups: [{ id: 'welcome', label: 'Welcome' }], createdAt: '2027-01-01T00:00:00.000Z', updatedAt: '2027-01-01T00:00:00.000Z',
  };
  const encrypted = await encryptEnvelope(JSON.stringify(manifest), password);
  const encryptedResponse = await encryptEnvelope(JSON.stringify({
    version: 1, firstName: 'Alex', lastName: 'Smith', displayName: 'Alex Smith', email: 'alex@example.org', pin: '0042',
    sessionId: manifest.sessionId, dayPreferences: {}, dayGroupPreferences: {}, manifestRevision: 1, savedAt: '2027-01-02T00:00:00.000Z',
  }), password);
  const encryptedPlanning = await encryptEnvelope(JSON.stringify({
    version: 1, sessionId: manifest.sessionId, manifestRevision: 1, solutionNumber: 1, savedAt: '2027-01-03T00:00:00.000Z',
    assignments: [{ email: 'alex@example.org', dateKey: '2027-06-12', slotId: 'morning', slotLabel: 'Morning', groupTypeId: 'welcome', groupTypeLabel: 'Welcome' }],
  }), password);
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && /\/repos\/TristanFAURE\/solve_me$/.test(request.url())) {
      await route.fulfill({ json: { default_branch: 'main' } });
      return;
    }
    if (request.method() === 'PUT') {
      await route.fulfill({ json: { content: { sha: 'probe-sha' } } });
      return;
    }
    if (request.method() === 'DELETE') {
      await route.fulfill({ json: { commit: { sha: 'deleted' } } });
      return;
    }
    if (request.method() === 'GET' && request.url().includes('manifest.enc.json')) {
      await route.fulfill({ json: { sha: 'manifest-sha', content: Buffer.from(encrypted).toString('base64') } });
      return;
    }
    if (request.method() === 'GET' && request.url().includes('response.enc.json')) {
      await route.fulfill({ json: { sha: 'response-sha', content: Buffer.from(encryptedResponse).toString('base64') } });
      return;
    }
    if (request.method() === 'GET' && request.url().includes('planning.enc.json')) {
      await route.fulfill({ json: { sha: 'planning-sha', content: Buffer.from(encryptedPlanning).toString('base64') } });
      return;
    }
    await route.fulfill({ status: 404, json: { message: 'stubbed not found' } });
  });
  await page.goto(`.?collab=true&user=true&session=${manifest.folder}&token=test-token&password=${encodeURIComponent(password)}&owner=TristanFAURE&repo=solve_me#/event-staffing`);
  await expect(page.getByRole('heading', { name: 'Summer Festival' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '2027-06-12' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your assignments' })).toHaveCount(0);
  await page.locator('[name="collabEmail"]').fill('alex@example.org');
  await page.locator('[name="collabPin"]').fill('0042');
  await page.getByRole('button', { name: 'Load existing response' }).click();
  await expect(page.getByRole('heading', { name: 'Your assignments' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '2027-06-12' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Morning' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Welcome' })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(page.url()).not.toContain('token=');
  expect(page.url()).not.toContain('password=');
});
