import { describe, expect, it } from 'vitest';
import { scenario } from '../../helpers/projectBuilder.js';

describe('normalizeProject', () => {
  it('dedupes symmetric must-share constraints', () => {
    const project = scenario()
      .containerMode()
      .items('A', 'B')
      .containers({ T1: 2 })
      .mustShare('A', 'B')
      .mustShare('B', 'A')
      .buildNormalized();

    expect(project.constraints).toHaveLength(1);
    expect(project.derived.mustShareComponents).toHaveLength(1);
    expect(project.derived.mustShareComponents[0].slice().sort()).toEqual(['A', 'B']);
  });

  it('builds a symmetric adjacency map from topology relations', () => {
    const project = scenario()
      .positionMode()
      .items('A', 'B')
      .containers({ T1: ['P1', 'P2', 'P3'] })
      .adjacent('P1', 'P2')
      .adjacent('P2', 'P3')
      .buildNormalized();

    expect(project.derived.adjacencyMap.get('P1')?.has('P2')).toBe(true);
    expect(project.derived.adjacencyMap.get('P2')?.has('P1')).toBe(true);
    expect(project.derived.adjacencyMap.get('P2')?.has('P3')).toBe(true);
    expect(project.derived.adjacencyMap.get('P3')?.has('P2')).toBe(true);
  });

  it('dedupes additive assignment-oriented normalized families', () => {
    const project = scenario()
      .containerMode()
      .items('A')
      .containers({ T1: 1, T2: 1 })
      .assignmentExclusion('A', 'T1', 'T2')
      .assignmentExclusion('A', 'T2', 'T1')
      .assignmentCountUpperBound('A', ['T1', 'T2'], 1)
      .assignmentCountUpperBound('A', ['T2', 'T1'], 1)
      .fixedAssignment('A', 'T1')
      .fixedAssignment('A', 'T1')
      .forbiddenAssignment('A', 'T2')
      .forbiddenAssignment('A', 'T2')
      .softAssignmentScore('A', 'T1', 5)
      .softAssignmentScore('A', 'T1', 5)
      .softItemCountTarget('A', ['T1', 'T2'], 1)
      .softItemCountTarget('A', ['T2', 'T1'], 1)
      .buildNormalized();

    expect(project.assignmentExclusions).toHaveLength(1);
    expect(project.assignmentCountUpperBounds).toHaveLength(1);
    expect(project.fixedAssignments).toHaveLength(1);
    expect(project.forbiddenAssignments).toHaveLength(1);
    expect(project.softAssignmentScores).toHaveLength(1);
    expect(project.softItemCountTargets).toHaveLength(1);
  });
});
