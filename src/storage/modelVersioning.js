import { createEmptyProject, MODEL_VERSION } from '../core/model/project.js';

const VERSION_POLICY = {
  currentVersion: MODEL_VERSION,
  minimumSupportedVersion: '0.1.0',
};

function parseSemver(version) {
  if (typeof version !== 'string') {
    return null;
  }

  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function compareSemver(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}

function classifyVersionCompatibility(sourceVersion) {
  const targetVersion = VERSION_POLICY.currentVersion;
  const parsedTarget = parseSemver(targetVersion);
  const parsedMinimum = parseSemver(VERSION_POLICY.minimumSupportedVersion);

  if (typeof sourceVersion !== 'string' || sourceVersion.trim().length === 0) {
    return {
      status: 'warn-missing-version',
      incompatible: false,
      warnings: ['Project version metadata is missing. The current model version will be assumed during import.'],
      errors: [],
    };
  }

  const normalizedSourceVersion = sourceVersion.trim();
  const parsedSource = parseSemver(normalizedSourceVersion);

  if (!parsedSource || !parsedTarget || !parsedMinimum) {
    return {
      status: 'warn-unparseable-version',
      incompatible: false,
      warnings: [`Project version '${normalizedSourceVersion}' does not follow the expected major.minor.patch format. Compatibility could not be verified.`],
      errors: [],
    };
  }

  if (compareSemver(parsedSource, parsedMinimum) < 0) {
    return {
      status: 'error-too-old',
      incompatible: true,
      warnings: [],
      errors: [`Project version '${normalizedSourceVersion}' is older than the minimum supported version '${VERSION_POLICY.minimumSupportedVersion}'. Import requires a dedicated migration path before it can continue.`],
    };
  }

  if (compareSemver(parsedSource, parsedTarget) === 0) {
    return {
      status: 'compatible',
      incompatible: false,
      warnings: [],
      errors: [],
    };
  }

  if (parsedSource.major > parsedTarget.major) {
    return {
      status: 'error-future-major',
      incompatible: true,
      warnings: [],
      errors: [`Project version '${normalizedSourceVersion}' is from a newer major version than the current supported model version '${targetVersion}'. Import is blocked to avoid silently misreading incompatible data.`],
    };
  }

  if (parsedSource.major < parsedTarget.major) {
    return {
      status: 'error-older-major',
      incompatible: true,
      warnings: [],
      errors: [`Project version '${normalizedSourceVersion}' is from an older major version than the current model version '${targetVersion}'. Import is blocked until a major-version migration path is implemented.`],
    };
  }

  if (compareSemver(parsedSource, parsedTarget) > 0) {
    return {
      status: 'warn-future-minor-or-patch',
      incompatible: false,
      warnings: [`Project version '${normalizedSourceVersion}' is newer than the current model version '${targetVersion}' within the same major version. Import will continue cautiously, but newer fields may be ignored.`],
      errors: [],
    };
  }

  return {
    status: 'warn-older-minor-or-patch',
    incompatible: false,
    warnings: [`Project version '${normalizedSourceVersion}' is older than the current model version '${targetVersion}' within the same major version. Import will continue using the current migration path.`],
    errors: [],
  };
}

function migrateProjectForward(project, sourceVersion) {
  if (!sourceVersion || sourceVersion === MODEL_VERSION) {
    return createEmptyProject({
      ...project,
      modelVersion: MODEL_VERSION,
    });
  }

  if (sourceVersion === '0.1.0') {
    return createEmptyProject({
      ...project,
      modelVersion: MODEL_VERSION,
    });
  }

  return createEmptyProject({
    ...project,
    modelVersion: MODEL_VERSION,
  });
}

export function getProjectVersionInfo(project) {
  const sourceVersion = project?.modelVersion ?? null;
  const compatibility = classifyVersionCompatibility(sourceVersion);

  return {
    sourceVersion,
    targetVersion: MODEL_VERSION,
    policy: VERSION_POLICY,
    status: compatibility.status,
    warnings: compatibility.warnings,
    errors: compatibility.errors,
    incompatible: compatibility.incompatible,
  };
}

export function migrateProjectModel(project) {
  const versionInfo = getProjectVersionInfo(project);

  if (versionInfo.incompatible) {
    throw new Error(versionInfo.errors[0] ?? 'Project version is incompatible with the current model version.');
  }

  return migrateProjectForward(project, versionInfo.sourceVersion);
}
