export const SOLVE_MODES = Object.freeze({
  FIRST: 'first',
  TOP_K: 'topK',
  OPTIMIZE: 'optimize',
});

export const SOLVER_ENGINES = Object.freeze({ AUTO: 'auto', JS: 'js', HIGHS: 'highs' });

export const SOLVE_OPTION_LIMITS = Object.freeze({
  MAX_SOLUTIONS: 1000,
  MAX_TIME_LIMIT_MS: 2_147_483_647,
  MAX_ABSOLUTE_SCORE_WEIGHT: 1_000_000,
  MAX_ASSIGNMENT_DISTANCE: 1_000_000,
});

export const DEFAULT_SOLVE_OPTIONS = Object.freeze({
  mode: SOLVE_MODES.TOP_K,
  engine: SOLVER_ENGINES.AUTO,
  maxSolutions: 10,
  timeLimitMs: null,
  includeScoreDetails: false,
  equityEligibleItemIds: null,
  scoreWeights: Object.freeze({}),
  diversity: Object.freeze({
    enabled: false,
    minimumAssignmentDistance: 0,
  }),
});

export function createDefaultSolveOptions() {
  return normalizeSolveOptions();
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeSolveOptions(options = {}) {
  const source = isPlainObject(options) ? options : {};
  const mode = source.mode ?? DEFAULT_SOLVE_OPTIONS.mode;
  const defaultMaxSolutions = mode === SOLVE_MODES.FIRST || mode === SOLVE_MODES.OPTIMIZE
    ? 1
    : DEFAULT_SOLVE_OPTIONS.maxSolutions;
  const sourceWeights = isPlainObject(source.scoreWeights) ? source.scoreWeights : {};
  const sourceDiversity = isPlainObject(source.diversity) ? source.diversity : {};

  return {
    mode,
    engine: source.engine ?? DEFAULT_SOLVE_OPTIONS.engine,
    maxSolutions: source.maxSolutions ?? defaultMaxSolutions,
    timeLimitMs: source.timeLimitMs ?? null,
    includeScoreDetails: source.includeScoreDetails ?? DEFAULT_SOLVE_OPTIONS.includeScoreDetails,
    equityEligibleItemIds: Array.isArray(source.equityEligibleItemIds)
      ? [...new Set(source.equityEligibleItemIds)].sort()
      : (source.equityEligibleItemIds ?? null),
    scoreWeights: Object.fromEntries(Object.keys(sourceWeights)
      .sort()
      .map((key) => [key, sourceWeights[key]])),
    diversity: {
      enabled: sourceDiversity.enabled ?? DEFAULT_SOLVE_OPTIONS.diversity.enabled,
      minimumAssignmentDistance: sourceDiversity.minimumAssignmentDistance
        ?? DEFAULT_SOLVE_OPTIONS.diversity.minimumAssignmentDistance,
    },
  };
}

function isIntegerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function validateSolveOptions(options = {}, capabilities = null) {
  const errors = [];

  if (!isPlainObject(options)) {
    errors.push('Solve options must be an object.');
  }

  if (isPlainObject(options) && options.scoreWeights !== undefined && !isPlainObject(options.scoreWeights)) {
    errors.push('scoreWeights must be an object.');
  }

  if (isPlainObject(options) && options.diversity !== undefined && !isPlainObject(options.diversity)) {
    errors.push('diversity must be an object.');
  }

  const normalized = normalizeSolveOptions(options);
  if (!Object.values(SOLVE_MODES).includes(normalized.mode)) {
    errors.push(`mode must be one of: ${Object.values(SOLVE_MODES).join(', ')}.`);
  }
  if (!Object.values(SOLVER_ENGINES).includes(normalized.engine)) {
    errors.push(`engine must be one of: ${Object.values(SOLVER_ENGINES).join(', ')}.`);
  }

  if (!isIntegerInRange(normalized.maxSolutions, 1, SOLVE_OPTION_LIMITS.MAX_SOLUTIONS)) {
    errors.push(`maxSolutions must be an integer between 1 and ${SOLVE_OPTION_LIMITS.MAX_SOLUTIONS}.`);
  }

  if (normalized.mode === SOLVE_MODES.FIRST && normalized.maxSolutions !== 1) {
    errors.push('first mode requires maxSolutions to be 1.');
  }

  if (normalized.timeLimitMs !== null
    && !isIntegerInRange(normalized.timeLimitMs, 1, SOLVE_OPTION_LIMITS.MAX_TIME_LIMIT_MS)) {
    errors.push(`timeLimitMs must be null or an integer between 1 and ${SOLVE_OPTION_LIMITS.MAX_TIME_LIMIT_MS}.`);
  }

  if (typeof normalized.includeScoreDetails !== 'boolean') {
    errors.push('includeScoreDetails must be a boolean.');
  }

  if (normalized.equityEligibleItemIds !== null
    && (!Array.isArray(normalized.equityEligibleItemIds)
      || normalized.equityEligibleItemIds.some((itemId) => typeof itemId !== 'string' || itemId.length === 0))) {
    errors.push('equityEligibleItemIds must be null or an array of non-empty item ids.');
  }

  const supportedWeightKeys = new Set(['preferences', 'targets', 'equity']);

  Object.entries(normalized.scoreWeights).forEach(([key, value]) => {
    if (key.length === 0) {
      errors.push('scoreWeights keys must not be empty.');
    }
    if (!supportedWeightKeys.has(key)) {
      errors.push(`Unsupported score weight '${key}'.`);
    }
    if (!isIntegerInRange(
      value,
      -SOLVE_OPTION_LIMITS.MAX_ABSOLUTE_SCORE_WEIGHT,
      SOLVE_OPTION_LIMITS.MAX_ABSOLUTE_SCORE_WEIGHT,
    )) {
      errors.push(`scoreWeights.${key || '<empty>'} must be a finite integer between -${SOLVE_OPTION_LIMITS.MAX_ABSOLUTE_SCORE_WEIGHT} and ${SOLVE_OPTION_LIMITS.MAX_ABSOLUTE_SCORE_WEIGHT}.`);
    }
  });

  if (typeof normalized.diversity.enabled !== 'boolean') {
    errors.push('diversity.enabled must be a boolean.');
  }
  if (!isIntegerInRange(
    normalized.diversity.minimumAssignmentDistance,
    0,
    SOLVE_OPTION_LIMITS.MAX_ASSIGNMENT_DISTANCE,
  )) {
    errors.push(`diversity.minimumAssignmentDistance must be an integer between 0 and ${SOLVE_OPTION_LIMITS.MAX_ASSIGNMENT_DISTANCE}.`);
  }
  if (normalized.diversity.enabled && normalized.mode !== SOLVE_MODES.TOP_K) {
    errors.push('Diversity can only be enabled in topK mode.');
  }

  if (capabilities) {
    if (normalized.mode === SOLVE_MODES.OPTIMIZE && capabilities.optimization !== true) {
      errors.push('The selected solver does not support optimize mode.');
    }
    if (normalized.mode === SOLVE_MODES.TOP_K && capabilities.enumerateSolutions !== true) {
      errors.push('The selected solver does not support topK mode.');
    }
    if (normalized.timeLimitMs !== null && capabilities.timeout !== true) {
      errors.push('The selected solver does not support time limits.');
    }
    if (normalized.includeScoreDetails && capabilities.scoreDetails !== true) {
      errors.push('The selected solver does not support score details.');
    }
    if (Object.keys(normalized.scoreWeights).length > 0 && capabilities.scoreWeights !== true) {
      errors.push('The selected solver does not support configurable score weights.');
    }
    if (normalized.diversity.enabled && capabilities.diversity !== true) {
      errors.push('The selected solver does not support diversity filtering.');
    }
  }

  return {
    valid: errors.length === 0,
    options: normalized,
    errors,
  };
}
