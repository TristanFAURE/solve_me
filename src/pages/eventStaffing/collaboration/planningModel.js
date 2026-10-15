import { COLLABORATION_ROOT, validateCollaborationManifest } from './collaborationManifest.js';
import { normalizeCollaborationEmail } from './responseModel.js';

export const COLLABORATION_PLANNING_VERSION = 1;
export const COLLABORATION_PLANNING_FILE = 'planning.enc.json';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDestinationId(value) {
  const match = /^event:(.*)::group:(.*)$/.exec(value ?? '') ?? /^event__(.*)__group__(.*)$/.exec(value ?? '');
  return match ? { slotId: match[1], groupTypeId: match[2] } : null;
}

export function collaborationPlanningPath(folder) {
  return `${COLLABORATION_ROOT}/${folder}/${COLLABORATION_PLANNING_FILE}`;
}

export function createCollaborationPlanning(project, manifest, solverResult, solutionIndex = 0, options = {}) {
  validateCollaborationManifest(manifest);
  if (!Array.isArray(solverResult?.solutions) || solverResult.solutions.length === 0) {
    throw new Error('A selected staffing solution is required before saving the planning.');
  }
  const index = Math.min(Math.max(Number.isInteger(solutionIndex) ? solutionIndex : 0, 0), solverResult.solutions.length - 1);
  const solution = solverResult.solutions[index];
  const people = new Map((project?.people ?? []).map((person) => [person.id, person]));
  const slots = new Map((project?.events ?? []).map((slot) => [slot.id, slot]));
  const groups = new Map((project?.groupTypes ?? []).map((group) => [group.id, group]));
  const assignments = (solution.assignments ?? []).map((assignment) => {
    const person = people.get(assignment?.itemRef?.id);
    const destination = parseDestinationId(assignment?.containerRef?.id);
    const slot = slots.get(destination?.slotId);
    const group = groups.get(destination?.groupTypeId);
    const email = normalizeCollaborationEmail(person?.email);
    if (!person || !email || !destination || !slot || !group) {
      throw new Error('The selected solution contains an assignment that cannot be delivered to a participant.');
    }
    return {
      email,
      dateKey: text(slot.dateKey ?? slot.date),
      slotId: slot.id,
      slotLabel: text(slot.slotLabel ?? slot.label ?? slot.id),
      groupTypeId: group.id,
      groupTypeLabel: text(group.label ?? group.name ?? group.id),
      orderIndex: Number.isInteger(slot.orderIndex) ? slot.orderIndex : Number.MAX_SAFE_INTEGER,
    };
  }).sort((left, right) => left.orderIndex - right.orderIndex
    || left.email.localeCompare(right.email)
    || left.groupTypeId.localeCompare(right.groupTypeId))
    .map(({ orderIndex: _orderIndex, ...assignment }) => assignment);

  return validateCollaborationPlanning({
    version: COLLABORATION_PLANNING_VERSION,
    sessionId: manifest.sessionId,
    manifestRevision: manifest.revision,
    solutionNumber: index + 1,
    savedAt: options.savedAt ?? new Date().toISOString(),
    assignments,
  });
}

export function validateCollaborationPlanning(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid collaboration planning.');
  if (value.version !== COLLABORATION_PLANNING_VERSION) throw new Error('Unsupported collaboration planning version.');
  if (!text(value.sessionId) || text(value.sessionId).length > 200) throw new Error('Collaboration planning session is invalid.');
  if (!Number.isInteger(value.manifestRevision) || value.manifestRevision < 1) throw new Error('Collaboration planning revision is invalid.');
  if (!Number.isInteger(value.solutionNumber) || value.solutionNumber < 1) throw new Error('Collaboration planning solution number is invalid.');
  if (!text(value.savedAt) || Number.isNaN(Date.parse(value.savedAt))) throw new Error('Collaboration planning savedAt is invalid.');
  if (!Array.isArray(value.assignments) || value.assignments.length > 100000) throw new Error('Collaboration planning assignments are invalid.');
  const assignments = value.assignments.map((assignment) => {
    const email = normalizeCollaborationEmail(assignment?.email);
    const fields = ['dateKey', 'slotId', 'slotLabel', 'groupTypeId', 'groupTypeLabel'];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
      || fields.some((field) => !text(assignment?.[field]) || text(assignment[field]).length > 500)) {
      throw new Error('Collaboration planning contains an invalid assignment.');
    }
    return { email, ...Object.fromEntries(fields.map((field) => [field, text(assignment[field])])) };
  });
  return {
    version: COLLABORATION_PLANNING_VERSION,
    sessionId: text(value.sessionId),
    manifestRevision: value.manifestRevision,
    solutionNumber: value.solutionNumber,
    savedAt: text(value.savedAt),
    assignments,
  };
}

export function selectParticipantPlanning(planning, manifest, email) {
  validateCollaborationManifest(manifest);
  const valid = validateCollaborationPlanning(planning);
  if (valid.sessionId !== manifest.sessionId || valid.manifestRevision !== manifest.revision) return null;
  const normalizedEmail = normalizeCollaborationEmail(email);
  return {
    savedAt: valid.savedAt,
    solutionNumber: valid.solutionNumber,
    assignments: valid.assignments.filter((assignment) => assignment.email === normalizedEmail)
      .map(({ email: _email, ...assignment }) => assignment),
  };
}
