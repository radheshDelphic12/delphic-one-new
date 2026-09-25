/**
 * Return an error string when value is empty, otherwise null.
 */
export function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return `${label} is required.`;
  }
  return null;
}

/**
 * Run field checks and return validation results for forms.
 *
 * Args:
 *   checks: [fieldName, errorMessage | null][]
 */
export function runValidations(checks) {
  const fieldErrors = {};
  const messages = [];

  for (const [field, message] of checks) {
    if (!message) continue;
    fieldErrors[field] = message;
    messages.push(message);
  }

  return {
    valid: messages.length === 0,
    fieldErrors,
    messages,
  };
}

/** Tailwind classes for an input that failed validation. */
export function fieldErrorClass(fieldErrors, fieldName, baseClass = '') {
  const invalid = Boolean(fieldErrors?.[fieldName]);
  return `${baseClass} ${invalid ? 'border-danger-300 ring-1 ring-danger-100' : ''}`.trim();
}
