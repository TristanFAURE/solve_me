export const UNSUPPORTED_GENERAL_PREFERENCES_COPY = 'The active solver does not support general relation preferences. Existing preferences remain available below for audit and removal.';

export function getGeneralPreferenceAuthoringPolicy(capabilities) {
  const supported = capabilities?.softPreferences === true;
  return {
    supported,
    disabled: !supported,
    message: supported ? '' : UNSUPPORTED_GENERAL_PREFERENCES_COPY,
  };
}
