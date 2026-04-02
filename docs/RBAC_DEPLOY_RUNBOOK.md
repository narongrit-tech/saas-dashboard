# Settings RBAC Deployment Runbook

## Purpose

Close the remaining Settings RBAC deployment blocker by executing the hardened database changes, auditing historical RBAC data, remediating any unsafe historical rows, re-auditing, and only then entering manual QA.

This runbook is based on:

- `docs/RBAC_HARDENING_PLAN.md`
- `docs/RBAC_HARDENING_IMPLEMENTED.md`
- `docs/RBAC_DB_HARDENING_NOTES.md`
- `docs/RBAC_HISTORICAL_DATA_AUDIT.md`
- `docs/RBAC_HISTORICAL_REMEDIATION_PLAN.md`
- `docs/RBAC_MANUAL_QA_CHECKLIST.md`
- `database-scripts/migration-083-settings-bootstrap-owner.sql`
- `database-scripts/migration-084-settings-rbac-db-hardening.sql`
- `database-scripts/migration-085-settings-bootstrap-trust-gate.sql`
- `database-scripts/rbac_historical_audit.sql`

## Strict Rules

- Do not modify app code as part of this runbook.
- Do not invent cleanup SQL on the fly.
- Do not run blanket deletes against `roles`, `role_permissions`, or `user_role_assignments`.
- Do not enter QA or staging sign-off while any mandatory audit bucket is non-zero.
- Treat any active suspicious assignment or namespace mismatch as an immediate stop condition.

## Phase 0: Preconditions

Complete these checks before touching the target database:

1. Confirm the matching hardened Settings RBAC app deployment is the one intended for this database.
2. Confirm `SUPABASE_SERVICE_ROLE_KEY` is configured for that deployment.
3. Confirm migration `077` already exists in the target database.
4. Confirm the operator has access to:
   - the SQL editor for the target database
   - `settings_audit_logs`
   - the Settings UI for manual QA
5. Confirm three QA accounts are available:
   - `owner_user`
   - `delegated_admin_user`
   - `outsider_user`
6. Confirm `owner_user` can be added to `settings_bootstrap_allowlist` for QA bootstrap testing.

Stop here if any precondition is not met.

## Phase 1: Exact Migration Order

Run the database migrations in this exact order:

1. `database-scripts/migration-077-settings-module.sql`
2. `database-scripts/migration-083-settings-bootstrap-owner.sql`
3. `database-scripts/migration-084-settings-rbac-db-hardening.sql`
4. `database-scripts/migration-085-settings-bootstrap-trust-gate.sql`

Execution rules:

- If `077` is already applied in the target database, verify it is present and continue with `083`.
- Do not run `084` before `083`.
- Do not run `085` before `084`.
- Run each migration as its own reviewed step and confirm it finishes without SQL errors before continuing.

Expected outcome after migrations:

- bootstrap seeding assigns the seeded user to `owner`
- authenticated raw writes to `roles`, `role_permissions`, and `user_role_assignments` are blocked
- trusted seeded system roles carry `system_role_key`
- namespace guard triggers are active
- first-owner bootstrap is allowlist-gated and disabled after the first namespace exists

If any migration fails, stop. Do not continue to the audit.

## Phase 2: Exact Audit Execution Order

Run `database-scripts/rbac_historical_audit.sql` only after `077`, `083`, `084`, and `085` are in place.

Use this exact execution order:

1. Run Query 0 only and record all summary counts.
2. If Query 0 returns all zeros, skip to Phase 6.
3. If any Query 0 bucket is non-zero, run the detail queries in this order:
   - Query 7: active suspicious assignments
   - Query 5: `role_permissions` namespace mismatches
   - Query 6: `user_role_assignments` namespace mismatches
   - Query 1: reserved-name roles without trusted keys
   - Query 2: invalid `is_system` role metadata
   - Query 3: custom Settings-privileged roles needing provenance review
   - Query 4: suspicious self-assignment chains

