import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeProject } from '../src/core/normalize/normalizeProject.js';
import { transformEventStaffingProject } from '../src/core/transform/eventStaffingProject.js';
import { FirstSolverAdapter } from '../src/solver/adapters/firstSolverAdapter.js';
import { SOLVE_MODES } from '../src/solver/solveOptions.js';
import {
  createEventStaffingBenchmarkScenario,
  EVENT_STAFFING_BENCHMARK_SCENARIOS,
} from './eventStaffingBenchmarkScenario.js';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_SCENARIOS = Object.freeze([
  ...EVENT_STAFFING_BENCHMARK_SCENARIOS,
  { id: '30d-10s-50d-lower-bound', dayCount: 30, slotsPerDay: 10, peopleCount: 50, categoryCount: 1 },
  { id: '30d-10s-200d-lower-bound', dayCount: 30, slotsPerDay: 10, peopleCount: 200, categoryCount: 1 },
  { id: '60d-10s-200d-lower-bound', dayCount: 60, slotsPerDay: 10, peopleCount: 200, categoryCount: 1 },
  { id: '90d-10s-200d-lower-bound', dayCount: 90, slotsPerDay: 10, peopleCount: 200, categoryCount: 1 },
  { id: '180d-10s-200d-lower-bound', dayCount: 180, slotsPerDay: 10, peopleCount: 200, categoryCount: 1 },
]);

function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function getScenarios() {
  if (!process.env.BENCH_STAFFING_DAYS) return DEFAULT_SCENARIOS;
  const dayCount = readPositiveInteger('BENCH_STAFFING_DAYS', 30);
  const slotsPerDay = readPositiveInteger('BENCH_STAFFING_SLOTS_PER_DAY', 10);
  const peopleCount = readPositiveInteger('BENCH_STAFFING_PEOPLE', 200);
  const categoryCount = readPositiveInteger('BENCH_STAFFING_CATEGORIES', 1);
  return [{
    id: `custom-${dayCount}d-${slotsPerDay}s-${peopleCount}p-${categoryCount}c`,
    dayCount,
    slotsPerDay,
    peopleCount,
    categoryCount,
  }];
}

function getHeapBytes() {
  return process.memoryUsage().heapUsed;
}

function createSolveOptions(domainProject, timeLimitMs) {
  return {
    mode: SOLVE_MODES.TOP_K,
    maxSolutions: 3,
    timeLimitMs,
    includeScoreDetails: true,
    equityEligibleItemIds: domainProject.people.map((person) => person.id),
    scoreWeights: { equity: 100, preferences: 10, targets: 20 },
    diversity: { enabled: true, minimumAssignmentDistance: 2 },
  };
}

