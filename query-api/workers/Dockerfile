FROM node:20-alpine

WORKDIR /app

COPY query-api/workers/trace-analyser.js .
COPY shared /shared

# Create a minimal package.json for the worker
RUN echo '{"name":"trace-analyser","version":"1.0.0","type":"module","dependencies":{"axios":"^1.6.2","dotenv":"^16.3.1"}}' > package.json && \
    npm install --production

ENV CLICKHOUSE_URL=http://clickhouse:8123
ENV OLLAMA_URL=http://ollama:11434
ENV MODEL=llama3
ENV ANALYSIS_INTERVAL=60000

CMD ["node", "trace-analyser.js"]
