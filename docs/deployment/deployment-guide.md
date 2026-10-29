<div align="center">

# 🚀 Deployment Guide

### *Production Deployment Strategies for TraceLens*

[![Deployment](https://img.shields.io/badge/Deployment-Production%20Ready-059669?style=for-the-badge&logo=rocket&logoColor=white)](.)
[![Docker](https://img.shields.io/badge/Docker-Compose%20%7C%20Swarm%20%7C%20K8s-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

*Comprehensive deployment guide for various environments*

</div>

---

## 📑 Table of Contents

- [Deployment Options](#-deployment-options)
- [Pre-Deployment Checklist](#-pre-deployment-checklist)
- [Docker Compose (Single Server)](#-docker-compose-single-server)
- [Docker Swarm](#-docker-swarm)
- [Kubernetes](#-kubernetes)
- [Cloud Deployments](#-cloud-deployments)
- [Reverse Proxy & TLS](#-reverse-proxy--tls)
- [Monitoring & Logging](#-monitoring--logging)
- [Backup & Recovery](#-backup--recovery)
- [Scaling Strategies](#-scaling-strategies)
- [Post-Deployment](#-post-deployment)

---

## 🎯 Deployment Options

| Method | Complexity | Scalability | HA Support | Best For |
|:--------|:-----------|:------------|:-----------|:---------|
| **Docker Compose** | Low | Vertical/Manual Horizontal | Limited | Development, small production |
| **Docker Swarm** | Medium | Good | Yes | Medium-scale deployments |
| **Kubernetes** | High | Excellent | Yes | Enterprise, large-scale |
| **Cloud Managed** | Medium | Excellent | Yes | AWS ECS, GCP Cloud Run, Azure Container Apps |

---

## ✅ Pre-Deployment Checklist

### Infrastructure
- [ ] Server with sufficient resources (8GB RAM, 4 CPU minimum)
- [ ] Linux OS (Ubuntu 22.04 LTS recommended)
- [ ] Docker & Docker Compose installed
- [ ] Domain name configured (for TLS)
- [ ] Firewall configured
- [ ] Backup strategy planned

### Security
- [ ] Change all default passwords
- [ ] Generate strong secrets
- [ ] Configure TLS certificates
- [ ] Set up authentication
- [ ] Review security hardening guide
- [ ] Configure firewall rules

### Configuration
- [ ] Update `.env` with production values
- [ ] Configure resource limits
- [ ] Set restart policies
- [ ] Configure logging
- [ ] Plan for data retention

---

## 🐳 Docker Compose (Single Server)

### Setup
```bash
# Clone repository
git clone https://github.com/sanjaysaini383/observability-platform.git
cd observability-platform/infra

# Configure environment
cp .env.example .env
nano .env  # Edit with production values

# Start services
docker compose up -d --build
```

### Production docker-compose.yml adjustments

```yaml
services:
  clickhouse:
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: '2'
        reservations:
          memory: 2G

  kafka:
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '1'

  # Add restart policies to all services
```

### Enable Auto-Start
```bash
# Create systemd service
sudo nano /etc/systemd/system/tracelens.service
```

```ini
[Unit]
Description=TraceLens Observability Platform
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/observability-platform/infra
ExecStart=/usr/bin/docker compose up -d
# Use stop, not down: orders/inventory have no named volume and `down` deletes PostgreSQL data.
ExecStop=/usr/bin/docker compose stop
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable tracelens
sudo systemctl start tracelens
```

---

## 🐝 Docker Swarm

### Initialize Swarm
```bash
docker swarm init --advertise-addr <YOUR_SERVER_IP>
```

### Create stack file
```bash
docker stack deploy -c docker-compose.prod.yml tracelens
```

### Scale services
```bash
docker service scale tracelens_query-api=3
docker service scale tracelens_kafka-consumer=2
```

### Update service
```bash
docker service update --image tracelens/query-api:latest tracelens_query-api
```

---

## ☸️ Kubernetes

### Prerequisites
- Kubernetes cluster (1.24+)
- kubectl configured
- Helm 3.x (optional)

### Create namespace
```bash
kubectl create namespace observability
```

### Deploy with manifests
```bash
kubectl apply -f k8s/ -n observability
```

### Key Resources Needed
- Deployments for all services
- StatefulSets for Kafka, ClickHouse, PostgreSQL
- Services (ClusterIP/LoadBalancer)
- ConfigMaps for configurations
- Secrets for credentials
- PersistentVolumeClaims for data
- Ingress for external access
- HorizontalPodAutoscaler

### Example Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: query-api
  namespace: observability
spec:
  replicas: 3
  selector:
    matchLabels:
      app: query-api
  template:
    metadata:
      labels:
        app: query-api
    spec:
      containers:
      - name: query-api
        image: tracelens/query-api:latest
        ports:
        - containerPort: 4000
        env:
        - name: CLICKHOUSE_URL
          valueFrom:
            secretKeyRef:
              name: tracelens-secrets
              key: clickhouse-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

---

## ☁️ Cloud Deployments

### AWS (ECS Fargate)
1. Push images to ECR
2. Create ECS cluster
3. Define task definitions
4. Create services
5. Use ALB for load balancing
6. Use RDS for PostgreSQL
7. Use ElastiCache for Redis
8. Use MSK for Kafka or self-host

### Google Cloud (GKE)
```bash
gcloud container clusters create tracelens-cluster
gcloud container clusters get-credentials tracelens-cluster
kubectl apply -f k8s/
```

### Azure (AKS)
```bash
az aks create --resource-group tracelens --name tracelens-cluster
az aks get-credentials --resource-group tracelens --name tracelens-cluster
kubectl apply -f k8s/
```

---

## 🔒 Reverse Proxy & TLS

### Nginx
```nginx
upstream dashboard {
    server localhost:8080;
}

upstream api {
    server localhost:4000;
}

upstream api_gateway {
    server localhost:3000;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    location / {
        proxy_pass http://dashboard;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    location /api {
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Query API health lives at /health, not /api/health.
    location = /health {
        proxy_pass http://api/health;
        proxy_set_header Host $host;
    }

    # Checkout (and other storefront routes) belong to api-gateway, not query-api.
    location /checkout {
        proxy_pass http://api_gateway;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Caddy (Automatic HTTPS)
```caddyfile
yourdomain.com {
    reverse_proxy /api/* localhost:4000
    reverse_proxy /health localhost:4000
    reverse_proxy /checkout localhost:3000
    reverse_proxy localhost:8080
}
```

### Build the Dashboard for Production
`dashboard/src/lib/api.ts` appends `/api` to `VITE_API_URL`, so set it to the public **origin only** (no `/api`, no port):

```bash
cd dashboard
VITE_API_URL=https://yourdomain.com npm run build
```

Or update the `dashboard` build args in `infra/docker-compose.yml` and rebuild:

```yaml
dashboard:
  build:
    context: ../dashboard
    args:
      VITE_API_URL: https://yourdomain.com
```

```bash
cd infra
docker compose build dashboard
docker compose up -d dashboard
```

The default `http://localhost:4000` is only correct when the browser runs on the same machine as the stack.

### Certbot
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

---

## 📊 Monitoring & Logging

### Application Monitoring
- Use Prometheus for metrics
- Use Grafana for dashboards
- Monitor container resources
- Track application metrics

### Log Aggregation
- Use Loki for logs
- Use Fluentd/Fluentbit
- Centralize all container logs

### Health Monitoring
```bash
# Health check script
#!/bin/bash
curl -f http://localhost:4000/health || exit 1
curl -f http://localhost:8080 || exit 1
```

---

## 💾 Backup & Recovery

### ClickHouse Backup
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker run --rm \
  -v infra_clickhouse_data:/data \
  -v /backups:/backup \
  alpine tar czf /backup/clickhouse_$DATE.tar.gz -C /data .
```

### PostgreSQL Backup
```bash
docker compose exec postgres pg_dump -U default orders | gzip > /backups/postgres_$(date +%Y%m%d).sql.gz
```

### Restore
```bash
# Restore ClickHouse
docker run --rm \
  -v infra_clickhouse_data:/data \
  -v /backups:/backup \
  alpine sh -c "cd /data && tar xzf /backup/clickhouse_YYYYMMDD_HHMMSS.tar.gz"
```

### Backup Schedule (Cron)
```bash
0 2 * * * /opt/scripts/backup.sh
```

---

## 📈 Scaling Strategies

### Horizontal Scaling
| Component | Method | Notes |
|:-----------|:--------|:-------|
| **Query API** | Multiple replicas | Behind load balancer |
| **Kafka Consumers** | Scale to partition count | One per partition max |
| **OTel Collectors** | Multiple instances | Behind LB or client-side |
| **Dashboard** | CDN + replicas | Static assets to CDN |

### Vertical Scaling
- Increase CPU/Memory for ClickHouse
- Increase memory for Kafka
- Optimize resource allocation

### Database Scaling
- ClickHouse: Sharding + Replication
- PostgreSQL: Read replicas
- Redis: Cluster mode

---

## 🚀 Post-Deployment

### Verification
```bash
# Check all services
docker compose ps

# Test endpoints
curl https://yourdomain.com/health
curl https://yourdomain.com

# Seed demo data (POST only; a GET returns 404)
curl -X POST http://localhost:5000/init
curl -X POST http://localhost:5001/init

# Generate test traffic through the proxy
curl -X POST https://yourdomain.com/checkout \
  -H "Content-Type: application/json" \
  -d '{"items":[{"productId":1,"qty":1}]}'
```

### Monitoring Setup
- [ ] Set up uptime monitoring (UptimeRobot, Pingdom)
- [ ] Configure alerts
- [ ] Set up log aggregation
- [ ] Monitor disk space
- [ ] Monitor resource usage

### Maintenance
- [ ] Schedule updates
- [ ] Monitor security advisories
- [ ] Review logs regularly
- [ ] Test backups
- [ ] Update SSL certificates (auto-renew with Certbot)

---

<div align="center">

**[← Back to Docs](../../README.md)** | **[Local Development →](../development/local-development.md)**

</div>
