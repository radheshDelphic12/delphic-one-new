# Deleting customers (soft) and the Delphic One Team

Branch `saas-launch-platform`. Nothing here deletes anything from the database.

## 1. Delete a customer (soft delete) and restore it

**Who:** only a group super admin of our own (owner) group. Not a platform admin, not a Delphic One admin, not a super admin of a customer group. The server checks this; everyone else does not see the buttons.

**What "Delete" does.** The data is KEPT. A delete only marks and switches off:

| Case | What changes |
|------|--------------|
| Customer with no workspace (only a Delphic One record) | The customer is marked deleted (when, by whom, why). It disappears from Customers, the totals, Invoices and the collection follow-ups. Its invoices stay in the database, hidden. |
| Customer with a workspace | The same, plus: the customer status becomes "deleted", the customer's company becomes inactive, and the users who belong ONLY to that customer are switched off (they cannot sign in or refresh, and a session they already had stops at once). Everything else stays in the database, hidden from our reports and from other customers. |

**What it never does:** touch our own group or companies; touch a user who also works in another company, is a super admin, a group super admin or a platform admin (such a user blocks the delete and is listed on the screen); remove a row or a file; free the customer's login email (it stays reserved, and creating a workspace with it says so).

**Steps for the owner (Delphic One > Customers):**
1. Open the customer's row and click **Delete**.
2. The screen shows a preview (nothing has changed yet): what will be hidden, how many records, which users will be switched off.
3. Type the customer's exact company name, optionally a reason, and confirm. The preview expires after 10 minutes and goes stale if anything it counted changes.
4. The customer is gone from the lists. A line is added to the audit trail (Platform > Audit trail) and a deletion record keeps exactly what was changed.

**Restore:** Delphic One > Customers > Status filter **Deleted** (visible to super admins only) > **Restore**. Same preview and typed-name confirmation. A restore switches back on exactly what the delete switched off (the same users, the same company status, the previous customer status) and the customer shows in the lists again.

Platform > Customers has the same **Delete** for customers with a workspace.

## 2. Delphic One > Team

**Who:** the Delphic One admin role (a new capability, `team`). Sales and BDA do not see it.

**What it does:** lists the people of the Delphic One company with role and status; **Add person** (name, email, role admin / sales / bda, phone) with a one-time first password shown once (or a password you choose); change a role; deactivate and reactivate. It uses the same user service as People > Users, so the same rules and audit apply, and it only ever touches members of the Delphic One company.

**Rules worth knowing:**
- An email that already has a login anywhere (this company or another) is refused, exactly like People > Users. Existing people are not attached to another company.
- A person who also works in another company, and super admins, are shown but not edited from here.
- You cannot change your own role or switch yourself off, and the last active admin cannot be demoted or switched off.
