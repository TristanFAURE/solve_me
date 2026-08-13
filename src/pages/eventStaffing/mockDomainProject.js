export function createMockDomainProject() {
  return {
    title: 'Event staffing planner',
    events: [],
    groupTypes: [],
    requirements: [],
    people: [],
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
}
