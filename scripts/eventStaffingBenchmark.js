import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { normalizeProject } from '../src/core/normalize/normalizeProject.js';
import { transformEventStaffingProject } from '../src/core/transform/eventStaffingProject.js';
import { FirstSolverAdapter } from '../src/solver/adapters/firstSolverAdapter.js';
import { HighsSolverAdapter } from '../src/solver/adapters/highsSolverAdapter.js';
import loadHighs from 'highs';
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

function getMemoryBytes(highs = null) {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    wasmRuntime: Number.isFinite(highs?.memoryBytes) ? highs.memoryBytes : 0,
  };
}

function createSolveOptions(domainProject, timeLimitMs, mode) {
  return {
    mode,
    maxSolutions: mode === SOLVE_MODES.FIRST ? 1 : 3,
    timeLimitMs,
    includeScoreDetails: true,
    equityEligibleItemIds: domainProject.people.map((person) => person.id),
    scoreWeights: { equity: 100, preferences: 10, targets: 20 },
    diversity: { enabled: mode === SOLVE_MODES.TOP_K, minimumAssignmentDistance: 2 },
  };
}

async function runChild(definition, settings) {
  if (global.gc) global.gc();
  const memory = { baseline: getMemoryBytes() };

  const generationStart = performance.now();
  const domainProject = createEventStaffingBenchmarkScenario(definition);
  const generationMs = performance.now() - generationStart;
  memory.afterGeneration = getMemoryBytes();

  const transformStart = performance.now();
  const transformedProject = transformEventStaffingProject(domainProject);
  const transformMs = performance.now() - transformStart;
  memory.afterTransform = getMemoryBytes();

  const normalizationStart = performance.now();
  const normalizedProject = normalizeProject(transformedProject);
  const normalizationMs = performance.now() - normalizationStart;
  memory.afterNormalization = getMemoryBytes();

  const wasmLoadStart = performance.now();
  const highs = settings.engine === 'highs' ? await loadHighs() : null;
  const solver = highs ? new HighsSolverAdapter(highs) : new FirstSolverAdapter();
  const wasmLoadMs = performance.now() - wasmLoadStart;
  const solveOptions = createSolveOptions(domainProject, settings.timeLimitMs, settings.mode);
  const validationStart = performance.now();
  const validation = solver.validateModel(normalizedProject, solveOptions);
  const validationMs = performance.now() - validationStart;
  memory.afterValidation = getMemoryBytes(highs);

  const theoreticalPairs = normalizedProject.items.length * normalizedProject.containers.length;
  const jsFirstNodePairInspections = settings.engine === 'js'
    ? theoreticalPairs * normalizedProject.containers.length
    : null;
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
    memory.afterSolve = getMemoryBytes(highs);
  }

  const memoryValues = Object.values(memory);
  const stageMaximumByMetric = Object.fromEntries(Object.keys(memory.baseline).map((metric) => [
    metric, Math.max(...memoryValues.map((snapshot) => snapshot[metric])),
  ]));
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
      wasmLoad: wasmLoadMs,
      solverStartup: solverStartupMs,
      solverSearch: solverSearchMs,
      solverFinalize: solverFinalizeMs,
      solveWallClock: solveWallClockMs,
    },
    memoryBytes: {
      ...memory,
      observedStageMaximumByMetric: stageMaximumByMetric,
      observedRssGrowth: stageMaximumByMetric.rss - memory.baseline.rss,
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
      jsFirstNodePairInspections,
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
      score: result.solutions[0]?.score ?? null,
      assignmentCount: result.solutions[0]?.assignments?.length ?? 0,
    } : {
      status: validation.valid ? 'not-run-safety-limit' : 'not-run-invalid',
      searchComplete: false,
      exploredNodes: 0,
      prunedNodes: 0,
      solutions: 0,
      incumbentCount: 0,
      runtimeMs: 0,
      score: null,
      assignmentCount: 0,
    },
    safety: {
      internalTimeoutMs: settings.timeLimitMs,
      engine: settings.engine,
      mode: settings.mode,
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
  const { definition, model, timingsMs, memoryBytes, solve, safety } = run;
  console.log(`\n${definition.id} [${safety.engine}]: ${model.days} days x ${definition.slotsPerDay} slots/day x ${model.doctors} doctors x ${model.categories} categories`);
  console.log(`  model: ${model.slots} slots, ${model.containers} containers, ${model.preferenceCells} preference cells, ${model.theoreticalPairs} doctor/container pairs`);
  console.log(`  terms: ${model.forbiddenAssignments} forbidden, ${model.softAssignmentScores} soft scores, ${model.assignmentCountUpperBounds} count bounds`);
  if (model.jsFirstNodePairInspections !== null) {
    console.log(`  JS search metric: ${model.jsFirstNodePairInspections} estimated pair inspections at the first search node`);
  }
  console.log(`  timings: generate ${formatMs(timingsMs.generation)}, transform ${formatMs(timingsMs.transform)}, normalize ${formatMs(timingsMs.normalization)}, WASM load ${formatMs(timingsMs.wasmLoad)}, validate ${formatMs(timingsMs.solverValidation)}`);
  console.log(`  solver: startup ${formatMs(timingsMs.solverStartup)}, search ${formatMs(timingsMs.solverSearch)}, finalize ${formatMs(timingsMs.solverFinalize)}, wall ${formatMs(timingsMs.solveWallClock)}`);
  const solveMemory = memoryBytes.afterSolve;
  console.log(`  memory baseline: RSS ${formatMiB(memoryBytes.baseline.rss)}, heap ${formatMiB(memoryBytes.baseline.heapUsed)}, external ${formatMiB(memoryBytes.baseline.external)}, array buffers ${formatMiB(memoryBytes.baseline.arrayBuffers)}`);
  console.log(`  memory after validation: RSS ${formatMiB(memoryBytes.afterValidation.rss)}, heap ${formatMiB(memoryBytes.afterValidation.heapUsed)}, external ${formatMiB(memoryBytes.afterValidation.external)}, array buffers ${formatMiB(memoryBytes.afterValidation.arrayBuffers)}, WASM runtime ${formatMiB(memoryBytes.afterValidation.wasmRuntime)}`);
  console.log(`  memory after solve: ${solveMemory ? `RSS ${formatMiB(solveMemory.rss)}, heap ${formatMiB(solveMemory.heapUsed)}, external ${formatMiB(solveMemory.external)}, array buffers ${formatMiB(solveMemory.arrayBuffers)}, WASM runtime ${formatMiB(solveMemory.wasmRuntime)}` : 'not run'}`);
  console.log(`  memory summary: observed stage maximum RSS ${formatMiB(memoryBytes.observedStageMaximumByMetric.rss)}, RSS growth ${formatMiB(memoryBytes.observedRssGrowth)}`);
  console.log(`  result: ${solve.status}, ${solve.exploredNodes} explored, ${solve.prunedNodes} pruned, ${solve.incumbentCount} incumbents, ${solve.solutions} returned`);
  if (solve.solutions > 0) console.log(`  incumbent: ${solve.assignmentCount} assignments, score ${solve.score}`);
  if (safety.searchSkipped) console.log(`  safety: search skipped because ${model.theoreticalPairs} pairs exceed limit ${safety.maxSolvePairs}`);
}

