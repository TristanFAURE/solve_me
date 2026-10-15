export class SolverAdapter {
  getCapabilities() {
    throw new Error('getCapabilities() not implemented');
  }

  validateModel(model, options) {
    throw new Error('validateModel() not implemented');
  }

  solve(model, options, runtimeHooks) {
    throw new Error('solve() not implemented');
  }
}
