import { CONSTRAINT_KINDS } from '../../core/model/constraints.js';
import { createAssignment, createSolution } from '../../core/model/solution.js';
import { ASSIGNMENT_MODES } from '../../core/model/assignmentModes.js';
import { NODE_KINDS } from '../../core/model/nodes.js';
import { SolverAdapter } from '../solverAdapter.js';
import { createDefaultCapabilities } from '../solverCapabilities.js';
import { createSolverResult } from '../solverResult.js';
import { SOLVE_MODES, validateSolveOptions } from '../solveOptions.js';
import { rankUniqueSolutions, selectDiverseSolutions } from '../solutionRanking.js';

const SUPPORTED_CONSTRAINTS = new Set([
  CONSTRAINT_KINDS.MUST_SHARE_CONTAINER,
  CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER,
]);

function integerInfo(model, name) {
  try {
    return Number(model.info.get(name));
  } catch {
    return 0;
  }
}

function addCoefficient(entries, index, value) {
  if (index === undefined || index < 0 || value === 0) return;
  entries.set(index, (entries.get(index) ?? 0) + value);
}

function sparseEntries(entries) {
  const sorted = [...entries.entries()].filter(([, value]) => value !== 0).sort((a, b) => a[0] - b[0]);
  return { indices: sorted.map(([index]) => index), values: sorted.map(([, value]) => value) };
}

function buildSolution(values, compiled, model) {
  const assignments = [];
  for (let pair = 0; pair < compiled.pairCount; pair += 1) {
    if (values[pair] <= 0.5) continue;
    const itemId = compiled.itemIds[compiled.pairItemIndices[pair]];
    const destinationId = compiled.destinationIds[compiled.pairDestinationIndices[pair]];
    assignments.push(createAssignment({
      itemRef: { kind: NODE_KINDS.ITEM, id: itemId },
      containerRef: { kind: NODE_KINDS.CONTAINER, id: destinationId },
      positionRef: null,
      metadata: {
        itemLabel: compiled.itemLabels[compiled.pairItemIndices[pair]],
        containerLabel: compiled.destinationLabels[compiled.pairDestinationIndices[pair]],
      },
    }));
  }
  return createSolution({ assignments, score: null, violations: [], metadata: {} });
}

function selectedPairCodes(values, compiled) {
  const selected = new Set();
  for (let pair = 0; pair < compiled.pairCount; pair += 1) {
    if (!Number.isFinite(values[pair]) || (values[pair] > 1e-6 && values[pair] < 1 - 1e-6)) return null;
    if (values[pair] > 0.5) {
      selected.add(compiled.pairItemIndices[pair] * compiled.destinationCount + compiled.pairDestinationIndices[pair]);
    }
  }
  return selected;
}

// This deliberately verifies the domain constraints rather than the generated matrix.
export function verifyHardConstraints(values, compiled, model) {
  if (!values || values.length < compiled.pairCount) return false;
  const selected = selectedPairCodes(values, compiled);
  if (!selected) return false;
  const has = (itemId, destinationId) => {
    const item = compiled.itemIndex.get(itemId);
    const destination = compiled.destinationIndex.get(destinationId);
    return item !== undefined && destination !== undefined
      && selected.has(item * compiled.destinationCount + destination);
  };

  for (const entry of model.fixedAssignments ?? []) if (!has(entry.itemId, entry.destinationId)) return false;
  for (const entry of model.forbiddenAssignments ?? []) if (has(entry.itemId, entry.destinationId)) return false;
  for (const item of model.items) {
    const allowed = Array.isArray(item.metadata?.allowedContainerIds) && item.metadata.allowedContainerIds.length > 0
      ? new Set(item.metadata.allowedContainerIds) : null;
    const forbidden = new Set(item.metadata?.forbiddenContainerIds ?? []);
    for (const destinationId of compiled.destinationIds) {
      if (has(item.id, destinationId)
        && ((allowed && !allowed.has(destinationId)) || forbidden.has(destinationId))) return false;
    }
  }
  for (let destination = 0; destination < compiled.destinationCount; destination += 1) {
    let count = 0;
    for (let item = 0; item < compiled.itemCount; item += 1) {
      if (selected.has(item * compiled.destinationCount + destination)) count += 1;
    }
    if (count < compiled.destinationMinimums[destination]
      || count > compiled.destinationMaximums[destination]) return false;
  }
  for (const exclusion of model.assignmentExclusions ?? []) {
    if (has(exclusion.itemId, exclusion.firstDestinationId) && has(exclusion.itemId, exclusion.secondDestinationId)) return false;
  }
  for (const bound of model.assignmentCountUpperBounds ?? []) {
    let count = 0;
    for (const destinationId of new Set(bound.destinationIds ?? [])) if (has(bound.itemId, destinationId)) count += 1;
    if (count > bound.maxCount) return false;
  }
  for (const constraint of model.constraints) {
    for (const destinationId of compiled.destinationIds) {
      const left = has(constraint.leftRef.id, destinationId);
      const right = has(constraint.rightRef.id, destinationId);
      if (constraint.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER && left !== right) return false;
      if (constraint.kind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER && left && right) return false;
    }
  }
  return true;
}

