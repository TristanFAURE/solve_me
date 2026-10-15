import { describe, expect, it } from 'vitest';
import { createAppState } from '../../src/app/state.js';
import { ASSIGNMENT_MODES } from '../../src/core/model/assignmentModes.js';
import { CONSTRAINT_KINDS, createConstraint } from '../../src/core/model/constraints.js';
import { createContainer, createGroup, createItem, createPosition } from '../../src/core/model/nodes.js';
import { createEmptyProject, VIEW_HINTS } from '../../src/core/model/project.js';
import {
  createAdjacencyRelation,
  createContainmentRelation,
  createEntityRef,
} from '../../src/core/model/relations.js';
import { normalizeProject } from '../../src/core/normalize/normalizeProject.js';
import { transformEventStaffingProject } from '../../src/core/transform/eventStaffingProject.js';
import { validateProject } from '../../src/core/validate/validateProject.js';
import {
  renderEventStaffingPage,
  renderStaffingScheduleView,
  runEventStaffingWorkflow,
} from '../../src/pages/eventStaffing/index.js';
import { validateEventStaffingProject } from '../../src/pages/eventStaffing/validateEventStaffingProject.js';
import { renderGenericPage } from '../../src/pages/generic/index.js';
import { renderSchoolPage } from '../../src/pages/school/index.js';
import { renderSchoolSolutionDisplay } from '../../src/pages/school/schoolSolutionDisplay.js';
import { validateSchoolProject } from '../../src/pages/school/validateSchoolProject.js';
import { renderWeddingPage } from '../../src/pages/wedding/index.js';
import { renderWeddingSolutionDisplay } from '../../src/pages/wedding/weddingSolutionDisplay.js';
import { validateWeddingProject } from '../../src/pages/wedding/validateWeddingProject.js';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';
import { exportProject, importProject } from '../../src/storage/importExport.js';

const itemRef = (id) => createEntityRef('item', id);
const groupRef = (id) => createEntityRef('group', id);
const containerRef = (id) => createEntityRef('container', id);
const positionRef = (id) => createEntityRef('position', id);

function createRoot(action = null, eventStaffingAction = null) {
  const button = {
    dataset: { action },
    addEventListener(type, listener) {
      if (type === 'click') this.click = listener;
    },
  };

  return {
    button,
    innerHTML: '',
    querySelector(selector) {
      if (action && selector === `[data-action="${action}"]`) return button;
      if (eventStaffingAction && selector === `[data-event-staffing-action="${eventStaffingAction}"]`) return button;
      return null;
    },
    querySelectorAll(selector) {
      return action && selector === '[data-action]' ? [button] : [];
    },
  };
}

function expectProjectRoundTrip(project) {
  const imported = importProject(exportProject(project));
  expect(imported).toEqual(project);
  return imported;
}

function expectSafeSolvedPage(root) {
  expect(root.innerHTML).toMatch(/solved/i);
  expect(root.innerHTML).toContain('&lt;unsafe&gt;');
  expect(root.innerHTML).not.toContain('<unsafe>');
}

function assignmentByItem(solution) {
  return new Map(solution.assignments.map((assignment) => [assignment.itemRef.id, assignment]));
}

function buildGenericProject() {
  return createEmptyProject({
    title: 'Generic <unsafe>',
    items: [
      createItem({ id: 'alpha', label: 'Alpha' }),
      createItem({ id: 'beta', label: 'Beta' }),
      createItem({ id: 'gamma', label: 'Gamma' }),
    ],
    containers: [
      createContainer({ id: 'left', label: 'Left', maxCapacity: 2 }),
      createContainer({ id: 'right', label: 'Right', maxCapacity: 2 }),
    ],
    constraints: [
      createConstraint({
        kind: CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
        leftRef: itemRef('alpha'),
        rightRef: itemRef('beta'),
      }),
      createConstraint({
        kind: CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
        leftRef: itemRef('alpha'),
        rightRef: itemRef('gamma'),
      }),
    ],
  });
}

