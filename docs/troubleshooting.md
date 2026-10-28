<div align="center">

# 🔧 Troubleshooting Guide

### *Common Issues, Debugging, and Solutions*

[![Troubleshoot](https://img.shields.io/badge/Troubleshooting-Debugging%20Guide-EF4444?style=for-the-badge&logo=bugsnag&logoColor=white)](.)
[![Support](https://img.shields.io/badge/Support-Community%20Driven-F59E0B?style=for-the-badge)](.)

*Comprehensive troubleshooting for setup, runtime, and performance issues*

</div>

---

## 📑 Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Installation Issues](#installation-issues)
- [Container & Networking Issues](#container--networking-issues)
- [Data Pipeline Issues](#data-pipeline-issues)
- [Dashboard & API Issues](#dashboard--api-issues)
- [AI Analysis Issues](#ai-analysis-issues)
- [Performance Issues](#performance-issues)
- [Database Issues](#database-issues)
- [Logging & Debugging](#logging--debugging)
- [Emergency Recovery](#emergency-recovery)
- [Getting Help](#getting-help)

---

## 🚨 Quick Diagnostics

Run these commands first to assess system health:

```bash
# Check all containers
docker compose ps

# Check resource usage
docker stats --no-stream

# Check disk space
docker system df

# View recent logs from all services
docker compose logs --tail=20

# Check network connectivity
docker network inspect infra_observability
```

---

## 💾 Installation Issues

### Issue: Docker Not Installed or Not Running

**Symptoms:**
- `docker: command not found`
- `Cannot connect to the Docker daemon`

**Solutions:**
1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop)
2. Start Docker Desktop
3. Wait for it to fully initialize (whale icon stable)
4. Verify: `docker version`

### Issue: Insufficient Memory

**Symptoms:**
- Containers randomly crash
- Kafka/ClickHouse fail to start
- Out of memory errors in logs

**Solutions:**
1. **Docker Desktop**: Settings → Resources → Memory → Increase to 8GB minimum
2. **Linux**: Ensure system has enough RAM, check swap
3. **Restart Docker** after changing settings
4. **Verify**: `docker info | grep -i memory`

### Issue: Port Already in Use

**Symptoms:**
```
Error starting userland proxy: listen tcp4 0.0.0.0:8080: bind: address already in use
```

**Solutions:**

**Windows:**
```powershell
# Find process using port
netstat -ano | findstr :8080
# Kill process (replace PID)
taskkill /PID <PID> /F
```

**Linux/macOS:**
```bash
# Find process
lsof -i :8080
# Kill process
kill -9 <PID>
```

**Or change port in docker-compose.yml:**
```yaml
dashboard:
  ports:
    - "8081:3000"  # Use different host port
```

### Issue: Slow or Failed Image Pulls

**Symptoms:**
- Build hangs for long time
- Network timeout errors

**Solutions:**
1. Check internet connection
2. Use Docker Hub mirror or different network
3. Pull images manually: `docker pull confluentinc/cp-kafka:7.5.3`
4. Clear Docker cache: `docker system prune -a` (WARNING: removes all unused images)

---

## 🌐 Container & Networking Issues

### Issue: Services Not Starting in Order

**Symptoms:**
- API Gateway can't connect to services
- Consumer can't connect to Kafka/ClickHouse

**Solutions:**
1. Check dependencies and health checks
```bash
docker compose ps
```
2. Start in order or restart:
```bash
docker compose up -d zookeeper kafka clickhouse postgres redis
# Wait for healthy
docker compose up -d otel-collector
docker compose up -d
```
3. Check logs for dependency issues:
```bash
docker compose logs kafka clickhouse
```

### Issue: Container Unhealthy

**Symptoms:**
- Status shows `(unhealthy)`

**Debug:**
```bash
# Check health check logs
docker inspect infra-postgres-1 | grep -A 20 Health

# View service logs
docker compose logs postgres

# Test health endpoint manually
docker compose exec api-gateway wget --spider http://localhost:3000/health
```

**Solutions:**
1. Increase health check timeout/retries
2. Wait longer for initialization
3. Restart the service
4. Check if service is actually running correctly

### Issue: Network Connectivity Between Containers

**Symptoms:**
- `ECONNREFUSED` errors
- Can't resolve service names

**Debug:**
```bash
# Test DNS resolution
docker compose exec api-gateway nslookup order-service

# Test connectivity
docker compose exec api-gateway ping -c 3 order-service
docker compose exec api-gateway curl http://order-service:5000/health
```

**Solutions:**
1. Ensure all services on same network
2. Use service names, not localhost
3. Check `docker-compose.yml` network configuration
4. Restart network: `docker compose down && docker compose up -d`

---

## 📊 Data Pipeline Issues

### Issue: No Traces in Dashboard

**Symptoms:**
- Traces tab empty
- Service graph empty
- Metrics show no data

**Diagnosis:**
```bash
# Check if services are instrumented and sending
docker compose logs api-gateway | grep -i otel

# Check OTel Collector
docker compose logs otel-collector | tail -30

# Check Kafka topics
docker compose exec kafka kafka-topics --list --bootstrap-server kafka:9092

# Check Kafka messages
docker compose exec kafka kafka-console-consumer --bootstrap-server kafka:9092 --topic otel.traces --from-beginning --max-messages 5

# Check Kafka Consumer
docker compose logs kafka-consumer | tail -30

# Check ClickHouse
docker compose exec clickhouse clickhouse-client --user default --password password --query "SELECT count() FROM traces"
```

**Solutions:**

1. **Generate traffic** (most common cause):
```bash
curl http://localhost:5000/init
curl http://localhost:5001/init
bash load-gen.sh
```

2. **Check OTel Collector config** - verify Kafka exporters are configured

3. **Restart pipeline components**:
```bash
docker compose restart otel-collector kafka-consumer
```

4. **Verify auto-instrumentation** - check services load `tracing.js` via `--import`

### Issue: Kafka Consumer Lag

**Symptoms:**
- Traces delayed in dashboard
- High message count in Kafka topics

**Debug:**
```bash
# Check consumer group lag
docker compose exec kafka kafka-consumer-groups --bootstrap-server kafka:9092 --describe --group otel-consumer-group
```

**Solutions:**
1. Increase consumer batch size: `BATCH_SIZE: 200`
2. Reduce flush interval: `FLUSH_INTERVAL: 3000`
3. Scale consumers (add more instances)
4. Check ClickHouse insert performance
5. Restart consumer: `docker compose restart kafka-consumer`

### Issue: ClickHouse Insert Errors

**Symptoms:**
- `kafka-consumer` logs show insert failures
- Data not appearing

**Common Errors:**

**"Type mismatch" or schema errors:**
```bash
# Check schema
docker compose exec clickhouse clickhouse-client --user default --password password --query "SHOW CREATE TABLE traces"
```

**Solution:** Schema mismatch after changes. Reset:
```bash
docker compose down -v
docker compose up -d --build
```

**"Memory limit exceeded":**
```bash
# Check ClickHouse memory
docker compose logs clickhouse | grep -i memory
```

**Solution:** Increase Docker memory or tune ClickHouse settings

**Connection errors:**
```bash
# Test ClickHouse connectivity
curl http://localhost:8123/ping
```

### Issue: Data Loss or Duplicates

**Understanding:**
- At-least-once delivery means possible duplicates
- Handled by `TraceId + SpanId` uniqueness in queries (not enforced as PK)

**Not a bug** - acceptable for observability use case.

---

## 🖥️ Dashboard & API Issues

### Issue: Dashboard Won't Load

**Symptoms:**
- Blank page
- Connection errors in browser console

**Debug:**
```bash
# Check dashboard container
docker compose logs dashboard

# Check if serving
curl http://localhost:8080

# Check browser console for errors (F12)
```

**Solutions:**
1. Verify dashboard running: `docker compose ps dashboard`
2. Rebuild dashboard: `docker compose up -d --build dashboard`
3. Check API URL in build args
4. Clear browser cache
5. Try different browser

### Issue: Dashboard Shows "Failed to fetch"

**Symptoms:**
- Network errors
- API calls failing

**Debug:**
```bash
# Check Query API
curl http://localhost:4000/health
docker compose logs query-api

# Check CORS
# Browser network tab shows CORS errors
```

**Solutions:**
1. Ensure Query API is healthy
2. Check `VITE_API_URL` matches actual API location
3. Verify CORS is enabled (it is by default)
4. Check firewall/network issues
5. Rebuild dashboard with correct API URL

### Issue: API Returns 503 Errors

**Symptoms:**
```json
{"error": "Failed to query traces", "details": "..."}
```

**Debug:**
```bash
docker compose logs query-api | tail -40
```

**Common Causes:**
- ClickHouse down or unreachable
- Redis down
- SQL syntax errors
- Timeout

**Solutions:**
1. Check ClickHouse: `curl http://localhost:8123/ping`
2. Check Redis: `docker compose exec redis redis-cli ping`
3. Restart API: `docker compose restart query-api`
4. Check query timeout (10s default)

### Issue: Slow Dashboard Loading

**Symptoms:**
- Long load times
- Timeouts

**Solutions:**
1. **Use caching** - Redis should be working
2. **Check Redis**: `docker compose exec redis redis-cli INFO stats`
3. **Reduce time ranges** in queries
4. **Optimize ClickHouse** - ensure materialized views populated
5. **Increase resources** for ClickHouse/Redis
6. **Check network latency** between containers

---

## 🤖 AI Analysis Issues

### Issue: No AI Insights Appearing

**Symptoms:**
- AI Insights tab empty
- No analysis in logs

**Diagnosis:**
```bash
# Check trace-analyser logs
docker compose logs trace-analyser

# Check for errors
docker compose logs trace-analyser | grep -i error

# Check if there are error traces
docker compose exec clickhouse clickhouse-client --user default --password password --query "SELECT count() FROM traces WHERE StatusCode = 2 AND StartTime > now() - INTERVAL 10 MINUTE"

# Check insights table
docker compose exec clickhouse clickhouse-client --user default --password password --query "SELECT count() FROM trace_insights"
```

**Solutions:**

1. **Generate errors**:
```bash
# Run checkout multiple times to trigger 10% failure rate
for i in {1..10}; do curl -X POST http://localhost:3000/checkout -H "Content-Type: application/json" -d '{"items":[{"productId":1,"qty":1}]}'; sleep 1; done
```

2. **Check LLM provider config**:
```yaml
# In docker-compose.yml trace-analyser
LLM_PROVIDER: groq  # or mock
```

3. **Verify Groq API key**:
```bash
# Check if set
echo $GROQ_API_KEY
# Or in container
docker compose exec trace-analyser env | grep GROQ
```

4. **Use mock for testing**:
```yaml
LLM_PROVIDER: mock
```
Then restart: `docker compose up -d trace-analyser`

5. **Wait for polling cycle** - analyzes every 60 seconds

### Issue: Groq API Errors

**Symptoms:**
```
✗ LLM error for trace ...: Request failed with status code 401
✗ LLM error for trace ...: Request failed with status code 429
```

**Solutions:**

**401 Unauthorized:**
- Invalid API key
- Check `infra/.env` has correct `GROQ_API_KEY`
- Get new key from [console.groq.com](https://console.groq.com)
- Restart: `docker compose up -d trace-analyser`

**429 Rate Limit:**
- Too many requests
- Free tier has limits
- Switch to `ollama` or `mock`
- Increase throttle in code or reduce frequency

**Timeout:**
- Network issues
- Increase timeout in trace-analyser.js
- Use local Ollama

### Issue: Ollama Connection Failed

**Symptoms:**
```
✗ LLM error: connect ECONNREFUSED
```

**Solutions:**
1. Ensure Ollama is running: `ollama list`
2. Check URL: `OLLAMA_URL: http://host.docker.internal:11434`
3. On Linux, use `http://172.17.0.1:11434` or host IP
4. Pull model: `ollama pull tinyllama`
5. Allow connections from Docker

### Issue: Analysis Attempts Exhausted

**Symptoms:**
- Traces not being analyzed despite errors
- Logs show "No unanalysed error traces found"

**Explanation:**
After 3 failed attempts, traces are skipped (prevents infinite retries)

**Solutions:**
```sql
-- Clear attempts to retry
DELETE FROM analysis_attempts WHERE TraceId = 'YOUR_TRACE_ID';
-- Or clear all
TRUNCATE TABLE analysis_attempts;
```

```bash
docker compose exec clickhouse clickhouse-client --user default --password password --query "TRUNCATE TABLE analysis_attempts"
```

---

## ⚡ Performance Issues

### Issue: High CPU/Memory Usage

**Diagnosis:**
```bash
docker stats
```

**Common Culprits:**
- ClickHouse consuming lots of memory
- Kafka/Zookeeper
- Multiple services

**Solutions:**

1. **Limit resources** in docker-compose:
```yaml
services:
  clickhouse:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2'
```

2. **Reduce data volume** - adjust TTLs
3. **Scale down** - stop unused services
4. **Optimize queries** - use time filters
5. **Increase Docker resources**

### Issue: Slow ClickHouse Queries

**Diagnosis:**
```sql
-- Check running queries
SELECT * FROM system.processes;

-- Check query log
SELECT query_duration_ms, query FROM system.query_log ORDER BY event_time DESC LIMIT 10;
```

**Solutions:**
1. Use materialized views
2. Add proper WHERE clauses with time ranges
3. Check index usage
4. Partition pruning - filter by ServiceName/StartTime
5. Increase `max_memory_usage`
6. Optimize table schema

### Issue: Dashboard Lag

**Solutions:**
1. Check Redis cache hit rate
2. Reduce polling frequency in components
3. Use smaller time windows
4. Optimize API queries
5. Add pagination where possible

---

## 🗄️ Database Issues

### Issue: PostgreSQL Connection Errors

**Symptoms:**
- Order/Inventory services fail to start
- "Connection refused" to postgres

**Debug:**
```bash
docker compose logs postgres order-service inventory-service
docker compose exec postgres pg_isready -U default
```

**Solutions:**
1. Wait for postgres healthy
2. Check connection string
3. Restart: `docker compose restart postgres order-service inventory-service`
4. Reinitialize: `curl -X POST http://localhost:5000/init && curl -X POST http://localhost:5001/init`

### Issue: Redis Connection Errors

**Symptoms:**
- Query API logs show Redis errors
- Caching not working

**Debug:**
```bash
docker compose logs redis query-api
docker compose exec redis redis-cli ping
```

**Solutions:**
1. Restart Redis: `docker compose restart redis`
2. Check REDIS_URL
3. API continues without cache on error (graceful degradation)
4. Clear Redis: `docker compose exec redis redis-cli FLUSHALL`

### Issue: ClickHouse Table Doesn't Exist

**Symptoms:**
- "Table default.traces doesn't exist"

**Cause:** Init script didn't run (volume already exists)

**Solution:**
```bash
# Reset everything
docker compose down -v
docker compose up -d --build
```

> ⚠️ This deletes all data

---

## 📝 Logging & Debugging

### Viewing Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api-gateway

# Last N lines
docker compose logs --tail=100 query-api

# Since timestamp
docker compose logs --since 2023-01-01T00:00:00

# Multiple services
docker compose logs -f api-gateway order-service payment-service
```

### Debug Mode

Enable more verbose logging:

**OpenTelemetry Collector:**
```yaml
exporters:
  logging:
    loglevel: debug  # Change from warn to debug
```

**Kafka Consumer:**
Add console logging in code or increase verbosity

**Query API:**
Already has console.log statements

### Container Inspection

```bash
# Inspect container
docker inspect infra-api-gateway-1

# Check environment
docker compose exec api-gateway env

# Access shell
docker compose exec api-gateway sh
docker compose exec clickhouse bash

# Check files
docker compose exec api-gateway ls -la
```

### Network Debugging

```bash
# List networks
docker network ls

# Inspect network
docker network inspect infra_observability

# Test DNS
docker compose exec query-api nslookup clickhouse
```

---

## 🚑 Emergency Recovery

### Complete Reset

When everything is broken:

```bash
# Stop all
docker compose down -v

# Remove all images (optional, saves space)
docker rmi $(docker images -q observability-platform*)

# Clean system
docker system prune -a --volumes

# Fresh start
docker compose up -d --build

# Reinitialize
curl -X POST http://localhost:5000/init
curl -X POST http://localhost:5001/init
```

### Partial Recovery

**Reset just data pipeline:**
```bash
docker compose stop kafka-consumer trace-analyser
docker compose exec clickhouse clickhouse-client --user default --password password --query "TRUNCATE TABLE traces; TRUNCATE TABLE metrics; TRUNCATE TABLE logs; TRUNCATE TABLE trace_insights;"
docker compose start kafka-consumer trace-analyser
```

**Reset just caches:**
```bash
docker compose exec redis redis-cli FLUSHALL
```

**Restart single service:**
```bash
docker compose restart <service-name>
docker compose up -d --build <service-name>
```

### Backup Before Reset

```bash
# Backup ClickHouse
docker run --rm -v infra_clickhouse_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/clickhouse-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .

# Backup PostgreSQL
docker compose exec postgres pg_dump -U default orders > orders-$(date +%Y%m%d-%H%M%S).sql
```

---

## 📞 Getting Help

### Before Asking for Help

Collect this information:
1. **Docker version**: `docker version`
2. **OS**: `uname -a` or system info
3. **Logs**: Relevant service logs
4. **Status**: `docker compose ps`
5. **Steps to reproduce**
6. **Error messages** (full stack traces)

### Resources
- [GitHub Issues](https://github.com/sanjaysaini383/observability-platform/issues) - Report bugs
- [README](../README.md) - Project overview
- [Architecture Guide](./architecture.md) - System design
- [Installation Guide](./installation-guide.md) - Setup help

### Tips for Debugging
- Always check logs first
- Use `docker compose ps` to see status
- Test connectivity between services
- Check if dependencies are healthy
- Generate traffic to see data flow
- Use browser dev tools for frontend issues
- Check ClickHouse directly for data issues

---

<div align="center">

**[← Back to Observability Guide](./observability-guide.md)** | **[Contributing Guide →](./contributing.md)**

</div>