function runChild(definition, settings) {
  if (global.gc) global.gc();
  const heap = { baseline: getHeapBytes() };

  const generationStart = performance.now();
  const domainProject = createEventStaffingBenchmarkScenario(definition);
  const generationMs = performance.now() - generationStart;
  heap.afterGeneration = getHeapBytes();

  const transformStart = performance.now();
  const transformedProject = transformEventStaffingProject(domainProject);
  const transformMs = performance.now() - transformStart;
  heap.afterTransform = getHeapBytes();

  const normalizationStart = performance.now();
  const normalizedProject = normalizeProject(transformedProject);
  const normalizationMs = performance.now() - normalizationStart;
  heap.afterNormalization = getHeapBytes();

  const solver = new FirstSolverAdapter();
  const solveOptions = createSolveOptions(domainProject, settings.timeLimitMs);
  const validationStart = performance.now();
  const validation = solver.validateModel(normalizedProject, solveOptions);
  const validationMs = performance.now() - validationStart;
  heap.afterValidation = getHeapBytes();

  const theoreticalPairs = normalizedProject.items.length * normalizedProject.containers.length;
  const firstNodePairInspections = theoreticalPairs * normalizedProject.containers.length;
  let result = null;
  let solveWallClockMs = 0;
  let solverStartupMs = 0;
  let solverSearchMs = 0;
  let solverFinalizeMs = 0;

  if (theoreticalPairs <= settings.maxSolvePairs && validation.valid) {
    let searchStartedAt = null;
    let searchEndedAt = null;
    const solveStart = performance.now();
    result = solver.solve(normalizedProject, solveOptions, {
      onSearchStart() { searchStartedAt = performance.now(); },
      onSearchEnd() { searchEndedAt = performance.now(); },
    });
    const solveEnd = performance.now();
    solveWallClockMs = solveEnd - solveStart;
    solverStartupMs = (searchStartedAt ?? solveEnd) - solveStart;
    solverSearchMs = searchStartedAt === null ? 0 : (searchEndedAt ?? solveEnd) - searchStartedAt;
    solverFinalizeMs = searchEndedAt === null ? 0 : solveEnd - searchEndedAt;
    heap.afterSolve = getHeapBytes();
  }

  const heapValues = Object.values(heap);
  return {
    definition: {
      ...definition,
      slotsPerDay: definition.slotsPerDay ?? 1,
      categoryCount: definition.categoryCount ?? 3,
    },
    timingsMs: {
      generation: generationMs,
      transform: transformMs,
      normalization: normalizationMs,
      solverValidation: validationMs,
      solverStartup: solverStartupMs,
      solverSearch: solverSearchMs,
      solverFinalize: solverFinalizeMs,
      solveWallClock: solveWallClockMs,
    },
    heapBytes: {
      ...heap,
      observedPeak: Math.max(...heapValues),
      observedGrowth: Math.max(...heapValues) - heap.baseline,
    },
    model: {
      days: definition.dayCount,
      slots: domainProject.events.length,
      categories: domainProject.groupTypes.length,
      doctors: domainProject.people.length,
      requirements: domainProject.requirements.length,
      preferenceCells: domainProject.people.length * domainProject.events.length,
      items: normalizedProject.items.length,
      containers: normalizedProject.containers.length,
      forbiddenAssignments: normalizedProject.forbiddenAssignments.length,
      softAssignmentScores: normalizedProject.softAssignmentScores.length,
      assignmentCountUpperBounds: normalizedProject.assignmentCountUpperBounds.length,
      theoreticalPairs,
      firstNodePairInspections,
    },
    validation: { valid: validation.valid, errors: validation.errors.length, warnings: validation.warnings.length },
    solve: result ? {
      status: result.status,
      searchComplete: result.searchComplete,
      exploredNodes: result.exploredNodes,
      prunedNodes: result.prunedNodes,
      solutions: result.solutions.length,
      incumbentCount: result.incumbentCount,
      runtimeMs: result.runtimeMs,
    } : {
      status: validation.valid ? 'not-run-safety-limit' : 'not-run-invalid',
      searchComplete: false,
      exploredNodes: 0,
      prunedNodes: 0,
      solutions: 0,
      incumbentCount: 0,
      runtimeMs: 0,
    },
    safety: {
      internalTimeoutMs: settings.timeLimitMs,
      maxSolvePairs: settings.maxSolvePairs,
      searchSkipped: theoreticalPairs > settings.maxSolvePairs,
    },
  };
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function formatMiB(value) {
  return `${(value / 1024 / 1024).toFixed(2)} MiB`;
}

function printRun(run) {
  const { definition, model, timingsMs, heapBytes, solve, safety } = run;
  console.log(`\n${definition.id}: ${model.days} days x ${definition.slotsPerDay} slots/day x ${model.doctors} doctors x ${model.categories} categories`);
  console.log(`  model: ${model.slots} slots, ${model.containers} containers, ${model.preferenceCells} preference cells, ${model.theoreticalPairs} doctor/container pairs`);
  console.log(`  terms: ${model.forbiddenAssignments} forbidden, ${model.softAssignmentScores} soft scores, ${model.assignmentCountUpperBounds} count bounds`);
  console.log(`  work lower bound: ${model.firstNodePairInspections} pair inspections at the first search node`);
  console.log(`  timings: generate ${formatMs(timingsMs.generation)}, transform ${formatMs(timingsMs.transform)}, normalize ${formatMs(timingsMs.normalization)}, validate ${formatMs(timingsMs.solverValidation)}`);
  console.log(`  solver: startup ${formatMs(timingsMs.solverStartup)}, search ${formatMs(timingsMs.solverSearch)}, finalize ${formatMs(timingsMs.solverFinalize)}, wall ${formatMs(timingsMs.solveWallClock)}`);
  const solveHeap = heapBytes.afterSolve === undefined ? 'not run' : formatMiB(heapBytes.afterSolve);
  console.log(`  heap: baseline ${formatMiB(heapBytes.baseline)}, generation ${formatMiB(heapBytes.afterGeneration)}, transform ${formatMiB(heapBytes.afterTransform)}, normalize ${formatMiB(heapBytes.afterNormalization)}, validation ${formatMiB(heapBytes.afterValidation)}, solve ${solveHeap}`);
  console.log(`  heap summary: observed peak ${formatMiB(heapBytes.observedPeak)}, growth ${formatMiB(heapBytes.observedGrowth)}`);
  console.log(`  result: ${solve.status}, ${solve.exploredNodes} explored, ${solve.prunedNodes} pruned, ${solve.incumbentCount} incumbents, ${solve.solutions} returned`);
  if (safety.searchSkipped) console.log(`  safety: search skipped because ${model.theoreticalPairs} pairs exceed limit ${safety.maxSolvePairs}`);
}

function runParent() {
  const settings = {
    timeLimitMs: readPositiveInteger('BENCH_STAFFING_TIMEOUT_MS', 1500),
    processTimeoutMs: readPositiveInteger('BENCH_STAFFING_PROCESS_TIMEOUT_MS', 10000),
    maxOldSpaceMb: readPositiveInteger('BENCH_STAFFING_MAX_OLD_SPACE_MB', 512),
    maxSolvePairs: readPositiveInteger('BENCH_STAFFING_MAX_SOLVE_PAIRS', 60000),
  };
  console.log('Event Staffing solver benchmark');
  console.log('================================');
  console.log(`Safety limits: ${settings.timeLimitMs} ms internal, ${settings.processTimeoutMs} ms process, ${settings.maxOldSpaceMb} MiB old-space, ${settings.maxSolvePairs} solve pairs`);

  const runs = [];
  for (const definition of getScenarios()) {
    const child = spawnSync(process.execPath, [
      '--expose-gc',
      `--max-old-space-size=${settings.maxOldSpaceMb}`,
      SCRIPT_PATH,
      '--child',
      JSON.stringify(definition),
      JSON.stringify(settings),
    ], {
      encoding: 'utf8',
      timeout: settings.processTimeoutMs,
      maxBuffer: 1024 * 1024,
    });

    if (child.error || child.status !== 0) {
      const reason = child.error?.code === 'ETIMEDOUT' ? 'external-timeout' : `exit-${child.status ?? 'unknown'}`;
      console.log(`\n${definition.id}: ${reason}`);
      if (child.stderr) console.log(`  child stderr: ${child.stderr.trim().split('\n').at(-1)}`);
      runs.push({ definition, error: reason });
      continue;
    }

    const run = JSON.parse(child.stdout);
    runs.push(run);
    printRun(run);
  }

  if (process.env.BENCH_STAFFING_JSON === '1') {
    console.log(`\nJSON ${JSON.stringify(runs)}`);
  }
}

if (process.argv[2] === '--child') {
  const definition = JSON.parse(process.argv[3]);
  const settings = JSON.parse(process.argv[4]);
  process.stdout.write(JSON.stringify(runChild(definition, settings)));
} else {
  runParent();
}