function buildSchoolProject() {
  return createEmptyProject({
    title: 'School <unsafe>',
    viewHint: VIEW_HINTS.SCHOOL,
    items: [
      createItem({ id: 'alice', label: 'Alice', metadata: { schoolRole: 'student' } }),
      createItem({ id: 'bob', label: 'Bob', metadata: { schoolRole: 'student' } }),
      createItem({ id: 'teacher-a', label: 'Teacher A', metadata: { schoolRole: 'teacher' } }),
      createItem({ id: 'teacher-b', label: 'Teacher B', metadata: { schoolRole: 'teacher' } }),
    ],
    groups: [
      createGroup({ id: 'level-a', label: 'Level A' }),
      createGroup({ id: 'level-b', label: 'Level B' }),
    ],
    containers: [
      createContainer({
        id: 'class-a',
        label: 'Class A',
        maxCapacity: 1,
        metadata: { acceptedLevelIds: ['level-a'], teacherIds: ['teacher-a'] },
      }),
      createContainer({
        id: 'class-b',
        label: 'Class B',
        maxCapacity: 1,
        metadata: { acceptedLevelIds: ['level-b'], teacherIds: ['teacher-b'] },
      }),
    ],
    containments: [
      createContainmentRelation(groupRef('level-a'), itemRef('alice')),
      createContainmentRelation(groupRef('level-b'), itemRef('bob')),
      createContainmentRelation(groupRef('level-a'), itemRef('teacher-a')),
      createContainmentRelation(groupRef('level-b'), itemRef('teacher-b')),
    ],
  });
}

function buildWeddingTableProject() {
  return createEmptyProject({
    title: 'Wedding tables <unsafe>',
    viewHint: VIEW_HINTS.WEDDING,
    items: [
      createItem({ id: 'guest-a', label: 'Guest A' }),
      createItem({ id: 'guest-b', label: 'Guest B' }),
      createItem({ id: 'guest-c', label: 'Guest C' }),
    ],
    groups: [createGroup({ id: 'family', label: 'Family' })],
    containers: [
      createContainer({ id: 'table-a', label: 'Table A', maxCapacity: 2 }),
      createContainer({ id: 'table-b', label: 'Table B', maxCapacity: 1 }),
    ],
    containments: ['guest-a', 'guest-b', 'guest-c'].map((id) => (
      createContainmentRelation(groupRef('family'), itemRef(id))
    )),
    constraints: [createConstraint({
      kind: CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
      leftRef: itemRef('guest-a'),
      rightRef: itemRef('guest-b'),
    })],
  });
}

function buildWeddingPositionProject() {
  return createEmptyProject({
    title: 'Wedding topology <unsafe>',
    viewHint: VIEW_HINTS.WEDDING,
    assignmentMode: ASSIGNMENT_MODES.POSITION,
    items: [
      createItem({ id: 'guest-a', label: 'Guest A' }),
      createItem({ id: 'guest-b', label: 'Guest B' }),
      createItem({ id: 'guest-c', label: 'Guest C' }),
    ],
    groups: [createGroup({ id: 'family', label: 'Family' })],
    containers: [createContainer({ id: 'table-a', label: 'Table A', maxCapacity: 3 })],
    positions: [
      createPosition({ id: 'seat-1', label: 'Seat 1' }),
      createPosition({ id: 'seat-2', label: 'Seat 2' }),
      createPosition({ id: 'seat-3', label: 'Seat 3' }),
    ],
    containments: [
      ...['guest-a', 'guest-b', 'guest-c'].map((id) => createContainmentRelation(groupRef('family'), itemRef(id))),
      ...['seat-1', 'seat-2', 'seat-3'].map((id) => createContainmentRelation(containerRef('table-a'), positionRef(id))),
    ],
    topologies: [
      createAdjacencyRelation(positionRef('seat-1'), positionRef('seat-2')),
      createAdjacencyRelation(positionRef('seat-2'), positionRef('seat-3')),
    ],
    constraints: [
      createConstraint({
        kind: CONSTRAINT_KINDS.MUST_BE_ADJACENT,
        leftRef: itemRef('guest-a'),
        rightRef: itemRef('guest-b'),
      }),
      createConstraint({
        kind: CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT,
        leftRef: itemRef('guest-a'),
        rightRef: itemRef('guest-c'),
      }),
    ],
  });
}

