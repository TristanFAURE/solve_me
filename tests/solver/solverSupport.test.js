import { describe, expect, it } from 'vitest';
import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';
import { createDefaultCapabilities } from '../../src/solver/solverCapabilities.js';
import { SolverAdapter } from '../../src/solver/solverAdapter.js';

describe('solver support modules', () => {
  it('returns default solver capabilities with unsupported advanced features disabled', () => {
    expect(createDefaultCapabilities()).toEqual({
      hardConstraints: true,
      softPreferences: false,
      weightedPreferences: false,
      enumerateSolutions: true,
      optimization: false,
      adjacency: false,
      positionMode: false,
      timeout: false,
      unsatExplanation: false,
      assignmentExclusions: false,
      perItemAssignmentUpperBounds: false,
      scopedAssignmentUpperBounds: false,
      fixedAssignments: false,
      forbiddenAssignments: false,
      softAssignmentScores: false,
      softItemCountTargets: false,
      firstSolution: true,
      scoreDetails: false,
      scoreWeights: false,
      diversity: false,
      solutionFingerprints: false,
      searchStatistics: false,
      partialResults: false,
    });
  });

  it('exposes first solver capabilities on top of the default capability set', () => {
    const adapter = new FirstSolverAdapter();

    expect(adapter.getCapabilities()).toEqual({
      ...createDefaultCapabilities(),
      adjacency: true,
      positionMode: true,
      assignmentExclusions: true,
      perItemAssignmentUpperBounds: true,
      scopedAssignmentUpperBounds: true,
      fixedAssignments: true,
      forbiddenAssignments: true,
      softAssignmentScores: true,
      softItemCountTargets: true,
      optimization: true,
      weightedPreferences: true,
      scoreDetails: true,
      scoreWeights: true,
      diversity: true,
      timeout: true,
      solutionFingerprints: true,
      searchStatistics: true,
      partialResults: true,
    });
  });

  it('throws for unimplemented abstract adapter methods', () => {
    const adapter = new SolverAdapter();

    expect(() => adapter.getCapabilities()).toThrow('getCapabilities() not implemented');
    expect(() => adapter.validateModel()).toThrow('validateModel() not implemented');
    expect(() => adapter.solve()).toThrow('solve() not implemented');
  });
});
