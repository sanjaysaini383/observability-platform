FROM node:20-alpine

WORKDIR /app

COPY kafka-consumer/package*.json ./
RUN npm install --omit=dev

COPY kafka-consumer/index.js kafka-consumer/otlp-parser.js ./
COPY shared /shared

ENV KAFKA_BROKERS=kafka:9092
ENV CLICKHOUSE_URL=http://clickhouse:8123

CMD ["node", "index.js"]
