import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOLVE_OPTIONS,
  SOLVE_MODES,
  SOLVE_OPTION_LIMITS,
  createDefaultSolveOptions,
  normalizeSolveOptions,
  validateSolveOptions,
} from '../../src/solver/solveOptions.js';

describe('solve options', () => {
  it('provides backward-compatible, serializable defaults', () => {
    const normalized = createDefaultSolveOptions();

    expect(normalized).toEqual(DEFAULT_SOLVE_OPTIONS);
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized);
  });

  it.each([
    [SOLVE_MODES.FIRST, 1],
    [SOLVE_MODES.TOP_K, 10],
    [SOLVE_MODES.OPTIMIZE, 1],
  ])('normalizes the %s mode with a safe result limit', (mode, maxSolutions) => {
    expect(normalizeSolveOptions({ mode })).toMatchObject({ mode, maxSolutions });
  });

  it('normalizes nested options without retaining caller-owned objects', () => {
    const input = {
      maxSolutions: 3,
      includeScoreDetails: true,
      scoreWeights: { targets: 20, preferences: 10 },
      diversity: { enabled: true, minimumAssignmentDistance: 4 },
    };

    const normalized = normalizeSolveOptions(input);
    input.scoreWeights.targets = 99;
    input.diversity.minimumAssignmentDistance = 99;

    expect(normalized.scoreWeights).toEqual({ preferences: 10, targets: 20 });
    expect(normalized.diversity).toEqual({ enabled: true, minimumAssignmentDistance: 4 });
  });

  it.each([
    [{ mode: 'all' }, 'mode must be one of'],
    [{ maxSolutions: 0 }, 'maxSolutions must be an integer'],
    [{ maxSolutions: 1.5 }, 'maxSolutions must be an integer'],
    [{ mode: SOLVE_MODES.FIRST, maxSolutions: 2 }, 'first mode requires'],
    [{ timeLimitMs: 0 }, 'timeLimitMs must be null or an integer'],
    [{ includeScoreDetails: 'yes' }, 'includeScoreDetails must be a boolean'],
    [{ scoreWeights: { preferences: Number.NaN } }, 'must be a finite integer'],
    [{ scoreWeights: { preferences: SOLVE_OPTION_LIMITS.MAX_ABSOLUTE_SCORE_WEIGHT + 1 } }, 'must be a finite integer'],
    [{ diversity: { minimumAssignmentDistance: -1 } }, 'minimumAssignmentDistance must be an integer'],
    [{ mode: SOLVE_MODES.OPTIMIZE, diversity: { enabled: true } }, 'Diversity can only be enabled'],
  ])('rejects invalid values %#', (options, expectedMessage) => {
    const validation = validateSolveOptions(options);

    expect(validation.valid).toBe(false);
    expect(validation.errors.some((error) => error.includes(expectedMessage))).toBe(true);
  });

  it('validates requested features against additive capabilities', () => {
    const capabilities = {
      enumerateSolutions: false,
      optimization: false,
      timeout: false,
      scoreDetails: false,
      scoreWeights: false,
      diversity: false,
    };

    expect(validateSolveOptions({ mode: SOLVE_MODES.TOP_K }, capabilities).errors)
      .toContain('The selected solver does not support topK mode.');
    expect(validateSolveOptions({ mode: SOLVE_MODES.OPTIMIZE }, capabilities).errors)
      .toContain('The selected solver does not support optimize mode.');
    expect(validateSolveOptions({ timeLimitMs: 100 }, capabilities).errors)
      .toContain('The selected solver does not support time limits.');
    expect(validateSolveOptions({ includeScoreDetails: true }, capabilities).errors)
      .toContain('The selected solver does not support score details.');
    expect(validateSolveOptions({ scoreWeights: { preferences: 1 } }, capabilities).errors)
      .toContain('The selected solver does not support configurable score weights.');
    expect(validateSolveOptions({ diversity: { enabled: true } }, capabilities).errors)
      .toContain('The selected solver does not support diversity filtering.');
  });
});
