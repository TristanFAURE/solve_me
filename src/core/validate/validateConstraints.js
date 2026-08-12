import { ASSIGNMENT_MODES } from '../model/assignmentModes.js';
import { isConstraint, CONSTRAINT_KINDS } from '../model/constraints.js';
import { isNode, NODE_KINDS } from '../model/nodes.js';
import { isPreference, PREFERENCE_KINDS } from '../model/preferences.js';
import { computeMustShareComponents } from '../normalize/computeMustShareComponents.js';

function createError(code, message, path) {
  return { level: 'error', code, message, path };
}

function buildNodeIndex(project) {
  return new Map(
    [...project.items, ...project.groups, ...project.containers, ...project.positions]
      .filter(isNode)
      .map((node) => [node.id, node]),
  );
}

function validateGroupInternalTogetherShortcut(entry, nodeIndex, path, kind, allowsAdjacency) {
  const errors = [];
  const shortcutGroup = entry?.metadata?.groupInternalTogether === true;

  if (!shortcutGroup) {
    return errors;
  }

  const leftNode = nodeIndex.get(entry.leftRef.id);
  const rightNode = nodeIndex.get(entry.rightRef.id);

  if (entry.leftRef.id !== entry.rightRef.id || entry.leftRef.kind !== NODE_KINDS.GROUP || entry.rightRef.kind !== NODE_KINDS.GROUP) {
    errors.push(createError('group-internal-shortcut-invalid-operands', `${kind} group-internal together shortcut must target the same Group on both sides.`, path));
  }

  if (leftNode?.kind !== NODE_KINDS.GROUP || rightNode?.kind !== NODE_KINDS.GROUP) {
    errors.push(createError('group-internal-shortcut-group-only', `${kind} group-internal together shortcut must target a Group.`, path));
  }

  if (!allowsAdjacency && ![CONSTRAINT_KINDS.MUST_SHARE_CONTAINER, PREFERENCE_KINDS.PREFER_SHARE_CONTAINER].includes(entry.kind)) {
    errors.push(createError('group-internal-shortcut-kind-unsupported', `${kind} group-internal shortcut currently supports together-in-container semantics only.`, `${path}.kind`));
  }

  return errors;
}

function validateConstraintRefs(project, nodeIndex) {
  const errors = [];
  const seenConstraints = new Set();

  project.constraints.forEach((constraint, index) => {
    const path = `constraints[${index}]`;

    if (!isConstraint(constraint)) {
      errors.push(createError('invalid-constraint-shape', `Invalid constraint shape at ${path}.`, path));
      return;
    }

    if (!nodeIndex.has(constraint.leftRef.id)) {
      errors.push(createError('unknown-constraint-left-ref', `Unknown left operand '${constraint.leftRef.id}'.`, `${path}.leftRef.id`));
    }

    if (!nodeIndex.has(constraint.rightRef.id)) {
      errors.push(createError('unknown-constraint-right-ref', `Unknown right operand '${constraint.rightRef.id}'.`, `${path}.rightRef.id`));
    }

    const leftNode = nodeIndex.get(constraint.leftRef.id);
    const rightNode = nodeIndex.get(constraint.rightRef.id);
    const symmetricKey = [constraint.kind, constraint.leftRef.id, constraint.rightRef.id].sort().join('::');

    errors.push(...validateGroupInternalTogetherShortcut(constraint, nodeIndex, path, 'Constraint', false));

    if (seenConstraints.has(symmetricKey)) {
      errors.push(createError('duplicate-constraint', `Duplicate constraint '${symmetricKey}'.`, path));
    }
    seenConstraints.add(symmetricKey);

    const usesAdjacency = [
      CONSTRAINT_KINDS.MUST_BE_ADJACENT,
      CONSTRAINT_KINDS.MUST_NOT_BE_ADJACENT,
    ].includes(constraint.kind);

    if (usesAdjacency && project.assignmentMode !== ASSIGNMENT_MODES.POSITION) {
      errors.push(
        createError(
          'adjacency-requires-position-mode',
          `Constraint '${constraint.kind}' requires position assignment mode.`,
          `${path}.kind`,
        ),
      );
    }

    if (usesAdjacency && leftNode && rightNode && (leftNode.kind !== NODE_KINDS.ITEM || rightNode.kind !== NODE_KINDS.ITEM)) {
      errors.push(createError('adjacency-items-only', `Adjacency constraints must target Item operands in MVP.`, path));
    }
  });

  return errors;
}

