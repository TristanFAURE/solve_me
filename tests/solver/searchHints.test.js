import { describe, expect, it } from 'vitest';
import { buildSearchHints } from '../../src/solver/searchHints.js';

describe('search hints', () => {
  it('returns structured narrowing actions only for interrupted results', () => {
    const model = { assignmentMode: 'container', items: Array.from({ length: 10 }), containers: [{}, {}, {}] };
    const options = {
      mode: 'topK',
      maxSolutions: 5,
      diversity: { enabled: true, minimumAssignmentDistance: 2 },
    };
    const codes = buildSearchHints(model, options, { status: 'partial' }).map((hint) => hint.code);

    expect(codes).toEqual(expect.arrayContaining([
      'use-first-mode',
      'request-fewer-solutions',
      'lower-diversity',
      'tighten-eligibility-bounds',
      'add-fixed-assignments',
      'split-problem',
      'increase-timeout',
    ]));
    expect(buildSearchHints(model, options, { status: 'unsat' })).toEqual([]);
  });
});
