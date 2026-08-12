export function createDefaultCapabilities() {
  return {
    hardConstraints: true,
    softPreferences: false,
    weightedPreferences: false,
    enumerateSolutions: true,
    optimization: false,
    adjacency: false,
    positionMode: false,
    timeout: false,
    unsatExplanation: false,
  };
}