Review order is not optional. It matches the documented triage priority:

1. active suspicious assignments
2. namespace mismatch rows
3. reserved-name and system-role metadata anomalies
4. custom Settings-privileged roles lacking trusted provenance

## Phase 3: Mandatory Zero Buckets Before QA Or Staging

These Query 0 summary buckets must all be `0` before manual QA or staging sign-off:

| Query 0 bucket | Required value |
|---|---|
| `active_suspicious_assignments` | `0` |
| `role_permission_namespace_mismatches` | `0` |
| `user_role_assignment_namespace_mismatches` | `0` |
| `reserved_name_roles_without_trusted_key` | `0` |
| `system_roles_with_invalid_metadata` | `0` |
| `custom_settings_roles_needing_review` | `0` |
| `suspicious_self_assignment_chains` | `0` |

Strict interpretation:

- Do not waive a non-zero bucket for QA.
- Do not treat Query 3 or Query 4 as informational-only.
- In a shared environment, the zero requirement is for the target database, not only for one user.

## Phase 4: What To Do If Findings Are Non-Zero

If any mandatory bucket is non-zero:

1. Stop QA entry.
2. Export the Query 0 summary and every non-empty detail result set.
3. Record:
   - namespace owner id
   - role ids
   - assignment ids
   - affected user ids
   - current Settings permission keys
4. Export matching `settings_audit_logs` rows for the affected role ids and assignment ids.
5. Triage each affected namespace before making changes.

Do not delete or edit suspicious rows in place before evidence capture.

## Phase 5: Manual Remediation Sequence

Remediate per affected namespace in this exact order.

### Step 1: Capture Evidence

- Save the Query 7, 5, 6, 1, 2, 3, and 4 outputs for the affected namespace.
- Preserve matching `settings_audit_logs` rows.
- Record the intended legitimate owner and intended legitimate managers out of band.

### Step 2: Contain Live Access Risk

If Query 7 returns rows:

1. Identify which assignment is currently active for the user.
2. Decide whether that user should keep Settings access.
3. If the user should keep access, prepare the clean replacement role first.
4. If the user should not keep access, remove or replace the suspicious assignment through a reviewed trusted path.

Do not start with old historical rows that are not active. Contain the active assignment first.

### Step 3: Restore Trusted Seeded System Roles

For namespaces missing a trusted `owner` role or showing reserved-name/system-role anomalies:

1. Confirm the intended namespace owner.
2. Re-run `seed_default_roles_for_user(namespace_owner_id)` for that namespace.
3. Verify the namespace now has:
   - `owner`
   - `admin`
   - `operator`
   - `viewer`
4. Verify each seeded system role has:
   - `is_system = true`
   - matching `system_role_key`
5. Verify the intended owner has a trusted `owner` assignment in that namespace.

If reseed cannot be executed through the trusted path, stop and escalate as a manual DBA recovery case. Do not improvise direct SQL privilege repair.

### Step 4: Replace Suspicious Custom Privileged Roles

For each Query 3 row:

1. Create a new clean custom role through the hardened Settings UI flow.
2. Grant only the explicitly approved permissions through the hardened permission editor.
3. Compare the new role's permissions to the suspicious role before reassigning users.
4. Reassign intended users from the suspicious role to the clean replacement role through the hardened assignment flow.

Do not copy suspicious permissions forward without explicit review.

### Step 5: Recreate Namespace-Mismatch Rows Through Trusted Paths

For each Query 5 or Query 6 row:

1. Treat the mismatched row as non-canonical.
2. Recreate the intended permission grant or role assignment through the trusted app or service-backed path so `created_by` matches `roles.created_by`.
3. Verify the clean replacement row exists and behaves correctly.
4. Only then decide, under a reviewed controlled change, whether the mismatched historical row should be removed.

Do not leave live access dependent on a namespace-mismatched row.

### Step 6: Resolve Suspicious Self-Assignment Chains

