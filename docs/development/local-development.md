<div align="center">

# 💻 Local Development Guide

### *Setting Up Development Environment*

[![Development](https://img.shields.io/badge/Development-Local%20Setup-F59E0B?style=for-the-badge&logo=visualstudiocode&logoColor=white)](.)
[![Node.js](https://img.shields.io/badge/Node.js-20.19+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

*Guide for developers working on TraceLens*

</div>

---

## 📑 Table of Contents

- [Prerequisites](#-prerequisites)
- [Development Options](#-development-options)
- [Full Stack with Docker](#-full-stack-with-docker)
- [Hybrid Development](#-hybrid-development)
- [Service-Specific Development](#-service-specific-development)
- [Debugging](#-debugging)
- [Testing](#-testing)
- [Code Style & Linting](#-code-style--linting)
- [Hot Reload](#-hot-reload)
- [Tips & Tricks](#-tips--tricks)

---

## ✅ Prerequisites

| Tool | Version | Purpose |
|:------|:---------|:---------|
| **Node.js** | 20.19+ | Runtime for services; dashboard tooling (Vite 8 / ESLint 10) requires 20.19+ |
| **npm** | 8+ | Package manager |
| **Docker Desktop** | Latest | For full stack |
| **Git** | Latest | Version control |
| **VS Code** | Latest | Recommended IDE |
| **Postman/Insomnia** | Any | API testing |

---

## 🎯 Development Options

| Option | Speed | Full Stack | Best For |
|:--------|:-------|:-----------|:---------|
| **Full Docker** | Slower rebuilds | Yes | Testing integrations |
| **Hybrid** | Fast iteration | Partial | Active development |
| **Pure Local** | Fastest | Manual setup | Deep debugging |

---

## 🐳 Full Stack with Docker

Best for testing the complete pipeline.

```bash
# Clone
git clone https://github.com/sanjaysaini383/observability-platform.git
cd observability-platform/infra

# Setup
cp .env.example .env

# Start
docker compose up -d --build

# Initialize
curl -X POST http://localhost:5000/init
curl -X POST http://localhost:5001/init

# Generate traffic
bash load-gen.sh
```

**Rebuild after changes:**
```bash
docker compose up -d --build <service-name>
```

---

## 🔀 Hybrid Development

Run infrastructure in Docker, develop services locally for faster iteration.

### Start Infrastructure
```bash
cd infra
# Keep kafka-consumer in Docker: the broker advertises kafka:9092, which the
# host cannot resolve. Add trace-analyser too if you want AI analysis.
docker compose up -d zookeeper kafka clickhouse postgres redis otel-collector kafka-consumer
```

### Develop API Gateway Locally
```bash
cd services/api-gateway
npm install
# Update OTEL_EXPORTER_OTLP_ENDPOINT to localhost:4317 if needed
SERVICE_NAME=api-gateway OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 node --import ../tracing.js app.js
```

### Develop Query API Locally
```bash
cd query-api
npm install
CLICKHOUSE_URL=http://default:password@localhost:8123 REDIS_URL=redis://localhost:6379 node index.js
```

If the password contains URL-reserved characters (`@`, `:`, `/`, `#`), percent-encode it in the URL.

### Develop Dashboard Locally
```bash
cd dashboard
npm install
npm run dev
```

Dashboard runs on `http://localhost:5173` with hot reload.

---

## 🛠️ Service-Specific Development

### API Gateway
```bash
cd services/api-gateway
npm init -y  # if needed
npm install express axios jsonwebtoken cors @opentelemetry/api @opentelemetry/sdk-node
node --import ../tracing.js app.js
```

### Kafka Consumer
Keep the consumer in Docker for hybrid development. Compose advertises the broker as `PLAINTEXT://kafka:9092`, so a process running on the host cannot connect to `localhost:9092`.

```bash
cd infra
docker compose up -d kafka-consumer
docker compose logs -f kafka-consumer
```

If you must run it on the host, first add a second advertised listener to the `kafka` service (for example `PLAINTEXT_HOST://localhost:29092`) and use `KAFKA_BROKERS=localhost:29092`. Also pass ClickHouse credentials: `CLICKHOUSE_URL=http://default:password@localhost:8123`.

### Trace Analyzer
```bash
cd query-api/workers
npm install
CLICKHOUSE_URL=http://default:password@localhost:8123 LLM_PROVIDER=mock node trace-analyser.js
```

---

## 🐛 Debugging

### VS Code Launch Configuration

Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API Gateway",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/services/api-gateway/app.js",
      "runtimeArgs": ["--import", "./services/tracing.js"],
      "env": {
        "SERVICE_NAME": "api-gateway",
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4317",
        "PORT": "3000"
      }
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Query API",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/query-api/index.js",
      "env": {
        "PORT": "4000",
        "CLICKHOUSE_URL": "http://default:password@localhost:8123",
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  ]
}
```

### Node.js Debugging
```bash
node --inspect --import ./tracing.js app.js
# Then attach debugger on chrome://inspect
```

### Docker Debugging
```bash
# View logs
docker compose logs -f <service>

# Exec into container
docker compose exec <service> sh

# Inspect
docker compose exec <service> node --version
```

### Debugging Tips
- Use Chrome DevTools for Node debugging
- Add `debugger;` statements
- Use `console.log` strategically
- Check OpenTelemetry traces for issues
- Use ClickHouse client for data inspection

---

## 🧪 Testing

### Unit Tests
```bash
# Kafka Consumer
cd kafka-consumer
npm test

# Query API Helpers
cd query-api
npm test
```

### Manual API Testing
```bash
# Health checks
curl http://localhost:4000/health
curl http://localhost:3000/health

# Test traces
curl http://localhost:4000/api/traces?limit=10

# Test services
curl http://localhost:4000/api/services
```

### Integration Testing
1. Start full stack
2. Initialize databases
3. Generate traffic
4. Verify data flows
5. Check all endpoints

### Load Testing
```bash
# Using Apache Bench
ab -n 1000 -c 10 http://localhost:3000/products

# Using hey
hey -n 1000 -c 10 http://localhost:3000/products
```

---

## 🎨 Code Style & Linting

### Current Style
- ES Modules
- 2-space indentation
- Single quotes preferred
- Semicolons optional but consistent
- Meaningful variable names

### Recommended Tools
```bash
# Install dev dependencies
npm install --save-dev eslint prettier
```

### ESLint Config
```json
{
  "env": {
    "node": true,
    "es2022": true
  },
  "extends": "eslint:recommended",
  "parserOptions": {
    "ecmaVersion": "latest",
    "sourceType": "module"
  },
  "rules": {
    "no-console": "off",
    "no-unused-vars": "warn"
  }
}
```

### Prettier Config
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5"
}
```

---

## 🔥 Hot Reload

### Dashboard (Vite)
Already has HMR enabled with `npm run dev`

### Node Services
Use nodemon:
```bash
npm install --save-dev nodemon
# package.json
"scripts": {
  "dev": "nodemon --import ./tracing.js app.js"
}
```

```bash
npm run dev
```

### Docker with Hot Reload
```yaml
services:
  api-gateway:
    volumes:
      - ../services/api-gateway:/app/api-gateway
      - ../services/tracing.js:/app/tracing.js
    command: ["npx", "nodemon", "--import", "./tracing.js", "api-gateway/app.js"]
```

---

## 💡 Tips & Tricks

### Development Workflow
1. Make changes locally
2. Test with hot reload
3. Run tests
4. Build and test with Docker
5. Commit

### Environment Variables
Use `.env` files for local development, don't commit them

### Git Workflow
```bash
git checkout -b feature/my-feature
# Make changes
git add .
git commit -m "feat: description"
git push origin feature/my-feature
```

### Useful Commands
```bash
# Check running processes
docker compose ps

# Restart all
docker compose restart

# View resource usage
docker stats

# Clean up
docker system prune -f

# Check logs for errors
docker compose logs | grep -i error
```

### IDE Extensions (VS Code)
- ESLint
- Prettier
- Docker
- REST Client
- Thunder Client
- GitLens

### Testing Checklist
- [ ] Health endpoints respond
- [ ] Traces appear in dashboard
- [ ] Service graph renders
- [ ] Metrics update
- [ ] AI analysis works (or mock)
- [ ] No console errors
- [ ] Tests pass

---

<div align="center">

**[← Back to Docs](../../README.md)** | **[Contributing Guide →](../contributing.md)**

</div>