function buildGreedyStart(compiled, model) {
  const { itemCount, destinationCount, pairIndexByCode } = compiled;
  const parent = Int32Array.from({ length: itemCount }, (_, index) => index);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const join = (left, right) => {
    left = find(left);
    right = find(right);
    if (left === right) return;
    if (left < right) parent[right] = left;
    else parent[left] = right;
  };
  for (const constraint of model.constraints) {
    if (constraint.kind !== CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) continue;
    const left = compiled.itemIndex.get(constraint.leftRef.id);
    const right = compiled.itemIndex.get(constraint.rightRef.id);
    if (left === undefined || right === undefined) return null;
    join(left, right);
  }

  const componentByRoot = new Map();
  const itemComponent = new Int32Array(itemCount);
  for (let item = 0; item < itemCount; item += 1) {
    const root = find(item);
    if (!componentByRoot.has(root)) componentByRoot.set(root, componentByRoot.size);
    itemComponent[item] = componentByRoot.get(root);
  }
  const components = Array.from({ length: componentByRoot.size }, () => []);
  for (let item = 0; item < itemCount; item += 1) components[itemComponent[item]].push(item);

  const blockedComponents = Array.from({ length: components.length }, () => new Set());
  for (const constraint of model.constraints) {
    if (constraint.kind !== CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER) continue;
    const leftItem = compiled.itemIndex.get(constraint.leftRef.id);
    const rightItem = compiled.itemIndex.get(constraint.rightRef.id);
    if (leftItem === undefined || rightItem === undefined) return null;
    const left = itemComponent[leftItem];
    const right = itemComponent[rightItem];
    if (left === right) return null;
    blockedComponents[left].add(right);
    blockedComponents[right].add(left);
  }

  const exclusions = Array.from({ length: itemCount }, () => new Map());
  for (const exclusion of model.assignmentExclusions ?? []) {
    const item = compiled.itemIndex.get(exclusion.itemId);
    const first = compiled.destinationIndex.get(exclusion.firstDestinationId);
    const second = compiled.destinationIndex.get(exclusion.secondDestinationId);
    if (item === undefined || first === undefined || second === undefined) return null;
    if (!exclusions[item].has(first)) exclusions[item].set(first, new Set());
    if (!exclusions[item].has(second)) exclusions[item].set(second, new Set());
    exclusions[item].get(first).add(second);
    exclusions[item].get(second).add(first);
  }

  const boundsByItem = Array.from({ length: itemCount }, () => []);
  for (const bound of model.assignmentCountUpperBounds ?? []) {
    const item = compiled.itemIndex.get(bound.itemId);
    if (item === undefined) return null;
    const destinations = new Set();
    for (const id of bound.destinationIds ?? []) {
      const destination = compiled.destinationIndex.get(id);
      if (destination === undefined) return null;
      destinations.add(destination);
    }
    boundsByItem[item].push({ destinations, maxCount: bound.maxCount, count: 0 });
  }

  const values = new Float64Array(compiled.numCols);
  const containerCounts = new Int32Array(destinationCount);
  const workloads = new Int32Array(itemCount);
  const selectedDestinations = Array.from({ length: itemCount }, () => new Set());
  const selectedComponents = Array.from({ length: destinationCount }, () => new Set());

  const canSelect = (component, destination) => {
    if (selectedComponents[destination].has(component)) return true;
    const members = components[component];
    const maximum = compiled.destinationMaximums[destination];
    if (containerCounts[destination] + members.length > maximum) return false;
    for (const blocked of blockedComponents[component]) if (selectedComponents[destination].has(blocked)) return false;
    for (const item of members) {
      if (pairIndexByCode[item * destinationCount + destination] < 0) return false;
      for (const excluded of exclusions[item].get(destination) ?? []) {
        if (selectedDestinations[item].has(excluded)) return false;
      }
      for (const bound of boundsByItem[item]) {
        if (bound.destinations.has(destination) && bound.count >= bound.maxCount) return false;
      }
    }
    return true;
  };
  const select = (component, destination) => {
    if (!canSelect(component, destination)) return false;
    if (selectedComponents[destination].has(component)) return true;
    selectedComponents[destination].add(component);
    for (const item of components[component]) {
      values[pairIndexByCode[item * destinationCount + destination]] = 1;
      selectedDestinations[item].add(destination);
      workloads[item] += 1;
      containerCounts[destination] += 1;
      for (const bound of boundsByItem[item]) if (bound.destinations.has(destination)) bound.count += 1;
    }
    return true;
  };

  for (const fixed of model.fixedAssignments ?? []) {
    const item = compiled.itemIndex.get(fixed.itemId);
    const destination = compiled.destinationIndex.get(fixed.destinationId);
    if (item === undefined || destination === undefined || !select(itemComponent[item], destination)) return null;
  }
  for (let destination = 0; destination < destinationCount; destination += 1) {
    const minimum = compiled.destinationMinimums[destination];
    while (containerCounts[destination] < minimum) {
      let best = -1;
      let bestWorkload = Infinity;
      let bestScore = -Infinity;
      for (let component = 0; component < components.length; component += 1) {
        if (!canSelect(component, destination) || selectedComponents[destination].has(component)) continue;
        let workload = 0;
        let score = 0;
        for (const item of components[component]) {
          workload += workloads[item];
          score += compiled.pairCosts[pairIndexByCode[item * destinationCount + destination]];
        }
        workload /= components[component].length;
        if (workload < bestWorkload || (workload === bestWorkload && score > bestScore)) {
          best = component;
          bestWorkload = workload;
          bestScore = score;
        }
      }
      if (best < 0 || !select(best, destination)) return null;
    }
  }

  for (const target of compiled.targetVariables) {
    let count = 0;
    for (const pair of target.pairIndices) if (values[pair] > 0.5) count += 1;
    values[target.index] = Math.abs(count - target.targetCount);
  }
  for (const workload of compiled.workloadVariables) values[workload.index] = workloads[workload.item];
  for (const deviation of compiled.equityVariables) {
    values[deviation.index] = Math.abs(workloads[deviation.leftItem] - workloads[deviation.rightItem]);
  }
  return verifyHardConstraints(values, compiled, model) ? values : null;
}