function validatePreferenceRefs(project, nodeIndex) {
  const errors = [];
  const seenPreferences = new Set();

  project.preferences.forEach((preference, index) => {
    const path = `preferences[${index}]`;

    if (!isPreference(preference)) {
      errors.push(createError('invalid-preference-shape', `Invalid preference shape at ${path}.`, path));
      return;
    }

    if (!nodeIndex.has(preference.leftRef.id)) {
      errors.push(createError('unknown-preference-left-ref', `Unknown left operand '${preference.leftRef.id}'.`, `${path}.leftRef.id`));
    }

    if (!nodeIndex.has(preference.rightRef.id)) {
      errors.push(createError('unknown-preference-right-ref', `Unknown right operand '${preference.rightRef.id}'.`, `${path}.rightRef.id`));
    }

    const leftNode = nodeIndex.get(preference.leftRef.id);
    const rightNode = nodeIndex.get(preference.rightRef.id);
    const symmetricKey = [preference.kind, preference.leftRef.id, preference.rightRef.id].sort().join('::');

    errors.push(...validateGroupInternalTogetherShortcut(preference, nodeIndex, path, 'Preference', false));
    const weightedKey = `${symmetricKey}::${preference.weight}`;

    if (seenPreferences.has(weightedKey)) {
      errors.push(createError('duplicate-preference', `Duplicate preference '${weightedKey}'.`, path));
    }
    seenPreferences.add(weightedKey);

    const usesAdjacency = [
      PREFERENCE_KINDS.PREFER_ADJACENT,
      PREFERENCE_KINDS.PREFER_NON_ADJACENT,
    ].includes(preference.kind);

    if (usesAdjacency && project.assignmentMode !== ASSIGNMENT_MODES.POSITION) {
      errors.push(
        createError(
          'adjacency-preference-requires-position-mode',
          `Preference '${preference.kind}' requires position assignment mode.`,
          `${path}.kind`,
        ),
      );
    }

    if (usesAdjacency && leftNode && rightNode && (leftNode.kind !== NODE_KINDS.ITEM || rightNode.kind !== NODE_KINDS.ITEM)) {
      errors.push(createError('adjacency-preferences-items-only', `Adjacency preferences must target Item operands in MVP.`, path));
    }
  });

  return errors;
}

function validateContradictions(project) {
  const errors = [];
  const mustShare = new Set();
  const mustNotShare = new Set();

  project.constraints.forEach((constraint, index) => {
    const key = [constraint.leftRef.id, constraint.rightRef.id].sort().join('::');

    if (constraint.kind === CONSTRAINT_KINDS.MUST_SHARE_CONTAINER) {
      mustShare.add(key);
    }

    if (constraint.kind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER) {
      mustNotShare.add(key);
    }

    if (constraint.leftRef.id === constraint.rightRef.id && constraint.kind === CONSTRAINT_KINDS.MUST_NOT_SHARE_CONTAINER) {
      errors.push(createError('self-contradiction-separation', `Entity '${constraint.leftRef.id}' cannot be required to avoid its own container.`, `constraints[${index}]`));
    }
  });

  mustShare.forEach((key) => {
    if (mustNotShare.has(key)) {
      errors.push(createError('direct-constraint-contradiction', `Conflicting mustShareContainer and mustNotShareContainer constraints for '${key}'.`, 'constraints'));
    }
  });

  return errors;
}

function validateMustShareCapacity(project, nodeIndex) {
  const errors = [];
  const components = computeMustShareComponents(project);
  const itemOnlyComponents = components.map((component) =>
    component.filter((id) => nodeIndex.get(id)?.kind === NODE_KINDS.ITEM),
  );
  const maxContainerCapacity = Math.max(
    0,
    ...project.containers.map((container) => {
      if (project.assignmentMode === ASSIGNMENT_MODES.POSITION) {
        return project.containments.filter((relation) => relation.from.id === container.id).length;
      }

      return container.metadata?.maxCapacity ?? Number.POSITIVE_INFINITY;
    }),
  );

  itemOnlyComponents.forEach((component, index) => {
    if (component.length > 0 && component.length > maxContainerCapacity) {
      errors.push(
        createError(
          'must-share-capacity-impossible',
          `Must-share component ${index + 1} with ${component.length} items exceeds every available container capacity.`,
          'constraints',
        ),
      );
    }
  });

  return errors;
}

export function validateConstraints(project) {
  const nodeIndex = buildNodeIndex(project);

  return [
    ...validateConstraintRefs(project, nodeIndex),
    ...validatePreferenceRefs(project, nodeIndex),
    ...validateContradictions(project),
    ...validateMustShareCapacity(project, nodeIndex),
  ];
}
