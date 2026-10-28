<div align="center">

# 🔐 Security Hardening Guide

### *Production Security Best Practices*

[![Security](https://img.shields.io/badge/Security-Hardening%20Guide-DC2626?style=for-the-badge&logo=shield&logoColor=white)](.)
[![OWASP](https://img.shields.io/badge/OWASP-Compliant-000000?style=for-the-badge&logo=owasp&logoColor=white)](https://owasp.org/)

*Comprehensive security recommendations for production deployment*

</div>

---

## 📑 Table of Contents

- [Security Overview](#security-overview)
- [Current Security Posture](#current-security-posture)
- [Authentication & Authorization](#authentication--authorization)
- [Network Security](#network-security)
- [Secrets Management](#secrets-management)
- [Database Security](#database-security)
- [API Security](#api-security)
- [Container Security](#container-security)
- [Monitoring & Auditing](#monitoring--auditing)
- [Incident Response](#incident-response)
- [Security Checklist](#security-checklist)

---

## 🎯 Security Overview

TraceLens is designed for **local development and demonstration**. Before deploying to production or exposing to the internet, implement the hardening measures in this guide.

> ⚠️ **Critical:** As-is, this platform has minimal security controls and should NOT be exposed publicly without hardening.

---

## 📊 Current Security Posture

| Component | Status | Risk Level | Notes |
|:-----------|:--------|:-----------|:-------|
| **API Gateway Auth** | Weak | 🔴 High | Hardcoded JWT secret, mock user fallback |
| **Query API** | None | 🔴 High | No authentication/authorization |
| **Dashboard** | None | 🔴 High | Publicly accessible |
| **ClickHouse** | Basic | 🟡 Medium | Default credentials in docker-compose |
| **PostgreSQL** | Basic | 🟡 Medium | Default credentials |
| **Redis** | None | 🟡 Medium | No password, open to network |
| **Kafka** | None | 🟡 Medium | No authentication |
| **CORS** | Permissive | 🟡 Medium | Allows all origins |
| **Secrets** | Env vars | 🟡 Medium | Not using secret manager |

---

## 🔑 Authentication & Authorization

### API Gateway JWT Hardening

**Current (insecure):**
```javascript
jwt.verify(token, 'secret_key', (err, user) => { ... })
req.user = { email: 'customer@example.com', name: 'Test User' }; // fallback
```

**Recommended:**
```javascript
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: Using random JWT secret. Set JWT_SECRET in production!');
}

// Remove mock fallback or make it configurable
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  // ... verify token
};
```

**Actions:**
- [ ] Generate strong JWT secret (256+ bits)
- [ ] Store in environment/secrets manager
- [ ] Remove or disable mock user fallback
- [ ] Implement token expiration
- [ ] Add refresh token mechanism
- [ ] Use RS256 instead of HS256 for distributed systems

### Query API Authentication

**Implement API key authentication:**
```javascript
const authenticateAPI = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

app.use('/api', authenticateAPI);
```

Or use JWT with role-based access control (RBAC).

### Dashboard Authentication

Options:
- **Basic Auth** at reverse proxy (nginx/Caddy)
- **OAuth2/OIDC** (Auth0, Keycloak)
- **Session-based auth**
- **SAML SSO** for enterprise

---

## 🌐 Network Security

### Firewall Configuration

**UFW (Ubuntu):**
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

**Never expose:** 3000, 4000, 4317, 4318, 5432, 6379, 8080, 8123, 9000, 9092

### Reverse Proxy with TLS

**Nginx example:**
```nginx
server {
    listen 443 ssl http2;
    server_name tracelens.example.com;
    
    ssl_certificate /etc/letsencrypt/live/tracelens.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tracelens.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /api/ {
        proxy_pass http://localhost:4000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

server {
    listen 80;
    server_name tracelens.example.com;
    return 301 https://$server_name$request_uri;
}
```

### Docker Network Isolation
- Use custom bridge networks
- Don't use `host` network mode
- Limit inter-service communication
- Consider Docker secrets

---

## 🔐 Secrets Management

### Current Issues
- Credentials in `docker-compose.yml`
- Secrets in `.env` files
- Hardcoded values in code

### Recommendations

#### Use Docker Secrets (Swarm) or .env with encryption
```bash
# Generate strong passwords
openssl rand -base64 32
```

#### Update .env
```env
JWT_SECRET=$(openssl rand -base64 64)
CLICKHOUSE_PASSWORD=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -base64 32)
REDIS_PASSWORD=$(openssl rand -base64 32)
API_KEY=$(openssl rand -base64 32)
GROQ_API_KEY=your_actual_key
```

#### Use Secret Managers
- **AWS Secrets Manager**
- **HashiCorp Vault**
- **Azure Key Vault**
- **Google Secret Manager**

#### Never Commit Secrets
```gitignore
.env
.env.local
*.key
*.pem
secrets/
```

---

## 🗄️ Database Security

### ClickHouse
```yaml
clickhouse:
  environment:
    CLICKHOUSE_USER: ${CLICKHOUSE_USER}
    CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD}
    CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
```

**Recommendations:**
- [ ] Change default user/password
- [ ] Create read-only users for Query API
- [ ] Use TLS for connections
- [ ] Enable access control lists
- [ ] Restrict network access
- [ ] Audit logging

### PostgreSQL
```yaml
postgres:
  environment:
    POSTGRES_USER: ${POSTGRES_USER}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

**Recommendations:**
- [ ] Use strong passwords
- [ ] Create separate users per service
- [ ] Limit privileges
- [ ] Enable SSL
- [ ] Regular backups

### Redis
```yaml
redis:
  command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
```

**Recommendations:**
- [ ] Set password
- [ ] Disable dangerous commands
- [ ] Use TLS
- [ ] Bind to localhost/internal network only

---

## 🛡️ API Security

### Input Validation
Add validation middleware:
```javascript
import { body, query, validationResult } from 'express-validator';

app.get('/api/traces', 
  query('limit').isInt({ min: 1, max: 1000 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  },
  // ... handler
);
```

### Rate Limiting
```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later'
});

app.use('/api/', limiter);
```

### Security Headers
```javascript
import helmet from 'helmet';
app.use(helmet());
```

### CORS Configuration
```javascript
app.use(cors({
  origin: ['https://tracelens.example.com'],
  credentials: true
}));
```

### SQL Injection Prevention
Current `escSql()` is basic. For production:
- Use parameterized queries where possible
- Implement query whitelisting
- Use least privilege database users
- Regular security audits

---

## 🐳 Container Security

### Dockerfile Best Practices
```dockerfile
FROM node:18-alpine
WORKDIR /app

# Run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 4000
CMD ["node", "index.js"]
```

### Docker Compose Security
```yaml
services:
  api:
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
```

### Image Scanning
```bash
# Scan images
docker scan observability-platform-query-api
trivy image observability-platform-query-api
```

### Recommendations
- [ ] Use non-root users
- [ ] Read-only filesystems where possible
- [ ] Drop all capabilities
- [ ] Use minimal base images (alpine)
- [ ] Scan for vulnerabilities
- [ ] Keep images updated
- [ ] Use multi-stage builds

---

## 📊 Monitoring & Auditing

### Logging
- Log all authentication attempts
- Log API access
- Log database queries (sensitive operations)
- Use structured logging
- Centralize logs

### Audit Trail
Track:
- User actions
- Configuration changes
- Data access
- Failed authentication
- API calls

### Security Monitoring
- Monitor for brute force attempts
- Alert on unusual access patterns
- Track failed queries
- Monitor resource usage anomalies

### Tools
- **Fail2ban** - Intrusion prevention
- **Wazuh** - Security monitoring
- **Prometheus + Grafana** - Metrics
- **ELK Stack** - Log analysis

---

## 🚨 Incident Response

### Preparation
1. **Document procedures** - Incident response plan
2. **Identify contacts** - On-call rotation
3. **Backup strategy** - Regular backups
4. **Access control** - Emergency access procedures

### Response Steps
1. **Detect** - Identify security incident
2. **Contain** - Isolate affected systems
3. **Eradicate** - Remove threat
4. **Recover** - Restore normal operations
5. **Lessons Learned** - Post-incident review

### Emergency Actions
```bash
# Block IP
iptables -A INPUT -s MALICIOUS_IP -j DROP

# Stop services
docker compose down

# Check logs
docker compose logs > incident-$(date +%Y%m%d).log

# Rotate credentials
# Update all passwords/keys
```

---

## ✅ Security Checklist

### Pre-Deployment
- [ ] Change all default passwords
- [ ] Generate strong secrets
- [ ] Remove mock fallbacks
- [ ] Enable authentication
- [ ] Configure TLS/HTTPS
- [ ] Set up firewall
- [ ] Review CORS settings
- [ ] Enable security headers
- [ ] Scan containers for vulnerabilities
- [ ] Test security controls

### Post-Deployment
- [ ] Monitor logs regularly
- [ ] Update dependencies
- [ ] Rotate secrets periodically
- [ ] Backup regularly
- [ ] Review access logs
- [ ] Conduct security audits
- [ ] Test incident response
- [ ] Keep systems patched

### Ongoing
- [ ] Security training
- [ ] Dependency updates
- [ ] Vulnerability scanning
- [ ] Penetration testing
- [ ] Compliance checks

---

## 📚 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Docker Security Best Practices](https://docs.docker.com/engine/security/)
- [Node.js Security Checklist](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)
- [ClickHouse Security](https://clickhouse.com/docs/en/operations/security/)
- [Kubernetes Security](https://kubernetes.io/docs/concepts/security/)

---

<div align="center">

**[← Back to Docs](../README.md)** | **[Development Guide →](../development/local-development.md)**

</div>
