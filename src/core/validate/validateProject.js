import { validateStructure } from './validateStructure.js';
import { validateConstraints } from './validateConstraints.js';
import { validateCapabilities } from './validateCapabilities.js';

export function validateProject(project, capabilities = null) {
  const structureErrors = validateStructure(project);
  const constraintErrors = validateConstraints(project);
  const capabilityResult = validateCapabilities(project, capabilities);

  return {
    valid: structureErrors.length === 0 && constraintErrors.length === 0 && capabilityResult.errors.length === 0,
    errors: [...structureErrors, ...constraintErrors, ...capabilityResult.errors],
    warnings: capabilityResult.warnings,
  };
}
