import { userCan } from '../../lib/permissions.js';

export const ACCOUNT_TRANSITIONS = {
  lead: ['meeting_scheduled'],
  meeting_scheduled: ['active', 'rescheduled', 'dropped'],
  rescheduled: ['meeting_scheduled', 'dropped'],
  active: ['dropped'],
  dropped: [],
};

// Every stage, for the superadmin override drawer (backward moves + straight to lead).
export const ACCOUNT_ALL_STAGES = ['lead', 'meeting_scheduled', 'active', 'rescheduled', 'dropped'];

export function canOverrideStage(user) {
  return Boolean(user?.is_superadmin);
}

export function canEditBroughtBy(user) {
  return userCan(user, 'editBroughtBy');
}

export function formatAccountValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replace(/_/g, ' ');
}

export function accountKey(id) {
  return `ACC-${String(id || '').slice(0, 8).toUpperCase()}`;
}

export function canCreateAccount(user) {
  return user?.role === 'bda' || user?.role === 'admin';
}

export function canMutateAccount(account, user) {
  if (!account || !user) return false;
  // Admin and BDA may edit any account and schedule / move meeting stages.
  return user.role === 'admin' || user.role === 'bda';
}

export function canClassifyAccount(account, user) {
  return canMutateAccount(account, user) && account?.type == null;
}

export { apiErrorMessage } from '../../lib/alerts/apiErrorMessage.js';

export const EMPTY_CONTACT = { name: '', email: '', phone: '', designation: '', role_label: '' };

export const EMPTY_FORM = {
  type: '',
  name: '',
  owner_id: '',
  origin_owner_id: '',
  industry: '',
  company_size: '',
  website: '',
  location_city: '',
  location_country: '',
  gst_or_tax_id: '',
  location: '',
  linkedin_url: '',
  poc_name: '',
  poc_email: '',
  poc_phone: '',
  poc_designation: '',
  additional_contacts: [{ ...EMPTY_CONTACT }],
  source: '',
  vendor_specializations: '',
  vendor_rate_min: '',
  vendor_rate_max: '',
  vendor_rate_currency: 'INR',
  vendor_payment_terms: '',
  vendor_agreement_url: '',
  client_billing_currency: 'INR',
  client_payment_terms: '',
  client_agreement_url: '',
  budget_amount: '',
};

function optionalEnum(value) {
  return value || undefined;
}

/** Trim tolerant of null/undefined/number field values loaded from the API. */
export function str(value) {
  return value == null ? '' : String(value).trim();
}

function sanitizeContact(contact) {
  return Object.fromEntries(
    Object.entries(contact || {}).map(([key, value]) => [key, value == null ? '' : value])
  );
}

/**
 * Shape an account API row into the edit-form state. The API returns unset optional
 * columns as null; a bare `...account` spread would clobber the '' defaults with null,
 * and buildAccountBody() would then call .trim() on null — the crash behind a generic
 * "Failed to update account" toast. Every text field is coerced back to a string here.
 */
export function formFromAccount(account) {
  const contacts = Array.isArray(account.additional_contacts) ? account.additional_contacts : [];
  const rateRange = account.vendor_rate_range || {};
  const merged = {
    ...EMPTY_FORM,
    ...account,
    type: account.type || '',
    owner_id: account.owner?.id || '',
    origin_owner_id: account.origin_owner?.id || '',
    additional_contacts: contacts.length
      ? contacts.map((contact) => ({ ...EMPTY_CONTACT, ...sanitizeContact(contact) }))
      : [{ ...EMPTY_CONTACT }],
    vendor_specializations: (account.vendor_specializations || []).join(', '),
    vendor_rate_min: rateRange.min ?? '',
    vendor_rate_max: rateRange.max ?? '',
    vendor_rate_currency: rateRange.currency || 'INR',
    client_billing_currency: account.client_billing_currency || 'INR',
    budget_amount: account.budget_amount != null ? String(account.budget_amount) : '',
  };
  Object.keys(EMPTY_FORM).forEach((key) => {
    if (typeof EMPTY_FORM[key] === 'string' && typeof merged[key] !== 'string') {
      merged[key] = merged[key] == null ? '' : String(merged[key]);
    }
  });
  return merged;
}

/** Build the PATCH/POST body from edit-form state. Null-safe on every field. */
export function buildAccountBody(form, isEditing, canEditType, canEditOriginOwner) {
  const body = {
    name: str(form.name),
    industry: str(form.industry),
    company_size: optionalEnum(form.company_size),
    website: str(form.website),
    location_city: str(form.location_city),
    location_country: str(form.location_country),
    gst_or_tax_id: str(form.gst_or_tax_id),
    location: str(form.location),
    linkedin_url: str(form.linkedin_url),
    poc_name: str(form.poc_name),
    poc_email: str(form.poc_email),
    poc_phone: str(form.poc_phone),
    poc_designation: str(form.poc_designation),
    additional_contacts: form.additional_contacts
      .map((contact) => Object.fromEntries(Object.entries(contact).map(([key, value]) => [key, str(value)])))
      .filter((contact) => contact.name),
    source: str(form.source),
  };

  if (form.type && (!isEditing || canEditType)) body.type = form.type;
  if (isEditing && form.owner_id) body.owner_id = form.owner_id;
  if (isEditing && canEditOriginOwner && form.origin_owner_id) body.origin_owner_id = form.origin_owner_id;

  if (form.type === 'vendor') {
    body.vendor_specializations = str(form.vendor_specializations).split(',').map((value) => value.trim()).filter(Boolean);
    body.vendor_payment_terms = str(form.vendor_payment_terms);
    body.vendor_agreement_url = str(form.vendor_agreement_url);
    if (form.vendor_rate_min !== '' && form.vendor_rate_max !== '') {
      body.vendor_rate_range = {
        min: Number(form.vendor_rate_min),
        max: Number(form.vendor_rate_max),
        currency: form.vendor_rate_currency,
      };
    }
  } else {
    body.client_billing_currency = form.client_billing_currency;
    body.client_payment_terms = str(form.client_payment_terms);
    body.client_agreement_url = str(form.client_agreement_url);
    body.budget_amount = form.budget_amount !== '' ? Number(form.budget_amount) : null;
  }

  return body;
}
