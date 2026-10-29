FROM node:20-alpine

WORKDIR /app

COPY query-api/package*.json ./
RUN npm install --omit=dev

COPY query-api/index.js query-api/helpers.js ./
COPY shared /shared

ENV PORT=4000
ENV CLICKHOUSE_URL=http://clickhouse:8123
ENV REDIS_URL=redis://redis:6379

EXPOSE 4000

CMD ["node", "index.js"]
