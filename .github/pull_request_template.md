## Summary

<!-- What does this change and why? -->

Closes #

## How was this tested?

<!-- Tick what applies and describe anything else you ran. -->

- [ ] `npm test` in `kafka-consumer/` and/or `query-api/`
- [ ] `npm run lint && npm run build` in `dashboard/`
- [ ] `docker compose up --build` in `infra/` plus `infra/load-gen.sh`, and checked the result in the dashboard or ClickHouse
- [ ] Added or updated unit tests

## Checklist

- [ ] Screenshots attached for dashboard changes
- [ ] README / docs updated if behaviour, config or env vars changed
- [ ] `infra/clickhouse/init.sql` changes note how existing installs pick them up (it only runs on a fresh volume)