function compileModel(highs, model, options) {
  const infinity = highs.infinity;
  const items = [...model.items].sort((left, right) => left.id.localeCompare(right.id));
  const containers = [...model.containers].sort((left, right) => left.id.localeCompare(right.id));
  const itemIds = items.map((item) => item.id);
  const destinationIds = containers.map((container) => container.id);
  const itemIndex = new Map(itemIds.map((id, index) => [id, index]));
  const destinationIndex = new Map(destinationIds.map((id, index) => [id, index]));
  const itemCount = itemIds.length;
  const destinationCount = destinationIds.length;
  const codeOf = (itemId, destinationId) => {
    const item = itemIndex.get(itemId);
    const destination = destinationIndex.get(destinationId);
    return item === undefined || destination === undefined ? -1 : item * destinationCount + destination;
  };
  const forbidden = new Set((model.forbiddenAssignments ?? []).map((entry) => codeOf(entry.itemId, entry.destinationId)));
  const fixed = new Set((model.fixedAssignments ?? []).map((entry) => codeOf(entry.itemId, entry.destinationId)));
  const scoreByCode = new Map();
  for (const entry of model.softAssignmentScores ?? []) {
    const code = codeOf(entry.itemId, entry.destinationId);
    scoreByCode.set(code, (scoreByCode.get(code) ?? 0) + entry.score);
  }

  const colCost = [];
  const colLower = [];
  const colUpper = [];
  const integrality = [];
  const pairItems = [];
  const pairDestinations = [];
  const pairIndexByCode = new Int32Array(itemCount * destinationCount);
  pairIndexByCode.fill(-1);
  const itemPairIndices = Array.from({ length: itemCount }, () => []);
  const destinationPairIndices = Array.from({ length: destinationCount }, () => []);
  const addVariable = (cost, lower, upper, integer = false) => {
    const index = colCost.length;
    colCost.push(cost);
    colLower.push(lower);
    colUpper.push(upper);
    integrality.push(integer ? highs.constants.variableType.integer : highs.constants.variableType.continuous);
    return index;
  };

  for (let item = 0; item < itemCount; item += 1) {
    const metadata = items[item].metadata;
    const allowed = Array.isArray(metadata?.allowedContainerIds) && metadata.allowedContainerIds.length > 0
      ? new Set(metadata.allowedContainerIds) : null;
    const metadataForbidden = new Set(metadata?.forbiddenContainerIds ?? []);
    for (let destination = 0; destination < destinationCount; destination += 1) {
      const code = item * destinationCount + destination;
      if ((allowed && !allowed.has(destinationIds[destination])) || metadataForbidden.has(destinationIds[destination]) || forbidden.has(code)) continue;
      const index = addVariable(
        (scoreByCode.get(code) ?? 0) * (options.scoreWeights.preferences ?? 1),
        fixed.has(code) ? 1 : 0,
        1,
        true,
      );
      pairItems.push(item);
      pairDestinations.push(destination);
      pairIndexByCode[code] = index;
      itemPairIndices[item].push(index);
      destinationPairIndices[destination].push(index);
    }
  }
  const pairCount = pairItems.length;
  const pairCosts = colCost.slice();

  const rows = [];
  const addRow = (lower, upper, entries) => rows.push({ lower, upper, entries });
  for (const fixedEntry of model.fixedAssignments ?? []) {
    if (pairIndexByCode[codeOf(fixedEntry.itemId, fixedEntry.destinationId)] < 0) addRow(1, 1, new Map());
  }
  for (let destination = 0; destination < destinationCount; destination += 1) {
    addRow(
      containers[destination].metadata?.minCapacity ?? 0,
      containers[destination].metadata?.maxCapacity ?? infinity,
      new Map(destinationPairIndices[destination].map((index) => [index, 1])),
    );
  }
  for (const exclusion of model.assignmentExclusions ?? []) {
    const entries = new Map();
    addCoefficient(entries, pairIndexByCode[codeOf(exclusion.itemId, exclusion.firstDestinationId)], 1);
    addCoefficient(entries, pairIndexByCode[codeOf(exclusion.itemId, exclusion.secondDestinationId)], 1);
    addRow(-infinity, 1, entries);
  }
  for (const bound of model.assignmentCountUpperBounds ?? []) {
    const entries = new Map();
    for (const destinationId of new Set(bound.destinationIds ?? [])) {
      addCoefficient(entries, pairIndexByCode[codeOf(bound.itemId, destinationId)], 1);
    }
    addRow(-infinity, bound.maxCount, entries);
  }
  for (const constraint of model.constraints) {
    for (let destination = 0; destination < destinationCount; destination += 1) {
      const left = pairIndexByCode[codeOf(constraint.leftRef.id, destinationIds[destination])];
      const right = pairIndexByCode[codeOf(constraint.rightRef.id, destinationIds[destination])];
      const entries = new Map();
      addCoefficient(entries, left, 1);
      addCoefficient(entries, right, constraint.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER ? -1 : 1);
      if (constraint.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) addRow(0, 0, entries);
      else addRow(-infinity, 1, entries);
    }
  }

  const targetVariables = [];
  const targetWeight = options.scoreWeights.targets ?? 1;
  for (const target of model.softItemCountTargets ?? []) {
    const deviation = addVariable(-targetWeight, 0, infinity);
    const countEntries = new Map();
    for (const destinationId of new Set(target.destinationIds ?? [])) {
      addCoefficient(countEntries, pairIndexByCode[codeOf(target.itemId, destinationId)], 1);
    }
    targetVariables.push({ index: deviation, targetCount: target.targetCount, pairIndices: [...countEntries.keys()] });
    const above = new Map(countEntries);
    addCoefficient(above, deviation, -1);
    addRow(-infinity, target.targetCount, above);
    const below = new Map([...countEntries].map(([index, value]) => [index, -value]));
    addCoefficient(below, deviation, -1);
    addRow(-infinity, -target.targetCount, below);
  }

  const workloadVariables = [];
  const equityVariables = [];
  const equityWeight = options.scoreWeights.equity ?? 0;
  const equityItemIds = [...new Set(options.equityEligibleItemIds ?? model.metadata?.equityEligibleItemIds ?? [])];
  if (equityWeight > 0 && equityItemIds.length > 1) {
    const workloadByItem = new Map();
    for (const itemId of equityItemIds) {
      const item = itemIndex.get(itemId);
      const workload = addVariable(0, 0, destinationCount);
      workloadByItem.set(item, workload);
      workloadVariables.push({ item, index: workload });
      const entries = new Map(itemPairIndices[item].map((index) => [index, 1]));
      addCoefficient(entries, workload, -1);
      addRow(0, 0, entries);
    }
    for (let left = 0; left < equityItemIds.length; left += 1) {
      for (let right = left + 1; right < equityItemIds.length; right += 1) {
        const leftItem = itemIndex.get(equityItemIds[left]);
        const rightItem = itemIndex.get(equityItemIds[right]);
        const deviation = addVariable(-equityWeight, 0, infinity);
        equityVariables.push({ index: deviation, leftItem, rightItem });
        const leftWorkload = workloadByItem.get(leftItem);
        const rightWorkload = workloadByItem.get(rightItem);
        addRow(-infinity, 0, new Map([[leftWorkload, 1], [rightWorkload, -1], [deviation, -1]]));
        addRow(-infinity, 0, new Map([[leftWorkload, -1], [rightWorkload, 1], [deviation, -1]]));
      }
    }
  }

  const starts = new Int32Array(rows.length + 1);
  let nonzeros = 0;
  const sparseRows = rows.map((row, index) => {
    const sparse = sparseEntries(row.entries);
    nonzeros += sparse.indices.length;
    starts[index + 1] = nonzeros;
    return sparse;
  });
  const indices = new Int32Array(nonzeros);
  const values = new Float64Array(nonzeros);
  let offset = 0;
  for (const sparse of sparseRows) {
    indices.set(sparse.indices, offset);
    values.set(sparse.values, offset);
    offset += sparse.indices.length;
  }
  const compiled = {
    itemIds,
    itemLabels: items.map((item) => item.label ?? item.id),
    destinationIds,
    destinationLabels: containers.map((container) => container.label ?? container.id),
    destinationMinimums: Float64Array.from(containers.map((container) => container.metadata?.minCapacity ?? 0)),
    destinationMaximums: Float64Array.from(containers.map((container) => container.metadata?.maxCapacity ?? Infinity)),
    itemIndex,
    destinationIndex,
    itemCount,
    destinationCount,
    pairCount,
    pairItemIndices: Int32Array.from(pairItems),
    pairDestinationIndices: Int32Array.from(pairDestinations),
    pairIndexByCode,
    pairCosts: Float64Array.from(pairCosts),
    targetVariables,
    workloadVariables,
    equityVariables,
    numCols: colCost.length,
  };
  return {
    compiled,
    data: {
      numCols: colCost.length,
      numRows: rows.length,
      sense: highs.constants.objectiveSense.maximize,
      colCost: Float64Array.from(colCost),
      colLower: Float64Array.from(colLower),
      colUpper: Float64Array.from(colUpper),
      rowLower: Float64Array.from(rows.map((row) => row.lower)),
      rowUpper: Float64Array.from(rows.map((row) => row.upper)),
      integrality: Int32Array.from(integrality),
      matrix: { format: 'csr', numRows: rows.length, numCols: colCost.length, starts, indices, values },
    },
  };
}

