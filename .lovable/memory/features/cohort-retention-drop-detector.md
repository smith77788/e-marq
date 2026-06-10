---
name: Cohort Retention Drop Detector
description: SQL agent #23, daily 04:15, порівнює m1/m3 retention свіжих когорт з медіаною попередніх 6, drop≥30% → cohort_retention_drop owner_review
type: feature
---

## Що робить

Pure-SQL daily агент над customer_cohorts.retention_curve. Для кожної когорти від 6 до 1 місяця тому (n≥20) рахує медіану m1/m3 попередніх 6 когорт (n≥10) того ж тенанта і ловить падіння.

## Пороги

- M1 drop ≥ 30% АБО M3 drop ≥ 40% → emit
- Severity: high якщо M1≥50% або M3≥55%, інакше medium
- Action: `owner_review` (manual-by-design)
- Skip pilot tenants
- Dedup: per (tenant, cohort_month), 30d window
- dedup_bucket = md5(...)::bit(60)::bigint

## Розклад

- `detect-cohort-retention-drops-daily` `15 4 * * *` — pure-SQL, без HTTP

## UI

Сигнали приземляються у Decision Inbox через стандартний convert_insights_to_decisions → owner_review.
