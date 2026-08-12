import { createConstraint } from '../model/constraints.js';
import { createPreference } from '../model/preferences.js';
import { NODE_KINDS } from '../model/nodes.js';

function isGroupInternalTogetherShortcut(entry) {
  return Boolean(entry?.metadata?.groupInternalTogether === true);
}

function buildNodeIndex(project) {
  return new Map(
    [...project.items, ...project.groups, ...project.containers, ...project.positions].map((node) => [node.id, node]),
  );
}

function buildGroupMembersMap(project, nodeIndex) {
  const groupMembers = new Map();

  project.groups.forEach((group) => {
    groupMembers.set(group.id, []);
  });

  project.containments.forEach((relation) => {
    const fromNode = nodeIndex.get(relation.from.id);
    const toNode = nodeIndex.get(relation.to.id);

    if (fromNode?.kind === NODE_KINDS.GROUP && toNode?.kind === NODE_KINDS.ITEM) {
      const members = groupMembers.get(fromNode.id) ?? [];
      members.push(toNode);
      groupMembers.set(fromNode.id, members);
    }
  });

  return groupMembers;
}

function expandOperand(ref, nodeIndex, groupMembersMap) {
  const node = nodeIndex.get(ref.id);

  if (!node) {
    return [];
  }

  if (node.kind === NODE_KINDS.GROUP) {
    return (groupMembersMap.get(node.id) ?? []).map((member) => ({ kind: member.kind, id: member.id }));
  }

  return [{ kind: node.kind, id: node.id }];
}

export function expandGroupRelations(project) {
  const nodeIndex = buildNodeIndex(project);
  const groupMembersMap = buildGroupMembersMap(project, nodeIndex);

  const expandedConstraints = [];
  project.constraints.forEach((constraint) => {
    if (isGroupInternalTogetherShortcut(constraint)) {
      const members = expandOperand(constraint.leftRef, nodeIndex, groupMembersMap);
      members.forEach((leftRef, leftIndex) => {
        members.slice(leftIndex + 1).forEach((rightRef) => {
          expandedConstraints.push(createConstraint({
            kind: constraint.kind,
            leftRef,
            rightRef,
            metadata: {
              ...constraint.metadata,
              derivedFromGroupRelation: true,
              derivedFromGroupInternalTogether: true,
            },
          }));
        });
      });
      return;
    }

    const leftRefs = expandOperand(constraint.leftRef, nodeIndex, groupMembersMap);
    const rightRefs = expandOperand(constraint.rightRef, nodeIndex, groupMembersMap);

    leftRefs.forEach((leftRef) => {
      rightRefs.forEach((rightRef) => {
        expandedConstraints.push(createConstraint({
          kind: constraint.kind,
          leftRef,
          rightRef,
          metadata: {
            ...constraint.metadata,
            derivedFromGroupRelation: leftRef.id !== constraint.leftRef.id || rightRef.id !== constraint.rightRef.id,
          },
        }));
      });
    });
  });

  const expandedPreferences = [];
  project.preferences.forEach((preference) => {
    if (isGroupInternalTogetherShortcut(preference)) {
      const members = expandOperand(preference.leftRef, nodeIndex, groupMembersMap);
      members.forEach((leftRef, leftIndex) => {
        members.slice(leftIndex + 1).forEach((rightRef) => {
          expandedPreferences.push(createPreference({
            kind: preference.kind,
            leftRef,
            rightRef,
            weight: preference.weight,
            metadata: {
              ...preference.metadata,
              derivedFromGroupRelation: true,
              derivedFromGroupInternalTogether: true,
            },
          }));
        });
      });
      return;
    }

    const leftRefs = expandOperand(preference.leftRef, nodeIndex, groupMembersMap);
    const rightRefs = expandOperand(preference.rightRef, nodeIndex, groupMembersMap);

    leftRefs.forEach((leftRef) => {
      rightRefs.forEach((rightRef) => {
        expandedPreferences.push(createPreference({
          kind: preference.kind,
          leftRef,
          rightRef,
          weight: preference.weight,
          metadata: {
            ...preference.metadata,
            derivedFromGroupRelation: leftRef.id !== preference.leftRef.id || rightRef.id !== preference.rightRef.id,
          },
        }));
      });
    });
  });

  return {
    ...project,
    constraints: expandedConstraints,
    preferences: expandedPreferences,
  };
}