export class HighsSolverAdapter extends SolverAdapter {
  constructor(highs) {
    super();
    if (!highs?.createModel) throw new TypeError('A loaded HiGHS runtime is required.');
    this.highs = highs;
  }

  getCapabilities() {
    return {
      ...createDefaultCapabilities(), optimization: true, assignmentExclusions: true,
      perItemAssignmentUpperBounds: true, scopedAssignmentUpperBounds: true,
      fixedAssignments: true, forbiddenAssignments: true, softAssignmentScores: true,
      softItemCountTargets: true, weightedPreferences: true, scoreDetails: true,
      scoreWeights: true, diversity: true, timeout: true, partialResults: true,
      solutionFingerprints: true, searchStatistics: true,
    };
  }

  validateModel(model, options = {}) {
    const optionValidation = validateSolveOptions(options, this.getCapabilities());
    const errors = [...optionValidation.errors];
    const normalized = optionValidation.options;
    if (model.assignmentMode !== ASSIGNMENT_MODES.CONTAINER || model.assignmentMultiplicity !== 'multiple') {
      errors.push('HiGHS supports only multiple-assignment container models.');
    }
    if (model.constraints.some((constraint) => !SUPPORTED_CONSTRAINTS.has(constraint.kind))) {
      errors.push('HiGHS supports only mustShareContainer and mustNotShareContainer relation constraints.');
    }
    if (model.preferences.length > 0) errors.push('HiGHS does not support general soft preferences.');
    if (model.positions.length > 0 || model.topologies.length > 0 || model.containments.length > 0) {
      errors.push('HiGHS container models cannot contain positions, topology, or containment relations.');
    }
    if (Object.values(normalized.scoreWeights).some((weight) => weight < 0)) {
      errors.push('HiGHS requires nonnegative objective weights.');
    }
    const eligible = normalized.equityEligibleItemIds ?? model.metadata?.equityEligibleItemIds;
    if ((normalized.scoreWeights.equity ?? 0) !== 0 && !Array.isArray(eligible)) {
      errors.push('A nonzero equity weight requires an explicit equityEligibleItemIds array.');
    }
    const itemIds = new Set(model.items.map((item) => item.id));
    const destinationIds = new Set(model.containers.map((container) => container.id));
    if (Array.isArray(eligible) && eligible.some((itemId) => !itemIds.has(itemId))) errors.push('equityEligibleItemIds contains an unknown item id.');
    const invalidPair = (entry) => !itemIds.has(entry.itemId) || !destinationIds.has(entry.destinationId);
    if ((model.fixedAssignments ?? []).some(invalidPair) || (model.forbiddenAssignments ?? []).some(invalidPair)) {
      errors.push('Fixed or forbidden assignments contain an unknown item or destination id.');
    }
    return { valid: errors.length === 0, model, errors, warnings: [], options: normalized };
  }

