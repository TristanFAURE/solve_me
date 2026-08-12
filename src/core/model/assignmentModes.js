export const ASSIGNMENT_MODES = {
  CONTAINER: 'container',
  POSITION: 'position',
};

export function isAssignmentMode(value) {
  return Object.values(ASSIGNMENT_MODES).includes(value);
}
