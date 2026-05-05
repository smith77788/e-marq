---
name: Audit log
description: Immutable audit_log table populated by SECURITY DEFINER triggers on decision_queue, tenant_integrations, tenant_memberships, user_roles
type: feature
---
public.audit_log: bigserial id, actor_user_id (auth.uid() at trigger time), tenant_id, entity_type, entity_id, action (insert/update/delete), before+after JSONB snapshots, created_at.

Triggers attached AFTER INSERT/UPDATE/DELETE on:
- decision_queue
- tenant_integrations
- tenant_memberships
- user_roles

Trigger function `_audit_log_capture(entity_type)` is SECURITY DEFINER, skips no-op updates (before=after), reads tenant_id and id from row JSONB.

RLS:
- super_admin reads everything
- tenant owner/admin reads only own tenant rows
- ALL writes blocked from clients (only triggers can insert)

UI: /admin/audit-log — read-only stream, фільтр по entity_type + free-text search.

Memory note: this is the GDPR-readiness foundation. Future work: hash chain (each row's hash includes prev row's hash) for tamper-evidence + append-only enforcement at storage level.
