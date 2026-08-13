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
    });
  });

  it('exposes first solver capabilities on top of the default capability set', () => {
    const adapter = new FirstSolverAdapter();

    expect(adapter.getCapabilities()).toEqual({
      ...createDefaultCapabilities(),
      adjacency: true,
      positionMode: true,
    });
  });

  it('throws for unimplemented abstract adapter methods', () => {
    const adapter = new SolverAdapter();

    expect(() => adapter.getCapabilities()).toThrow('getCapabilities() not implemented');
    expect(() => adapter.validateModel()).toThrow('validateModel() not implemented');
    expect(() => adapter.solve()).toThrow('solve() not implemented');
  });
});
