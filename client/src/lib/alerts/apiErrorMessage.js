/**
 * Extract a human-readable message from an API error response.
 */
export function apiErrorMessage(error, fallback) {
  const response = error?.response?.data;
  const validationMessage = response?.errors?.[0]?.message;
  return validationMessage || response?.message || fallback;
}

/**
 * Collect every validation message from a Zod-style errors array.
 */
export function apiValidationMessages(error) {
  const errors = error?.response?.data?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return [];
  return errors.map((entry) => entry.message).filter(Boolean);
}
