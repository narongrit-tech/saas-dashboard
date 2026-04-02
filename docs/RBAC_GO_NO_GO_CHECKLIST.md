# Settings RBAC Go / No-Go Checklist

Use this checklist as the short-form decision gate for the target database.

## 1. Migration Gate

- [ ] Matching hardened Settings RBAC app deployment is the one intended for this database.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is configured for that deployment.
- [ ] Migration `077` is already present or was applied first.
- [ ] Migration `083` was applied after `077`.
- [ ] Migration `084` was applied after `083`.
- [ ] Migration `085` was applied after `084`.
- [ ] No migration step failed or was skipped.

## 2. Audit Gate

- [ ] `database-scripts/rbac_historical_audit.sql` was run after migrations `077`, `083`, `084`, and `085`.
- [ ] Query 0 summary was recorded.
- [ ] If Query 0 had any non-zero bucket, the detail queries were reviewed in this order:
  Query 7, Query 5, Query 6, Query 1, Query 2, Query 3, Query 4.

## 3. Mandatory Zero Buckets

All of these must be `0` before QA, staging sign-off, or production go-live:

- [ ] `active_suspicious_assignments = 0`
- [ ] `role_permission_namespace_mismatches = 0`
- [ ] `user_role_assignment_namespace_mismatches = 0`
- [ ] `reserved_name_roles_without_trusted_key = 0`
- [ ] `system_roles_with_invalid_metadata = 0`
- [ ] `custom_settings_roles_needing_review = 0`
- [ ] `suspicious_self_assignment_chains = 0`

If any one bucket is non-zero, the decision is automatically `NO-GO`.

## 4. Remediation Gate

- [ ] Evidence was captured before any remediation work.
- [ ] Active suspicious assignments were contained first.
- [ ] Trusted seeded system roles were restored where required.
- [ ] Suspicious custom privileged roles were replaced with clean reviewed roles where required.
- [ ] Namespace-mismatch rows were recreated through trusted paths before any removal decision.
- [ ] Suspicious self-assignment chains were explicitly reviewed and resolved.
- [ ] Post-remediation audit was re-run.
- [ ] Post-remediation Query 0 summary returned all zeros.

## 5. QA Entry Gate

- [ ] `owner_user`, `delegated_admin_user`, and `outsider_user` are available.
- [ ] `owner_user` was allowlisted for bootstrap QA.
- [ ] No active suspicious assignment remains.
- [ ] No namespace mismatch row remains in live use.
- [ ] The team is ready to inspect DB state during QA.

If any QA entry item is false, do not start manual QA.

## 6. Manual QA Gate

- [ ] Bootstrap owner flow passed.
- [ ] Delegated admin flow passed.
- [ ] Non-privileged user denial flow passed.
- [ ] Assign/remove protections passed.
- [ ] Role permission protections passed.
- [ ] Users page visibility and data-exposure checks passed.
- [ ] Negative privilege-escalation regression checks passed.
- [ ] Rollback smoke checks passed.

## 7. Rollback Risk Gate

- [ ] The team accepts that app rollback is safer than DB rollback.
- [ ] The team accepts that rolling back `084` reopens raw authenticated RBAC writes unless equivalent protection already exists.
- [ ] The team accepts that rolling back `085` reopens authenticated first-owner self-bootstrap unless equivalent protection already exists.
- [ ] The team accepts that rolling back `083` can reintroduce bootstrap inconsistency.
- [ ] No rollback plan depends on deleting owner assignments or `system_role_key` data under pressure.

## Final Decision

- [ ] `GO`: every item in sections 1 through 7 is checked.
- [ ] `NO-GO`: any item in sections 1 through 7 is unchecked.
