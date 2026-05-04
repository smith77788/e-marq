## Що знайшов в аудиті (2026-05-04)

Запустив SQL-розслідування. Система НЕ повністю здорова, попри минулий звіт. Дві окремі регресії:

### 1. Decision pipeline зупинився 4 дні тому (CRITICAL)

- `ai_insights`: 642 рядки, останній 2026-05-04 11:29 — генератор працює
- `decision_queue`: останній запис **2026-04-30 00:30** — нічого не створено за останні 4 дні
- `ai_actions` за 24h: 0 рядків
- `action_outcomes`: всі 47 рядків з measured_at = сьогодні 12:00 одним batch (підозра на ручний trigger)

Функції `convert_insights_to_decisions`, `auto_approve_eligible_decisions`, `execute_pending_decisions`, `run_sql_loop_tick` існують у БД — але їх ніхто не викликає. Або cron job знятий, або тригерить інакше і мовчки fail-ить.

Гіпотеза: pure-SQL pipeline tick cron job або (a) знятий під час CRON_SECRET rollout, або (b) дзвонить hooks endpoint який тепер 401-ить, або (c) функцію було перейменовано і cron command вказує на застару назву.

### 2. Cron HTTP timeouts (~87 за 2 год = ~44/год)

`pg_net` має 5-секундний дефолт timeout на http_post. Усі запити, де hooks endpoint відповідає довше 5s, тихо втрачаються (status_code=NULL, timed_out=true). Це особливо ймовірно для fan-out endpoints (`agents.run-all`, `engines.dispatch`, `outreach-action-executor`), які проходять по N тенантах послідовно.

Це не блокує систему, але означає що частина агентів пропускає тики.

### 3. Permission на admin функції

`admin_list_cron_jobs()` повертає `permission denied` навіть з прямого SQL з admin-сесії. Треба перевірити GRANT-и (мабуть super_admin не виданий моєму юзеру в `user_roles` у поточній сесії).

---

## Що зроблю (default mode)

### Крок 1. Розблокувати inspect cron jobs
- Тимчасова SECURITY DEFINER функція `_owner_inspect_cron()` доступна `service_role`, щоб міграція могла прочитати `cron.job` і вирівняти все необхідне.
- Або виправити `admin_list_cron_jobs` GRANT на postgres role.

### Крок 2. Полагодити SQL-loop tick cron
- Перевірити в `cron.job` що job, який викликає `run_sql_loop_tick()` / `convert_insights_to_decisions()`, існує і active.
- Якщо немає — створити заново, **викликаючи функцію напряму через `cron.schedule('sql-loop-tick', '*/30 * * * *', $$ SELECT run_sql_loop_tick(); $$)`**, БЕЗ HTTP — pure-SQL гілка має жити в БД, не залежати від Publish.
- Аналогічно перевірити cron для `auto_approve_eligible_decisions` (15min), `execute_pending_decisions`, `measure_pending_outcomes` (6h), `generate_data_driven_insights` (1h).

### Крок 3. Прогнати recovery batch вручну
Один-разовий `SELECT convert_insights_to_decisions();` + `SELECT auto_approve_eligible_decisions();` + `SELECT execute_pending_decisions();` щоб затягнути 4 дні застряглих insights у decision_queue. Перевірити що не плодить дублікати (semantic_key вже захищає).

### Крок 4. Підняти timeout у HTTP cron jobs
Усі `net.http_post(...)` в cron.job, які зараз без `timeout_milliseconds`, переключити на `timeout_milliseconds := 30000`. Особливо: `agents-run-all`, `engines-dispatch`, `outreach-action-executor`, `self-heal-engine`. Це через `cron.alter_job` міграцію.

### Крок 5. Health-guard на decision_queue застій
Доповнити `compute_agent_health_daily()` (або окрема функція `check_pipeline_health()`) перевіркою: якщо `max(decision_queue.created_at) < now() - interval '6 hours'` AND `count(ai_insights where status='new') > 5` → INSERT в `agent_health` запис з `status='failing'`, agent_id='sql_pipeline'. Тоді HealthCheckAgent побачить і Telegram нотифікує. Це закриє blind spot який ми тільки-но знайшли.

### Крок 6. Memory оновлення
Оновити `mem://architecture/sql-loop-tick` фактом що cron має бути pure-SQL (без HTTP), додати в Core рядок: "SQL pipeline cron jobs ОБОВ'ЯЗКОВО direct-SQL (`SELECT fn();`), НЕ через `net.http_post`. HTTP залежить від Publish і CRON_SECRET — одна точка відмови вбиває всю автономію."

---

## Що НЕ робитиму

- Не торкаюсь Telegram bot, hooks-агентів, frontend — всі вони працюють.
- Не дроплю DEAD-таблиці (це окремий sprint).
- Не міняю CRON_SECRET та auth — він стабільний (тільки 3× 401 за 2 год = 0.7%).

---

## Очікуваний результат

- `decision_queue` знову росте щогодини
- 0 timeouts через `pg_net` (30s buffer)
- Якщо pipeline впаде ще раз — побачимо в Telegram через 1 годину, не через 4 дні

Approve — стартую з кроку 1.