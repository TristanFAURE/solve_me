import { describe, expect, it } from 'vitest';
import { normalizeProject } from '../../src/core/normalize/normalizeProject.js';
import { transformEventStaffingProject } from '../../src/core/transform/eventStaffingProject.js';
import { validateProject } from '../../src/core/validate/validateProject.js';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';
import { validateEventStaffingProject } from '../../src/pages/eventStaffing/validateEventStaffingProject.js';
import { createMockDomainProject } from '../../src/pages/eventStaffing/mockDomainProject.js';
import { syncSelectedEventDrafts } from '../../src/pages/eventStaffing/eventBrowser.js';
import {
  addPerson,
  addRequirementToSelectedEvent,
  beginEditPerson,
  buildDeleteEventsConfirmationMessage,
  buildRemoveAllRequirementsConfirmationMessage,
  bulkAssignGroupToSelectedEvents,
  bulkCopyRequirementsFromFocusedEvent,
  bulkRemoveAllRequirementsFromSelectedEvents,
  bulkRemoveGroupFromSelectedEvents,
  cancelEditPerson,
  deleteEvents,
  generateEventsFromDateRange,
  insertEventNearSelection,
  removeRequirementFromSelectedEvent,
  renderStaffingScheduleView,
  runEventStaffingWorkflow,
  saveGlobalLimits,
} from '../../src/pages/eventStaffing/index.js';
import { renderSupportSections } from '../../src/pages/eventStaffing/summarySections.js';

function buildValidDomainProject() {
  return {
    title: 'Planner',
    events: [
      { id: 'E1', label: 'Event 1', orderIndex: 1 },
      { id: 'E2', label: 'Event 2', orderIndex: 2 },
    ],
    groupTypes: [
      { id: 'G1', label: 'Group 1' },
      { id: 'G2', label: 'Group 2' },
    ],
    requirements: [
      { eventId: 'E1', groupTypeId: 'G1', min: 1, max: 1 },
      { eventId: 'E2', groupTypeId: 'G1', min: 0, max: 1 },
      { eventId: 'E2', groupTypeId: 'G2', min: 0, max: 1 },
    ],
    people: [
      { id: 'P1', name: 'Alice', maxAssignments: 2, targetAssignments: 1 },
      { id: 'P2', name: 'Bob', maxAssignments: 1 },
    ],
    cooldownRules: [
      {
        triggerGroupTypes: ['G1'],
        blockedGroupTypes: ['G2'],
        blockedNextEventCount: 1,
      },
    ],
    forcedAssignments: [
      { personId: 'P1', eventId: 'E1', groupTypeId: 'G1' },
    ],
    forbiddenAssignments: [
      { personId: 'P2', eventId: 'E2', groupTypeId: 'G2' },
    ],
    preferences: [
      { personId: 'P1', eventPreferences: { E1: 'Y', E2: 'N' } },
    ],
    globalLimits: {
      maxAssignmentsPerPerson: 2,
      maxAssignmentsPerGroupType: 2,
      targetAssignmentsPerGroupType: 1,
    },
  };
}

function buildEditorState() {
  return {
    selectedEventId: 'E1',
    selectedEventIds: ['E1', 'E2'],
    draftInsertedEventLabel: 'Inserted event',
    draftInsertedEventDate: '2026-07-01',
    draftInsertedEventPosition: 'after',
    draftRangeStartDate: '2026-07-10',
    draftRangeEndDate: '2026-07-12',
    draftRangeLabelTemplate: '{weekday} {day} {monthShort} {year}',
    draftRequirementGroupTypeId: 'G2',
    draftRequirementMin: '1',
    draftRequirementMax: '2',
    draftBulkRequirementGroupTypeId: 'G2',
    draftBulkRequirementMin: '0',
    draftBulkRequirementMax: '1',
  };
}

