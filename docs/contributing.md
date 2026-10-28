<div align="center">

# 🤝 Contributing Guide

### *Join Us in Building Better Observability*

[![Contributions Welcome](https://img.shields.io/badge/Contributions-Welcome-22C55E?style=for-the-badge&logo=github&logoColor=white)](.)
[![MIT License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](../LICENSE)
[![Open Source](https://img.shields.io/badge/Open%20Source-Love-red?style=for-the-badge&logo=heart&logoColor=white)](.)

*Guidelines for contributing to TraceLens*

</div>

---

## 📑 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Project Structure](#project-structure)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Issue Reporting](#issue-reporting)
- [Areas Needing Help](#areas-needing-help)
- [Recognition](#recognition)

---

## 📜 Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inclusive environment for everyone, regardless of experience level, background, or identity.

### Our Standards

**Positive behavior includes:**
- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

**Unacceptable behavior includes:**
- Harassment, trolling, or discriminatory comments
- Publishing others' private information
- Other conduct which could reasonably be considered inappropriate

---

## 🎯 How Can I Contribute?

There are many ways to contribute to TraceLens:

| Contribution Type | Description | Skill Level |
|:-------------------|:-------------|:------------|
| **Bug Reports** | Report issues you encounter | All levels |
| **Feature Requests** | Suggest new features or improvements | All levels |
| **Documentation** | Improve docs, fix typos, add examples | All levels |
| **Code Contributions** | Fix bugs, implement features | Intermediate+ |
| **Testing** | Write tests, test on different platforms | All levels |
| **UI/UX** | Improve dashboard design | Design/Frontend |
| **Performance** | Optimize queries, reduce latency | Backend/DB |
| **Security** | Find and fix security issues | Security-focused |

---

## 🚀 Getting Started

### Prerequisites
- Git installed
- Docker Desktop
- Node.js (for local development outside Docker)
- Code editor (VS Code recommended)

### Fork and Clone

1. **Fork the repository** on GitHub
2. **Clone your fork**:
```bash
git clone https://github.com/YOUR_USERNAME/observability-platform.git
cd observability-platform
```

3. **Add upstream remote**:
```bash
git remote add upstream https://github.com/sanjaysaini383/observability-platform.git
```

4. **Verify remotes**:
```bash
git remote -v
```

### Set Up Development Environment

```bash
# Start the full stack
cd infra
docker compose up -d --build

# Initialize databases
curl -X POST http://localhost:5000/init
curl -X POST http://localhost:5001/init

# Generate test traffic
bash load-gen.sh
```

### Local Development (Without Docker)

For faster iteration on specific services:

```bash
# API Gateway
cd services/api-gateway
npm install
npm run dev

# Query API
cd query-api
npm install
npm run dev

# Dashboard
cd dashboard
npm install
npm run dev
```

---

## 🔄 Development Workflow

### 1. Sync with Upstream
```bash
git checkout main
git fetch upstream
git merge upstream/main
git push origin main
```

### 2. Create Feature Branch
```bash
git checkout -b feat/your-feature-name
# or
git checkout -b fix/bug-description
# or
git checkout -b docs/documentation-update
```

**Branch naming conventions:**
- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `perf/` - Performance improvements
- `test/` - Adding tests
- `chore/` - Maintenance tasks

### 3. Make Changes
- Write clean, readable code
- Follow existing patterns
- Add comments only when necessary
- Update documentation if needed
- Test your changes

### 4. Test Your Changes
```bash
# Rebuild affected services
cd infra
docker compose up -d --build <service-name>

# Run tests
cd kafka-consumer && npm test
cd query-api && npm test
```

### 5. Commit Changes
```bash
git add .
git commit -m "feat: add tail-based sampling support"
```

### 6. Push to Fork
```bash
git push origin feat/your-feature-name
```

### 7. Create Pull Request
Open a PR from your fork to the main repository with a clear description.

---

## 💻 Coding Standards

### General Principles
- **Simplicity**: Keep code simple and readable
- **Consistency**: Follow existing code style
- **Modularity**: Break down complex logic
- **Error Handling**: Always handle errors gracefully
- **Security**: Never commit secrets or sensitive data

### JavaScript/Node.js
- Use ES modules (`import/export`)
- Use `const`/`let`, avoid `var`
- Use async/await over callbacks
- Use meaningful variable names
- Keep functions small and focused
- Add JSDoc for complex functions

**Example:**
```javascript
/**
 * Escape SQL string values to prevent injection
 * @param {string} str - Input string
 * @returns {string} Escaped string
 */
export function escSql(str) {
  if (str == null) return '';
  return String(str).replace(/'/g, "''");
}
```

### TypeScript (Dashboard)
- Use strict type checking
- Define interfaces for props and data
- Avoid `any` type
- Use proper typing from API responses

```typescript
interface Trace {
  TraceId: string;
  ServiceName: string;
  OperationName: string;
  DurationMs: number;
  StatusCode: number;
}
```

### SQL (ClickHouse)
- Use parameterized-style escaping (we use `escSql`)
- Format queries for readability
- Use appropriate data types
- Add comments for complex queries
- Leverage materialized views when possible

### React/Frontend
- Use functional components with hooks
- Keep components small and reusable
- Use proper key props in lists
- Handle loading and error states
- Follow TailwindCSS conventions

### Docker
- Use multi-stage builds when beneficial
- Keep images small
- Use .dockerignore files
- Don't run as root in production
- Use specific image tags

---

## 📁 Project Structure

```
observability-platform/
├── collector/           # OTel Collector config
├── dashboard/           # React frontend
│   ├── src/
│   │   ├── components/ # Reusable components
│   │   ├── pages/      # Page components
│   │   ├── lib/        # API clients, utils
│   │   └── types/      # TypeScript types
├── docs/               # Documentation (you are here)
├── infra/              # Docker Compose & configs
│   ├── docker-compose.yml
│   ├── .env.example
│   └── clickhouse/     # ClickHouse init scripts
├── kafka-consumer/     # Kafka to ClickHouse bridge
├── query-api/          # REST API
│   ├── workers/        # Background workers
│   └── helpers.js
├── services/           # Microservices
│   ├── api-gateway/
│   ├── order-service/
│   ├── payment-service/
│   ├── inventory-service/
│   ├── notification-service/
│   └── tracing.js      # Shared OTel setup
└── shared/             # Shared utilities
```

---

## 🧪 Testing Guidelines

### Running Tests

```bash
# Kafka Consumer tests
cd kafka-consumer
npm install
npm test

# Query API tests
cd query-api
npm install
npm test
```

### Writing Tests

Use Node.js built-in test runner:

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { escSql } from './helpers.js';

test('escSql escapes single quotes', () => {
  assert.strictEqual(escSql("O'Reilly"), "O''Reilly");
});

test('escSql handles null/undefined', () => {
  assert.strictEqual(escSql(null), '');
  assert.strictEqual(escSql(undefined), '');
});
```

### Test Coverage Expectations
- Test utility functions thoroughly
- Test edge cases (null, undefined, empty strings)
- Test SQL escaping to prevent injection
- Test parsing logic for OTLP messages
- Manual testing for UI changes

### What to Test
- [ ] New utility functions
- [ ] SQL generation logic
- [ ] Data parsing/transformations
- [ ] API route logic
- [ ] Error handling

---

## 📤 Pull Request Process

### Before Submitting
- [ ] Code follows style guidelines
- [ ] Tests pass locally
- [ ] Documentation updated if needed
- [ ] No console.log left in production code (or justified)
- [ ] No secrets committed
- [ ] Changes tested with Docker stack
- [ ] Branch is up to date with main

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Refactoring

## Related Issue
Fixes #123

## Changes Made
- Change 1
- Change 2

## Testing
How to test these changes

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

### Review Process
1. **Automated checks** (if configured)
2. **Code review** by maintainers
3. **Testing** by reviewers
4. **Approval** and merge

### After Merge
- Delete your feature branch
- Sync your fork
- Celebrate! 🎉

---

## 📝 Commit Message Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types
| Type | Description |
|:------|:-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, missing semicolons, etc. |
| `refactor` | Code change that neither fixes bug nor adds feature |
| `perf` | Performance improvement |
| `test` | Adding missing tests |
| `chore` | Maintenance tasks |
| `revert` | Revert previous commit |

### Examples

```bash
feat(dashboard): add trace waterfall component
fix(kafka-consumer): handle empty message batches
docs(readme): update quick start instructions
perf(clickhouse): optimize service dependencies query
refactor(api): extract query helpers
test(helpers): add tests for escSql function
```

### Rules
- Use imperative mood ("add" not "added")
- Don't capitalize first letter
- No period at the end
- Keep subject line under 50 characters
- Add body for complex changes
- Reference issues in footer: `Fixes #123`

---

## 🐛 Issue Reporting

### Before Creating an Issue
- Search existing issues
- Check troubleshooting guide
- Test with latest version
- Reproduce consistently

### Bug Report Template

```markdown
## Bug Description
Clear description of the bug

## Steps to Reproduce
1. Step 1
2. Step 2
3. Step 3

## Expected Behavior
What should happen

## Actual Behavior
What actually happens

## Environment
- OS: [e.g., Windows 11]
- Docker Version: [e.g., 24.0.6]
- Browser: [e.g., Chrome 120]

## Logs
Relevant logs from docker compose

## Screenshots
If applicable

## Additional Context
Any other information
```

### Feature Request Template

```markdown
## Feature Description
Clear description of the feature

## Problem it Solves
What problem does this solve?

## Proposed Solution
How would you implement this?

## Alternatives Considered
Other approaches you've thought about

## Additional Context
Mockups, examples, etc.
```

---

## 🎨 Areas Needing Help

We especially welcome contributions in these areas:

| Area | Priority | Description | Skills Needed |
|:------|:----------|:-------------|:--------------|
| **Tail-based Sampling** | 🔴 High | Implement sampling in OTel Collector | OpenTelemetry, Go/YAML |
| **Alerting Engine** | 🔴 High | Add webhook integrations (Slack, PagerDuty, Email) | Node.js, Webhooks |
| **Kubernetes Helm Chart** | 🔴 High | Deploy to K8s with HPA, PDB, Ingress | Kubernetes, Helm, YAML |
| **Authentication/Authorization** | 🔴 High | Add auth to dashboard and API | JWT, RBAC, Security |
| **eBPF Instrumentation** | 🟡 Medium | Zero-code instrumentation | eBPF, C, Linux |
| **ClickHouse Clustering** | 🟡 Medium | HA setup with replication | ClickHouse, Distributed Systems |
| **Log-Trace Correlation UI** | 🟡 Medium | Better log viewing in trace context | React, UI/UX |
| **Load Testing Suite** | 🟡 Medium | k6/Locust benchmarks | Performance Testing |
| **Mobile Responsive Dashboard** | 🟢 Low | Improve mobile UX | CSS, React |
| **Dark/Light Mode** | 🟢 Low | Theme toggle | React, CSS |

---

## 🏆 Recognition

Contributors are valued and recognized:

- **Contributors list** in README
- **Credit in release notes**
- **Mention in commit history**
- **Community recognition**

All contributions, big or small, are appreciated!

---

## 📞 Contact

- **GitHub Issues**: [Create an issue](https://github.com/sanjaysaini383/observability-platform/issues)
- **Pull Requests**: [Submit a PR](https://github.com/sanjaysaini383/observability-platform/pulls)
- **Repository**: [sanjaysaini383/observability-platform](https://github.com/sanjaysaini383/observability-platform)

---

<div align="center">

**Thank you for contributing to TraceLens!**

*Together, we're making world-class observability accessible to everyone.*

**[← Back to Troubleshooting Guide](./troubleshooting.md)** | **[Back to README](../README.md)**

</div>
