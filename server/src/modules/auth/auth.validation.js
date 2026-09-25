const { z } = require('zod');

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // Optional workspace to sign in to. Omitted = the user's earliest active
  // membership, exactly as before (so existing clients keep working).
  org_slug: z.string().trim().toLowerCase().min(1).max(80).optional(),
});

const workspaceParamSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
});

const switchOrgSchema = z.object({
  org_id: z.string().uuid(),
});

module.exports = { loginSchema, refreshSchema, changePasswordSchema, switchOrgSchema, workspaceParamSchema };