describe('event staffing planner workflow', () => {
  it('validates a planner-facing domain project before generic transform validation', () => {
    const domainProject = buildValidDomainProject();
    const adapter = new FirstSolverAdapter();

    const domainValidation = validateEventStaffingProject(domainProject);
    expect(domainValidation.valid).toBe(true);

    const transformedProject = transformEventStaffingProject(domainProject);
    const genericValidation = validateProject(transformedProject, adapter.getCapabilities());
    expect(genericValidation.valid).toBe(true);

    const normalizedProject = normalizeProject(transformedProject);
    const result = adapter.solve(normalizedProject);
    expect(result.status).toBe('solved');
  });

  it('generates events from a date range and selects the generated rows', () => {
    const domainProject = buildValidDomainProject();
    const editor = buildEditorState();

    const message = generateEventsFromDateRange(domainProject, editor);

    expect(message).toContain('Generated 3 event(s)');
    expect(domainProject.events).toHaveLength(5);
    expect(domainProject.events.map((event) => event.orderIndex)).toEqual([0, 1, 2, 3, 4]);
    expect(editor.selectedEventIds).toHaveLength(3);
    expect(domainProject.events.slice(-3).map((event) => event.date)).toEqual(['2026-07-10', '2026-07-11', '2026-07-12']);
  });

  it('supports inserting and deleting events while keeping related data consistent', () => {
    const domainProject = buildValidDomainProject();
    const editor = buildEditorState();

    const insertMessage = insertEventNearSelection(domainProject, editor, domainProject.events[0]);
    expect(insertMessage).toContain('Inserted event');
    expect(domainProject.events).toHaveLength(3);
    expect(domainProject.events.map((event) => event.orderIndex)).toEqual([0, 1, 2]);

    const insertedEventId = editor.selectedEventId;
    domainProject.preferences[0].eventPreferences[insertedEventId] = 'Y';

    const deleteMessage = deleteEvents(domainProject, [insertedEventId], editor);
    expect(deleteMessage).toContain('Deleted event');
    expect(domainProject.events).toHaveLength(2);
    expect(Object.keys(domainProject.preferences[0].eventPreferences)).not.toContain(insertedEventId);
  });

  it('supports focused and bulk requirement workflows', () => {
    const domainProject = buildValidDomainProject();
    const editor = buildEditorState();

    const addMessage = addRequirementToSelectedEvent(domainProject, editor);
    expect(addMessage).toContain('Added');
    expect(domainProject.requirements.some((requirement) => requirement.eventId === 'E1' && requirement.groupTypeId === 'G2')).toBe(true);

    const removeMessage = removeRequirementFromSelectedEvent(domainProject, editor, 1);
    expect(removeMessage).toContain('Removed');
    expect(domainProject.requirements.some((requirement) => requirement.eventId === 'E1' && requirement.groupTypeId === 'G2')).toBe(false);

    const bulkAssignMessage = bulkAssignGroupToSelectedEvents(domainProject, editor);
    expect(bulkAssignMessage).toContain('Bulk assigned');
    expect(domainProject.requirements.filter((requirement) => requirement.groupTypeId === 'G2')).toHaveLength(2);

    const bulkRemoveMessage = bulkRemoveGroupFromSelectedEvents(domainProject, editor);
    expect(bulkRemoveMessage).toContain('Removed');
    expect(domainProject.requirements.some((requirement) => requirement.groupTypeId === 'G2' && ['E1', 'E2'].includes(requirement.eventId))).toBe(false);
  });

  it('supports copy-from-focused and remove-all bulk requirement tools', () => {
    const domainProject = buildValidDomainProject();
    const editor = buildEditorState();

    editor.selectedEventId = 'E1';
    editor.selectedEventIds = ['E1', 'E2'];

    const copyMessage = bulkCopyRequirementsFromFocusedEvent(domainProject, editor);
    expect(copyMessage).toContain('Copied');
    expect(domainProject.requirements.some((requirement) => requirement.eventId === 'E2' && requirement.groupTypeId === 'G1' && requirement.min === 1)).toBe(true);

    const confirmationMessage = buildRemoveAllRequirementsConfirmationMessage(domainProject, editor);
    expect(confirmationMessage).toContain('Remove all requirements from 2 selected event(s)?');
    expect(confirmationMessage).toContain('3 requirement row(s)');

    const removeAllMessage = bulkRemoveAllRequirementsFromSelectedEvents(domainProject, editor);
    expect(removeAllMessage).toContain('Removed');
    expect(domainProject.requirements).toHaveLength(0);
  });

  it('runs the staffing workflow through domain validation, transform, and generic validation', () => {
    const domainProject = buildValidDomainProject();
    const adapter = new FirstSolverAdapter();

    const workflow = runEventStaffingWorkflow(domainProject, adapter.getCapabilities());

    expect(workflow.domainValidation.valid).toBe(true);
    expect(workflow.genericValidation.valid).toBe(true);
    expect(workflow.transformedProject).not.toBeNull();
    expect(workflow.normalizedProject).not.toBeNull();
    expect(workflow.normalizedProject.assignmentExclusions.length).toBeGreaterThan(0);
    expect(workflow.message).toContain('ready to solve');
  });

  it('describes destructive delete impact before deleting events', () => {
    const domainProject = buildValidDomainProject();
    const editor = buildEditorState();

    const confirmationMessage = buildDeleteEventsConfirmationMessage(domainProject, ['E2']);

    expect(confirmationMessage).toContain('Delete 1 event');
    expect(confirmationMessage).toContain('2 requirement(s)');
    expect(confirmationMessage).toContain('1 forbidden assignment(s)');
    expect(confirmationMessage).toContain('1 preference cell(s)');

    const deleteMessage = deleteEvents(domainProject, ['E2'], editor);
    expect(deleteMessage).toContain('Deleted event');
  });

  it('renders staffing schedule summaries for different returned solutions', () => {
    const domainProject = buildValidDomainProject();
    const solverResult = {
      status: 'solved',
      runtimeMs: 1,
      warnings: [],
      solutions: [
        {
          assignments: [
            {
              itemRef: { id: 'P1' },
              containerRef: { id: 'event__E1__group__G1' },
            },
            {
              itemRef: { id: 'P2' },
              containerRef: { id: 'event__E2__group__G2' },
            },
          ],
        },
        {
          assignments: [
            {
              itemRef: { id: 'P1' },
              containerRef: { id: 'event__E2__group__G1' },
            },
            {
              itemRef: { id: 'P2' },
              containerRef: { id: 'event__E1__group__G1' },
            },
          ],
        },
      ],
    };

    const firstView = renderStaffingScheduleView(domainProject, solverResult, 0);
    const secondView = renderStaffingScheduleView(domainProject, solverResult, 1);

    expect(firstView).toContain('Showing</dt><dd>Solution 1');
    expect(firstView).toContain('Returned solutions');
    expect(firstView).toContain('Previous solution');
    expect(firstView).toContain('Next solution');
    expect(firstView).toContain('Jump to solution');
    expect(firstView).toContain('Solution 1 · 2 assignment(s) · 2 staffed event(s)');
    expect(firstView).toContain('Solution 2 · 2 assignment(s) · 2 staffed event(s)');
    expect(firstView).toContain('Event 1 (Group 1)');
    expect(firstView).toContain('Event 2 (Group 2)');

    expect(secondView).toContain('Showing</dt><dd>Solution 2');
    expect(secondView).toContain('Solution 2 · 2 assignment(s) · 2 staffed event(s)');
    expect(secondView).toContain('Event 2 (Group 1)');
    expect(secondView).toContain('Event 1 (Group 1)');
  });

  it('renders staffing assignments that use transformed event group destination ids', () => {
    const domainProject = buildValidDomainProject();
    domainProject.events = [
      { id: 'evt-2026-08-10-mon-10-aug-2026', label: 'Mon 10 Aug 2026', orderIndex: 1 },
      { id: 'evt-2026-08-11-tue-11-aug-2026', label: 'Tue 11 Aug 2026', orderIndex: 2 },
    ];
    domainProject.groupTypes = [{ id: 'garde', label: 'Garde' }];
    domainProject.people = [
      { id: 'pierre', name: 'Pierre' },
      { id: 'paul', name: 'Paul' },
    ];

    const solverResult = {
      status: 'solved',
      runtimeMs: 1,
      warnings: [],
      solutions: [
        {
          assignments: [
            {
              itemRef: { id: 'pierre' },
              containerRef: { id: 'event:evt-2026-08-10-mon-10-aug-2026::group:garde' },
            },
            {
              itemRef: { id: 'paul' },
              containerRef: { id: 'event:evt-2026-08-11-tue-11-aug-2026::group:garde' },
            },
          ],
        },
      ],
    };

    const view = renderStaffingScheduleView(domainProject, solverResult, 0);
    expect(view).toContain('Mon 10 Aug 2026 (Garde)');
    expect(view).toContain('Tue 11 Aug 2026 (Garde)');
    expect(view).toContain('Pierre');
    expect(view).toContain('Paul');
  });

  it('syncs selected event draft fields when the focused selection changes', () => {
    const editor = {
      selectedEventId: 'E1',
      draftSelectedEventLabel: 'Unsaved label',
      draftSelectedEventDate: '2026-01-01',
      draftSelectedEventOrderIndex: '99',
      lastSyncedSelectedEventId: 'E1',
    };

    syncSelectedEventDrafts(
      editor,
      { id: 'E2', label: 'Event 2', date: '2026-07-02', orderIndex: 4 },
      [{ groupTypeId: 'G2' }],
    );

    expect(editor.selectedEventId).toBe('E2');
    expect(editor.lastSyncedSelectedEventId).toBe('E2');
    expect(editor.draftSelectedEventLabel).toBe('Event 2');
    expect(editor.draftSelectedEventDate).toBe('2026-07-02');
    expect(editor.draftSelectedEventOrderIndex).toBe('4');
    expect(editor.draftRequirementGroupTypeId).toBe('G2');
  });

  it('starts the staffing planner from an empty project instead of sample data', () => {
    const project = createMockDomainProject();

    expect(project.title).toBe('Event staffing planner');
    expect(project.events).toEqual([]);
    expect(project.groupTypes).toEqual([]);
    expect(project.requirements).toEqual([]);
    expect(project.people).toEqual([]);
    expect(project.cooldownRules).toEqual([]);
    expect(project.forcedAssignments).toEqual([]);
    expect(project.forbiddenAssignments).toEqual([]);
    expect(project.preferences).toEqual([]);
  });

  it('falls back to a slugified name when person id override is blank', () => {
    const domainProject = buildValidDomainProject();
    const editor = {
      draftPersonName: 'Charlie Brown',
      draftPersonId: '',
      draftPersonMaxAssignments: '',
      draftPersonTargetAssignments: '',
      draftPersonMaxAssignmentsPerGroupTypeRows: [],
      draftPersonTargetAssignmentsPerGroupTypeRows: [],
      draftPersonAllowedGroupTypeIds: [],
      draftPersonForbiddenGroupTypeIds: [],
      editingPersonIndex: null,
    };

    expect(addPerson(domainProject, editor)).toContain('Added person');
    expect(domainProject.people.at(-1)).toMatchObject({
      id: 'charlie-brown',
      name: 'Charlie Brown',
    });
  });

  it('supports adding and editing a person with per-group limits and eligibility fields', () => {
    const domainProject = buildValidDomainProject();
    const editor = {
      draftPersonName: 'Pierre',
      draftPersonId: 'pierre',
      draftPersonMaxAssignments: '4',
      draftPersonTargetAssignments: '2',
      draftPersonMaxAssignmentsPerGroupTypeRows: [{ groupTypeId: 'G2', value: '5' }],
      draftPersonTargetAssignmentsPerGroupTypeRows: [{ groupTypeId: 'G2', value: '2' }],
      draftPersonAllowedGroupTypeIds: ['G1', 'G2'],
      draftPersonForbiddenGroupTypeIds: [],
      draftPersonEventPreferences: { E1: 'Y', E2: 'N' },
      editingPersonIndex: null,
    };

    expect(addPerson(domainProject, editor)).toContain('Added person');
    expect(domainProject.people.at(-1)).toMatchObject({
      id: 'pierre',
      name: 'Pierre',
      maxAssignments: 4,
      targetAssignments: 2,
      maxAssignmentsPerGroupType: { G2: 5 },
      targetAssignmentsPerGroupType: { G2: 2 },
      allowedGroupTypeIds: ['G1', 'G2'],
      forbiddenGroupTypeIds: [],
    });
    expect(domainProject.preferences.at(-1)).toEqual({ personId: 'pierre', eventPreferences: { E1: 'Y', E2: 'N' } });
    expect(editor).toMatchObject({
      draftPersonName: '',
      draftPersonId: '',
      draftPersonMaxAssignments: '',
      draftPersonTargetAssignments: '',
      draftPersonMaxAssignmentsPerGroupTypeRows: [],
      draftPersonTargetAssignmentsPerGroupTypeRows: [],
      draftPersonAllowedGroupTypeIds: [],
      draftPersonForbiddenGroupTypeIds: [],
      draftPersonEventPreferences: {},
      editingPersonIndex: null,
    });

    editor.draftPersonName = 'Marie';
    editor.draftPersonId = 'marie';
    expect(addPerson(domainProject, editor)).toContain('Added person');
    expect(domainProject.people.slice(-2).map((person) => person.name)).toEqual(['Pierre', 'Marie']);
    expect(editor.draftPersonName).toBe('');
    expect(editor.editingPersonIndex).toBe(null);

    expect(beginEditPerson(domainProject, editor, 0)).toContain('Editing person');
    expect(editor.draftPersonTargetAssignmentsPerGroupTypeRows).toEqual([]);
    editor.draftPersonName = 'Alice Updated';
    editor.draftPersonMaxAssignmentsPerGroupTypeRows = [{ groupTypeId: 'G1', value: '1' }, { groupTypeId: 'G2', value: '3' }];
    editor.draftPersonTargetAssignmentsPerGroupTypeRows = [{ groupTypeId: 'G2', value: '2' }];
    editor.draftPersonAllowedGroupTypeIds = ['G1'];
    editor.draftPersonForbiddenGroupTypeIds = ['G2'];
    editor.draftPersonEventPreferences = { E2: 'Y' };

    expect(addPerson(domainProject, editor)).toContain('Saved person');
    expect(domainProject.people[0]).toMatchObject({
      name: 'Alice Updated',
      maxAssignmentsPerGroupType: { G1: 1, G2: 3 },
      targetAssignmentsPerGroupType: { G2: 2 },
      allowedGroupTypeIds: ['G1'],
      forbiddenGroupTypeIds: ['G2'],
    });
    expect(domainProject.preferences.find((preference) => preference.personId === 'P1')).toEqual({ personId: 'P1', eventPreferences: { E2: 'Y' } });
    expect(cancelEditPerson(editor)).toContain('Cancelled');
  });

  it('shows saved per-group hard and soft target rows when editing a person', () => {
    const domainProject = buildValidDomainProject();
    domainProject.people[0].maxAssignmentsPerGroupType = { G1: 1 };
    domainProject.people[0].targetAssignmentsPerGroupType = { G2: 2 };
    const editor = {};

    expect(beginEditPerson(domainProject, editor, 0)).toContain('Editing person');
    expect(editor.draftPersonMaxAssignmentsPerGroupTypeRows).toEqual([{ groupTypeId: 'G1', value: '1' }]);
    expect(editor.draftPersonTargetAssignmentsPerGroupTypeRows).toEqual([{ groupTypeId: 'G2', value: '2' }]);
    expect(editor.draftPersonEventPreferences).toEqual({ E1: 'Y', E2: 'N' });
  });

  it('renders the people section as quick-add plus advanced settings and saved list', () => {
    const domainProject = buildValidDomainProject();
    const groupTypeLabelsById = new Map(domainProject.groupTypes.map((groupType) => [groupType.id, groupType.label]));

    const addView = renderSupportSections(domainProject, groupTypeLabelsById, {
      draftPersonName: '',
      draftPersonId: '',
      draftPersonMaxAssignments: '',
      draftPersonTargetAssignments: '',
      draftPersonMaxAssignmentsPerGroupTypeRows: [],
      draftPersonTargetAssignmentsPerGroupTypeRows: [],
      draftPersonAllowedGroupTypeIds: [],
      draftPersonForbiddenGroupTypeIds: [],
      editingPersonIndex: null,
    });
    expect(addView).toContain('Quick add person');
    expect(addView).toContain('Advanced person settings');
    expect(addView).toContain('Saved people');
    expect(addView).toContain('2 people');
    expect(addView).toContain('table-wrap event-staffing-scroll-box');
    expect(addView).toContain('Event preferences');
    expect(addView).toContain('Prefer not');

    const editView = renderSupportSections(domainProject, groupTypeLabelsById, {
      draftPersonName: 'Alice',
      draftPersonId: 'P1',
      draftPersonMaxAssignments: '2',
      draftPersonTargetAssignments: '1',
      draftPersonMaxAssignmentsPerGroupTypeRows: [],
      draftPersonTargetAssignmentsPerGroupTypeRows: [],
      draftPersonAllowedGroupTypeIds: [],
      draftPersonForbiddenGroupTypeIds: [],
      editingPersonIndex: 0,
    });
    expect(editView).toContain('Edit person');
    expect(editView).toContain('Cancel edit');
    expect(editView).toContain('Advanced person settings</summary>');
    expect(editView).toContain(' open');
  });

  it('supports saving the global per-group soft target limit', () => {
    const domainProject = buildValidDomainProject();
    const editor = {
      draftGlobalMaxAssignmentsPerPerson: '3',
      draftGlobalMaxAssignmentsPerGroupType: '5',
      draftGlobalTargetAssignmentsPerGroupType: '2',
    };

    expect(saveGlobalLimits(domainProject, editor)).toContain('Saved');
    expect(domainProject.globalLimits).toMatchObject({
      maxAssignmentsPerPerson: 3,
      maxAssignmentsPerGroupType: 5,
      targetAssignmentsPerGroupType: 2,
    });
  });

  it('ignores omitted optional person and global numeric limits', () => {
    const validation = validateEventStaffingProject({
      events: [{ id: 'E1', label: 'Event 1', orderIndex: 1 }],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [{ eventId: 'E1', groupTypeId: 'G1', min: 0, max: 1 }],
      people: [{ id: 'P1', name: 'Pierre', maxAssignments: '', targetAssignments: null }],
      cooldownRules: [],
      forcedAssignments: [],
      forbiddenAssignments: [],
      preferences: [],
      globalLimits: {
        maxAssignmentsPerPerson: '',
        maxAssignmentsPerGroupType: null,
        targetAssignmentsPerGroupType: undefined,
      },
    });

    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-person-max-assignments')).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-person-target-assignments')).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-global-max-assignments')).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-global-group-limit')).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-global-group-target')).toBe(false);
  });

  it('reports domain validation errors for malformed staffing inputs', () => {
    const validation = validateEventStaffingProject({
      events: [{ id: 'E1', label: 'Event 1', orderIndex: 1 }, { id: 'E1', label: 'Duplicate', orderIndex: 1 }],
      groupTypes: [{ id: 'G1', label: 'Group 1' }],
      requirements: [{ eventId: 'E1', groupTypeId: 'G1', min: 2, max: 1 }],
      people: [{ id: 'P1', name: 'Alice', allowedGroupTypeIds: ['UNKNOWN'], maxAssignmentsPerGroupType: { UNKNOWN: 1 }, targetAssignmentsPerGroupType: { UNKNOWN: 2 } }],
      cooldownRules: [{ triggerGroupTypes: [], blockedGroupTypes: 'ANY', blockedNextEventCount: 0 }],
      forcedAssignments: [{ personId: 'UNKNOWN', eventId: 'E1', groupTypeId: 'G1' }],
      forbiddenAssignments: [],
      preferences: [{ personId: 'P1', eventPreferences: { E999: 'MAYBE' } }],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-duplicate-event-id')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-duplicate-order-index')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-requirement-min-exceeds-max')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-unknown-allowed-group-type')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-unknown-person-group-max-group-type')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-unknown-person-group-target-group-type')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-cooldown-span')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-unknown-assignment-person')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-unknown-preference-event')).toBe(true);
    expect(validation.errors.some((issue) => issue.code === 'event-staffing-invalid-preference-value')).toBe(true);
  });
});