function runParent() {
  const settings = {
    timeLimitMs: readPositiveInteger('BENCH_STAFFING_TIMEOUT_MS', 1500),
    processTimeoutMs: readPositiveInteger('BENCH_STAFFING_PROCESS_TIMEOUT_MS', 30000),
    maxOldSpaceMb: readPositiveInteger('BENCH_STAFFING_MAX_OLD_SPACE_MB', 512),
    maxSolvePairs: readPositiveInteger('BENCH_STAFFING_MAX_SOLVE_PAIRS', 400000),
    engine: process.env.BENCH_STAFFING_ENGINE === 'js' ? 'js' : 'highs',
    mode: Object.values(SOLVE_MODES).includes(process.env.BENCH_STAFFING_MODE)
      ? process.env.BENCH_STAFFING_MODE
      : SOLVE_MODES.TOP_K,
  };
  console.log('Event Staffing solver benchmark');
  console.log('================================');
  console.log(`Safety limits: ${settings.engine} engine, ${settings.mode} mode, ${settings.timeLimitMs} ms internal, ${settings.processTimeoutMs} ms process, ${settings.maxOldSpaceMb} MiB old-space, ${settings.maxSolvePairs} solve pairs`);

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
  process.stdout.write(JSON.stringify(await runChild(definition, settings)));
} else {
  runParent();
}
