FROM node:20-alpine

WORKDIR /app

COPY query-api/workers/package*.json ./
RUN npm ci --omit=dev

COPY query-api/workers/trace-analyser.js .
COPY shared /shared

ENV CLICKHOUSE_URL=http://clickhouse:8123
ENV OLLAMA_URL=http://ollama:11434
ENV MODEL=llama3
ENV ANALYSIS_INTERVAL=60000

CMD ["node", "trace-analyser.js"]
