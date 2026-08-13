import { FirstSolverAdapter } from '../../src/solver/adapters/firstSolverAdapter.js';

export function solve(project) {
  const solver = new FirstSolverAdapter();
  return solver.solve(project);
}

export function validateWithSolver(project) {
  const solver = new FirstSolverAdapter();
  return solver.validateModel(project);
}
