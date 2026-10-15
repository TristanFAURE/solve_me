import { SOLVE_MODES } from './solveOptions.js';

const INTERRUPTED_STATUSES = new Set(['timeout', 'partial', 'cancelled']);

export function buildSearchHints(model, options, result) {
  if (!INTERRUPTED_STATUSES.has(result?.status)) return [];

  const hints = [];
  const add = (code, title, description) => hints.push({ code, title, description });

  if (options?.mode !== SOLVE_MODES.FIRST) {
    add('use-first-mode', 'Find the first solution', 'Use first-solution mode when any valid assignment is sufficient.');
  }
  if ((options?.maxSolutions ?? 1) > 1) {
    add('request-fewer-solutions', 'Request fewer solutions', 'Reduce the requested solution count to shorten enumeration.');
  }
  if (options?.diversity?.enabled) {
    add('lower-diversity', 'Lower diversity requirements', 'Disable diversity or reduce the minimum assignment distance.');
  }

  const itemCount = model?.items?.length ?? 0;
  const destinationCount = model?.assignmentMode === 'position'
    ? (model?.positions?.length ?? 0)
    : (model?.containers?.length ?? 0);
  if (itemCount > 0 && destinationCount > 1) {
    add('tighten-eligibility-bounds', 'Tighten eligibility and bounds', 'Limit eligible destinations and add accurate capacity or assignment bounds.');
    add('add-fixed-assignments', 'Fix known assignments', 'Pre-assign choices that are already decided to reduce the search space.');
  }
  if (itemCount * Math.max(destinationCount, 1) >= 20) {
    add('split-problem', 'Split the problem', 'Solve independent groups or time periods separately when the model permits it.');
  }
  add('increase-timeout', 'Increase the time limit', 'Allow more solve time after reducing the search space where possible.');

  return hints;
}
