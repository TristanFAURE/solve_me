import { createConstraint, CONSTRAINT_KINDS } from '../src/core/model/constraints.js';
import { createContainer, createItem } from '../src/core/model/nodes.js';
import { createEmptyProject } from '../src/core/model/project.js';
import { createEntityRef } from '../src/core/model/relations.js';
import { normalizeProject } from '../src/core/normalize/normalizeProject.js';
import { FirstSolverAdapter } from '../src/solver/adapters/firstSolverAdapter.js';

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer.`);
  }

  return value;
}

function createDeterministicRng(seed) {
  let state = seed % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }

  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function pickDifferentIndex(rng, size, excludedIndex) {
  let candidate = excludedIndex;
  while (candidate === excludedIndex) {
    candidate = Math.floor(rng() * size);
  }
  return candidate;
}

function buildBenchmarkProject({ containerCount, itemCount, constraintCount, seed }) {
  const rng = createDeterministicRng(seed);
  const baseCapacity = Math.ceil(itemCount / containerCount);
  const containers = Array.from({ length: containerCount }, (_, index) => createContainer({
    id: `C${index + 1}`,
    label: `C${index + 1}`,
    maxCapacity: baseCapacity,
  }));
  const items = Array.from({ length: itemCount }, (_, index) => createItem({
    id: `I${index + 1}`,
    label: `I${index + 1}`,
    metadata: {
      allowedContainerIds: [containers[index % containerCount].id],
    },
  }));
  const constraints = [];
  const seenPairs = new Set();

  for (let index = 0; index < constraintCount; index += 1) {
    const leftIndex = Math.floor(rng() * itemCount);
    const rightIndex = pickDifferentIndex(rng, itemCount, leftIndex);
    const leftItem = items[leftIndex];
    const rightItem = items[rightIndex];
    const pairKey = [leftItem.id, rightItem.id].sort().join('::');

    if (seenPairs.has(pairKey)) {
      continue;
    }

    const leftAllowed = leftItem.metadata.allowedContainerIds[0];
    const rightAllowed = rightItem.metadata.allowedContainerIds[0];

    if (leftAllowed === rightAllowed) {
      continue;
    }

    seenPairs.add(pairKey);
    constraints.push(createConstraint({
      kind: CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
      leftRef: createEntityRef('item', leftItem.id),
      rightRef: createEntityRef('item', rightItem.id),
      metadata: {
        benchmarkGenerated: true,
      },
    }));
  }

  return createEmptyProject({
    title: 'Solver benchmark',
    description: 'Generated container-mode benchmark scenario.',
    assignmentMode: 'container',
    items,
    containers,
    positions: [],
    groups: [],
    containments: [],
    topologies: [],
    constraints,
    preferences: [],
  });
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function main() {
  const containerCount = readIntEnv('BENCH_CONTAINERS', 100);
  const itemCount = readIntEnv('BENCH_ITEMS', 1000);
  const constraintCount = readIntEnv('BENCH_CONSTRAINTS', 1000);
  const seed = readIntEnv('BENCH_SEED', 12345);

  const generatedProject = buildBenchmarkProject({
    containerCount,
    itemCount,
    constraintCount,
    seed,
  });

  const normalizationStart = performance.now();
  const normalizedProject = normalizeProject(generatedProject);
  const normalizationMs = performance.now() - normalizationStart;

  const solver = new FirstSolverAdapter();
  const solveStart = performance.now();
  const result = solver.solve(normalizedProject);
  const solveWallClockMs = performance.now() - solveStart;

  console.log('Solver benchmark');
  console.log('================');
  console.log(`containers: ${containerCount}`);
  console.log(`items: ${itemCount}`);
  console.log(`requested constraints: ${constraintCount}`);
  console.log(`generated constraints: ${normalizedProject.constraints.length}`);
  console.log(`seed: ${seed}`);
  console.log(`normalization: ${formatMs(normalizationMs)}`);
  console.log(`solve wall clock: ${formatMs(solveWallClockMs)}`);
  console.log(`solver runtimeMs: ${result.runtimeMs} ms`);
  console.log(`status: ${result.status}`);
  console.log(`solutions returned: ${result.solutions.length}`);
  console.log(`truncatedByLimit: ${result.truncatedByLimit}`);
  console.log(`warnings: ${result.warnings.length}`);

  if (result.status !== 'solved') {
    process.exitCode = 1;
  }
}

main();