  solve(model, options = {}, runtimeHooks = {}) {
    const startedAt = performance.now();
    const validation = this.validateModel(model, options);
    if (!validation.valid) return createSolverResult({ status: 'error', warnings: validation.errors, runtimeMs: Math.round(performance.now() - startedAt) });
    const normalized = validation.options;
    const returnReserveMs = normalized.timeLimitMs === null ? 0 : Math.min(100, Math.floor(normalized.timeLimitMs * 0.02));
    const searchDeadlineMs = normalized.timeLimitMs === null ? null : normalized.timeLimitMs - returnReserveMs;
    const { compiled, data } = compileModel(this.highs, model, normalized);
    const seedValues = buildGreedyStart(compiled, model);
    const seedSolution = seedValues
      ? rankUniqueSolutions([buildSolution(seedValues, compiled, model)], model, normalized)[0]
      : null;
    if (normalized.mode === SOLVE_MODES.FIRST && seedSolution) {
      try { runtimeHooks.onSearchStart?.(); } catch { /* Diagnostic hooks cannot affect solving. */ }
      try {
        runtimeHooks.onProgress?.({
          exploredNodes: 0,
          prunedNodes: 0,
          solutionCount: 1,
          elapsedMs: Math.round(performance.now() - startedAt),
          bestSolution: seedSolution,
        });
      } catch { /* Progress observers are diagnostic only. */ }
      try { runtimeHooks.onSearchEnd?.(); } catch { /* Diagnostic hooks cannot affect cleanup. */ }
      return createSolverResult({
        status: 'solved',
        solutions: [seedSolution],
        runtimeMs: Math.round(performance.now() - startedAt),
        searchComplete: false,
        optimalityProven: false,
        interrupted: true,
        incumbentCount: 1,
        canonicalRankingComplete: false,
        solutionSelection: 'best-found',
      });
    }
    const persistentModel = this.highs.createModel(data);
    const solutions = [];
    let timeoutReached = false;
    let terminalStatus = null;
    let enumerationExhausted = false;
    let additionalSolutionExists = false;
    let optimizeOptimal = false;
    let topKIterationsProven = true;
    let exploredNodes = 0;
    let incumbentCount = seedValues ? 1 : 0;
    try {
      persistentModel.options.set({ output_flag: false, presolve: 'on', mip_rel_gap: 0, mip_abs_gap: 0 });
      if (normalized.mode === SOLVE_MODES.FIRST) persistentModel.options.set('mip_max_improving_sols', 1);
      if (seedValues) persistentModel.setSolution({ colValue: seedValues });
      const requested = normalized.mode === SOLVE_MODES.TOP_K ? normalized.maxSolutions : 1;
      try { runtimeHooks.onSearchStart?.(); } catch { /* Diagnostic hooks cannot affect solving. */ }
      if (seedValues && typeof runtimeHooks.onProgress === 'function') {
        try {
          runtimeHooks.onProgress({ exploredNodes: 0, prunedNodes: 0, solutionCount: 1, elapsedMs: Math.round(performance.now() - startedAt), bestSolution: seedSolution });
        } catch { /* Progress observers are diagnostic only. */ }
      }
      const solveCount = normalized.mode === SOLVE_MODES.TOP_K ? requested + 1 : 1;
      for (let iteration = 0; iteration < solveCount; iteration += 1) {
        const remainingMs = searchDeadlineMs === null ? null : searchDeadlineMs - (performance.now() - startedAt);
        if (remainingMs !== null && remainingMs <= 0) { timeoutReached = true; break; }
        if (remainingMs !== null) {
          persistentModel.zeroAllClocks();
          persistentModel.options.set('time_limit', Math.max(0.001, remainingMs / 1000));
        }
        let latestIncumbent = null;
        const callbacks = {
          [this.highs.constants.callbackType.mipImprovingSolution]: (event) => {
            if (!verifyHardConstraints(event.data.mip_solution, compiled, model)) return;
            incumbentCount += 1;
            latestIncumbent = event.data.mip_solution;
            if (typeof runtimeHooks.onProgress === 'function') {
              const ranked = rankUniqueSolutions([buildSolution(latestIncumbent, compiled, model)], model, normalized)[0];
              try {
                runtimeHooks.onProgress({ exploredNodes, prunedNodes: 0, solutionCount: solutions.length + 1, elapsedMs: Math.round(performance.now() - startedAt), bestSolution: ranked });
              } catch { /* Progress observers are diagnostic only. */ }
            }
          },
        };
        if (searchDeadlineMs !== null) {
          callbacks[this.highs.constants.callbackType.mipInterrupt] = (event) => {
            if (performance.now() - startedAt >= searchDeadlineMs) event.interrupt();
          };
        }
        persistentModel.run(callbacks);
        terminalStatus = persistentModel.getModelStatus();
        if (normalized.mode === SOLVE_MODES.TOP_K
          && terminalStatus !== this.highs.constants.modelStatus.optimal
          && terminalStatus !== this.highs.constants.modelStatus.infeasible) {
          topKIterationsProven = false;
        }
        if (normalized.mode === SOLVE_MODES.OPTIMIZE) {
          optimizeOptimal = terminalStatus === this.highs.constants.modelStatus.optimal;
        }
        exploredNodes += integerInfo(persistentModel, 'mip_node_count');
        timeoutReached ||= terminalStatus === this.highs.constants.modelStatus.timeLimit;
        timeoutReached ||= searchDeadlineMs !== null && performance.now() - startedAt >= searchDeadlineMs;
        const primalStatus = integerInfo(persistentModel, 'primal_solution_status');
        const nativeValues = primalStatus === this.highs.constants.solutionStatus.feasible
          ? persistentModel.getSolution().colValue : latestIncumbent;
        const hasIncumbent = nativeValues !== null && verifyHardConstraints(nativeValues, compiled, model);
        if (hasIncumbent) {
          const candidate = rankUniqueSolutions([buildSolution(nativeValues, compiled, model)], model, normalized)[0];
          if (!solutions.some((solution) => solution.fingerprint === candidate.fingerprint)) solutions.push(candidate);
          if (normalized.mode === SOLVE_MODES.TOP_K && solutions.length > requested) {
            additionalSolutionExists = true;
            break;
          }
          if (normalized.mode === SOLVE_MODES.TOP_K) {
            const entries = new Map();
            let selectedCount = 0;
            for (let pair = 0; pair < compiled.pairCount; pair += 1) {
              const selected = nativeValues[pair] > 0.5;
              if (selected) selectedCount += 1;
              addCoefficient(entries, pair, selected ? -1 : 1);
            }
            const distance = normalized.diversity.enabled
              ? Math.max(1, normalized.diversity.minimumAssignmentDistance) : 1;
            persistentModel.addRow(distance - selectedCount, this.highs.infinity, sparseEntries(entries));
          }
        }
        if (!hasIncumbent && terminalStatus === this.highs.constants.modelStatus.infeasible) {
          enumerationExhausted = true;
        }
        if (!hasIncumbent || timeoutReached || normalized.mode !== SOLVE_MODES.TOP_K) break;
      }
    } finally {
      try { runtimeHooks.onSearchEnd?.(); } catch { /* Diagnostic hooks cannot affect cleanup. */ }
      persistentModel.dispose();
    }
    if (solutions.length === 0 && seedSolution && timeoutReached) solutions.push(seedSolution);
    const uniqueRanked = rankUniqueSolutions(solutions, model, normalized);
    const ranked = normalized.diversity.enabled
      ? selectDiverseSolutions(uniqueRanked, normalized.maxSolutions, normalized.diversity.minimumAssignmentDistance)
      : uniqueRanked.slice(0, normalized.maxSolutions);
    const infeasible = terminalStatus === this.highs.constants.modelStatus.infeasible;
    const diversityUnmet = normalized.mode === SOLVE_MODES.TOP_K
      && normalized.diversity.enabled
      && ranked.length < normalized.maxSolutions
      && ranked.length > 0;
    const firstOmitted = uniqueRanked[normalized.maxSolutions];
    const cutoff = uniqueRanked[normalized.maxSolutions - 1];
    const objectiveBoundaryProven = Boolean(firstOmitted && cutoff && firstOmitted.score < cutoff.score);
    const canonicalRankingComplete = normalized.mode === SOLVE_MODES.TOP_K
      && !timeoutReached
      && !normalized.diversity.enabled
      && topKIterationsProven
      && (enumerationExhausted || objectiveBoundaryProven);
    const incompleteTopK = normalized.mode === SOLVE_MODES.TOP_K
      && ranked.length > 0
      && !canonicalRankingComplete;
    const status = timeoutReached || incompleteTopK
      ? (ranked.length ? 'partial' : 'timeout')
      : (ranked.length ? 'solved' : (infeasible ? 'unsat' : 'error'));
    const warnings = [];
    if (diversityUnmet) warnings.push(`Only ${ranked.length} solutions met the requested minimum assignment distance.`);
    if (incompleteTopK && normalized.diversity.enabled) {
      warnings.push('HiGHS diversity cuts do not prove the shared canonical fingerprint ranking; returned solutions are best-found candidates.');
    } else if (incompleteTopK && firstOmitted?.score === cutoff?.score) {
      warnings.push('HiGHS found additional equal-score optima without exhausting the tie; returned solutions are best-found candidates, not a proven canonical fingerprint top-K.');
    } else if (incompleteTopK) {
      warnings.push('HiGHS ended before proving the canonical fingerprint top-K; returned solutions are best-found candidates.');
    }
    if (status === 'error') warnings.push(`HiGHS ended with model status ${terminalStatus}.`);
    return createSolverResult({
      status,
      solutions: ranked,
      warnings,
      runtimeMs: Math.round(performance.now() - startedAt),
      searchComplete: canonicalRankingComplete
        || (!timeoutReached && normalized.mode !== SOLVE_MODES.TOP_K && (optimizeOptimal || infeasible)),
      optimalityProven: normalized.mode === SOLVE_MODES.OPTIMIZE && optimizeOptimal && ranked.length > 0,
      truncatedByLimit: normalized.mode === SOLVE_MODES.TOP_K && additionalSolutionExists,
      interrupted: timeoutReached || (normalized.mode === SOLVE_MODES.FIRST && terminalStatus !== this.highs.constants.modelStatus.optimal),
      timeoutReached,
      exploredNodes,
      incumbentCount,
      canonicalRankingComplete,
      solutionSelection: canonicalRankingComplete ? 'canonical' : 'best-found',
    });
  }
}
