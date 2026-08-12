export function createSolverResult({
  status = 'solved',
  solutions = [],
  warnings = [],
  runtimeMs = 0,
  truncatedByLimit = false,
  interrupted = false,
  timeoutReached = false,
} = {}) {
  return {
    status,
    solutions,
    warnings,
    runtimeMs,
    truncatedByLimit,
    interrupted,
    timeoutReached,
  };
}