function buildRepeatedStaffingProject() {
  return {
    title: 'Staffing <unsafe>',
    events: [
      { id: 'morning', label: 'Morning', orderIndex: 0 },
      { id: 'evening', label: 'Evening', orderIndex: 1 },
    ],
    groupTypes: [{ id: 'host', label: 'Host' }],
    requirements: [
      { eventId: 'morning', groupTypeId: 'host', min: 1, max: 1 },
      { eventId: 'evening', groupTypeId: 'host', min: 1, max: 1 },
    ],
    people: [{ id: 'alex', name: 'Alex', maxAssignments: 2 }],
    globalLimits: {
      maxAssignmentsPerPerson: 2,
      maxAssignmentsPerGroupType: 2,
      targetAssignmentsPerGroupType: null,
    },
    cooldownRules: [],
    forcedAssignments: [],
    forbiddenAssignments: [],
    preferences: [],
  };
}

describe('cross-domain compatibility gate', () => {
  it('keeps the Generic validate-normalize-solve-render and JSON contract intact', () => {
    const project = expectProjectRoundTrip(buildGenericProject());
    const adapter = new FirstSolverAdapter();
    expect(validateProject(project, adapter.getCapabilities()).valid).toBe(true);

    const state = createAppState({ storage: null });
    state.genericPage.project = project;
    const root = createRoot('solve');
    renderGenericPage(root, state);
    root.button.click();

    expect(state.genericPage.lastValidation.valid).toBe(true);
    expect(state.genericPage.lastNormalizedProject.derived.mustShareComponents).toContainEqual(['alpha', 'beta']);
    expect(state.genericPage.lastSolverResult.status).toBe('solved');
    state.genericPage.lastSolverResult.solutions.forEach((solution) => {
      const assignments = assignmentByItem(solution);
      expect(assignments.get('alpha').containerRef.id).toBe(assignments.get('beta').containerRef.id);
      expect(assignments.get('alpha').containerRef.id).not.toBe(assignments.get('gamma').containerRef.id);
    });
    expectSafeSolvedPage(root);
  });

  it('keeps School domain validation, compatibility transformation, solving, rendering, and JSON intact', () => {
    const project = expectProjectRoundTrip(buildSchoolProject());
    expect(validateSchoolProject(project).valid).toBe(true);

    const state = createAppState({ storage: null });
    state.schoolPage.project = project;
    const root = createRoot('solve-school');
    renderSchoolPage(root, state);
    root.button.click();

    expect(state.schoolPage.lastValidation.valid).toBe(true);
    expect(state.schoolPage.lastNormalizedProject.items.map((item) => item.id).sort()).toEqual(['alice', 'bob']);
    expect(state.schoolPage.lastSolverResult.status).toBe('solved');
    state.schoolPage.lastSolverResult.solutions.forEach((solution) => {
      const assignments = assignmentByItem(solution);
      expect(assignments.get('alice').containerRef.id).toBe('class-a');
      expect(assignments.get('bob').containerRef.id).toBe('class-b');
    });
    const normalizedSnapshot = structuredClone(state.schoolPage.lastNormalizedProject);
    const resultSnapshot = structuredClone(state.schoolPage.lastSolverResult);
    const display = renderSchoolSolutionDisplay({
      project,
      normalizedProject: state.schoolPage.lastNormalizedProject,
      result: state.schoolPage.lastSolverResult,
      activeSolutionIndex: 0,
    });
    expect(display).toContain('Alice');
    expect(display).toContain('Bob');
    expect(display).toContain('Teacher A');
    expect(state.schoolPage.lastNormalizedProject).toEqual(normalizedSnapshot);
    expect(state.schoolPage.lastSolverResult).toEqual(resultSnapshot);
    expectSafeSolvedPage(root);
  });

  it('keeps Wedding table mode validation, solving, rendering, and JSON intact', () => {
    const project = expectProjectRoundTrip(buildWeddingTableProject());
    expect(validateWeddingProject(project).valid).toBe(true);

    const state = createAppState({ storage: null });
    state.weddingPage.project = project;
    const root = createRoot('solve-wedding');
    renderWeddingPage(root, state);
    root.button.click();

    expect(state.weddingPage.lastValidation.valid).toBe(true);
    expect(state.weddingPage.lastNormalizedProject.assignmentMode).toBe(ASSIGNMENT_MODES.CONTAINER);
    expect(state.weddingPage.lastSolverResult.status).toBe('solved');
    state.weddingPage.lastSolverResult.solutions.forEach((solution) => {
      const assignments = assignmentByItem(solution);
      expect(assignments.get('guest-a').containerRef.id).toBe(assignments.get('guest-b').containerRef.id);
      expect(assignments.get('guest-c').containerRef.id).not.toBe(assignments.get('guest-a').containerRef.id);
    });
    const tableDisplay = renderWeddingSolutionDisplay({
      project,
      normalizedProject: state.weddingPage.lastNormalizedProject,
      result: state.weddingPage.lastSolverResult,
      activeSolutionIndex: 0,
    });
    ['Guest A', 'Guest B', 'Guest C'].forEach((guest) => expect(tableDisplay).toContain(guest));
    expect(tableDisplay).toContain('positions around the table are illustrative');
    expectSafeSolvedPage(root);
  });

  it('keeps Wedding position topology validation, normalization, solving, rendering, and JSON intact', () => {
    const project = expectProjectRoundTrip(buildWeddingPositionProject());
    expect(validateWeddingProject(project).valid).toBe(true);

    const state = createAppState({ storage: null });
    state.weddingPage.project = project;
    const root = createRoot('solve-wedding');
    renderWeddingPage(root, state);
    root.button.click();

    const normalized = state.weddingPage.lastNormalizedProject;
    expect(state.weddingPage.lastValidation.valid).toBe(true);
    expect(normalized.derived.adjacencyMap.get('seat-2')).toEqual(new Set(['seat-1', 'seat-3']));
    expect(state.weddingPage.lastSolverResult.status).toBe('solved');
    state.weddingPage.lastSolverResult.solutions.forEach((solution) => {
      const assignments = assignmentByItem(solution);
      const a = assignments.get('guest-a').positionRef.id;
      const b = assignments.get('guest-b').positionRef.id;
      const c = assignments.get('guest-c').positionRef.id;
      expect(new Set([a, b, c]).size).toBe(3);
      expect(normalized.derived.adjacencyMap.get(a).has(b)).toBe(true);
      expect(normalized.derived.adjacencyMap.get(a).has(c)).toBe(false);
    });
    const normalizedSnapshot = structuredClone(normalized);
    const resultSnapshot = structuredClone(state.weddingPage.lastSolverResult);
    const seatDisplay = renderWeddingSolutionDisplay({
      project,
      normalizedProject: normalized,
      result: state.weddingPage.lastSolverResult,
      activeSolutionIndex: 0,
    });
    ['Seat 1', 'Seat 2', 'Seat 3', 'Guest A', 'Guest B', 'Guest C'].forEach((label) => expect(seatDisplay).toContain(label));
    expect(normalized).toEqual(normalizedSnapshot);
    expect(state.weddingPage.lastSolverResult).toEqual(resultSnapshot);
    expectSafeSolvedPage(root);
  });

  it('keeps repeated Event Staffing assignments valid through transform, solve, render, and JSON', () => {
    const domainProject = buildRepeatedStaffingProject();
    expect(validateEventStaffingProject(domainProject).valid).toBe(true);

    const adapter = new FirstSolverAdapter();
    const workflow = runEventStaffingWorkflow(domainProject, adapter.getCapabilities());
    expect(workflow.domainValidation.valid).toBe(true);
    expect(workflow.genericValidation.valid).toBe(true);
    expect(workflow.transformedProject.assignmentMultiplicity).toBe('multiple');
    expectProjectRoundTrip(workflow.transformedProject);

    const importedNormalized = normalizeProject(expectProjectRoundTrip(transformEventStaffingProject(domainProject)));
    expect(validateProject(importedNormalized, adapter.getCapabilities()).valid).toBe(true);
    const result = adapter.solve(importedNormalized);
    expect(result.status).toBe('solved');
    result.solutions.forEach((solution) => {
      expect(solution.assignments).toHaveLength(2);
      expect(solution.assignments.every((assignment) => assignment.itemRef.id === 'alex')).toBe(true);
      expect(new Set(solution.assignments.map((assignment) => assignment.containerRef.id)).size).toBe(2);
    });

    const schedule = renderStaffingScheduleView(domainProject, result);
    expect(schedule).toContain('Morning (Host)');
    expect(schedule).toContain('Evening (Host)');
    expect(schedule).toContain('Alex');

    const state = createAppState({ storage: null });
    Object.assign(state.eventStaffingPage, {
      domainProject,
      lastValidation: workflow.domainValidation,
      lastGenericValidation: workflow.genericValidation,
      lastTransformedProject: workflow.transformedProject,
      lastNormalizedProject: importedNormalized,
      lastSolverResult: result,
    });
    const root = createRoot();
    renderEventStaffingPage(root, state);
    expectSafeSolvedPage(root);
  });
});
