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
});