For each Query 4 row:

1. Determine whether the namespace is a legitimate owner namespace or a historical self-minted namespace.
2. If legitimate, move the user onto a trusted seeded role or a reviewed clean custom role.
3. If not legitimate, remove the suspicious assignment only after the intended access state is explicitly decided.

### Step 7: Repeat Until Clean

After each namespace repair:

1. Re-run Query 0.
2. Re-run Queries 7, 5, 6, 1, 2, 3, and 4 for that namespace.
3. Confirm the namespace no longer contributes to any non-zero summary bucket.

Remain in remediation until all mandatory buckets are zero for the target database.

## Phase 6: Post-Remediation Re-Audit Sequence

Once remediation is complete, run the audit again in this exact order:

1. Query 0 summary
2. Query 7 active suspicious assignments
3. Query 5 role-permission namespace mismatches
4. Query 6 assignment namespace mismatches
5. Query 1 reserved-name role anomalies
6. Query 2 system-role metadata anomalies
7. Query 3 custom privileged roles needing review
8. Query 4 suspicious self-assignment chains

Required result:

- every Query 0 bucket is `0`
- every detail query returns no unresolved rows

If not, return to Phase 5.

## Phase 7: Manual QA Entry Criteria

Manual QA may begin only when all of the following are true:

1. The matching hardened app deployment is live for the target database.
2. Migrations `077`, `083`, `084`, and `085` are applied successfully.
3. Every mandatory Query 0 bucket is `0`.
4. No active suspicious assignment remains.
5. No namespace mismatch row remains in live use.
6. `owner_user` is allowlisted for bootstrap QA.
7. `delegated_admin_user` and `outsider_user` are ready for QA.
8. The team is prepared to inspect DB state between QA sections.

Do not start QA if any entry criterion is false.

## Phase 8: Manual QA Sequence

Use `docs/RBAC_MANUAL_QA_CHECKLIST.md` in this order:

1. Bootstrap owner
2. Delegated admin
3. Non-privileged user denial
4. Assign/remove role protections
5. Role permission protections
6. Users page visibility
7. Negative privilege-escalation regression
8. Rollback smoke checks

QA pass conditions:

- bootstrap works only for the explicit allowlisted first owner
- owner assignment is created atomically on bootstrap
- delegated admins operate inside the owner namespace only
- outsiders cannot self-bootstrap, mutate RBAC data, or read protected user-directory data
- direct authenticated SQL privilege minting is blocked
- owner/admin assignment protections hold
- no misleading audit-success rows are created for denied actions

If any QA case fails, stop. Do not promote the database.

## Rollback Cautions

- App rollback is safer than database rollback.
- Do not roll back `migration-084-settings-rbac-db-hardening.sql` unless an equivalent replacement is already active. Rolling it back reopens direct authenticated writes to privilege-bearing RBAC tables.
- Do not roll back `migration-085-settings-bootstrap-trust-gate.sql` unless an equivalent trusted bootstrap gate is already active. Rolling it back reopens authenticated first-owner self-bootstrap.
- Do not roll back `migration-083-settings-bootstrap-owner.sql` casually. Removing it can reintroduce bootstrap inconsistency.
- Do not delete additive `system_role_key` data or owner-assignment rows under pressure.
- Do not make emergency manual edits that break the namespace rule `created_by = roles.created_by` for `role_permissions` or `user_role_assignments`.

## Final Go/No-Go Gate

`GO` only if every statement below is true:

1. Migrations ran in the exact order `077 -> 083 -> 084 -> 085`.
2. `rbac_historical_audit.sql` was run after the migrations.
3. Every Query 0 summary bucket is `0`.
4. No detail-query row remains unresolved.
5. Manual remediation, if needed, was completed through reviewed trusted paths.
6. Manual QA passed end to end.
7. Rollback cautions were reviewed and accepted.

If any one item above is false, the decision is `NO-GO`.
