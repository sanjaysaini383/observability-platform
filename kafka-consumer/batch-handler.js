/**
 * kafkajs `eachBatch` handler that writes each fetched batch to ClickHouse and
 * only resolves a message's offset once the rows parsed from it (and from every
 * message before it) have been inserted. If an insert throws, the error
 * propagates to kafkajs, which commits only the resolved offsets and delivers
 * the rest again — at-least-once, so a ClickHouse outage never drops spans.
 *
 * Kept free of Kafka/ClickHouse connections so it can be unit tested.
 * Must be run with `eachBatchAutoResolve: false`.
 *
 * @param {object} options
 * @param {Record<string, {parse: (value: Buffer) => object[], insert: (rows: object[]) => Promise<void>}>} options.handlers
 *   per-topic parser and ClickHouse insert function
 * @param {number} options.batchSize insert once at least this many rows are pending
 */
export function createBatchHandler({ handlers, batchSize }) {
  return async ({ batch, resolveOffset, heartbeat, isRunning, isStale, commitOffsetsIfNecessary }) => {
    const { parse, insert } = handlers[batch.topic];
    let rows = [];
    let lastOffset = null;

    const flush = async () => {
      if (rows.length > 0) await insert(rows);
      if (lastOffset !== null) resolveOffset(lastOffset);
      rows = [];
      lastOffset = null;
    };

    for (const message of batch.messages) {
      // Stopping or rebalancing: leave the rest unresolved so it is re-delivered.
      if (!isRunning() || isStale()) return;

      rows.push(...parse(message.value));
      lastOffset = message.offset;

      if (rows.length >= batchSize) {
        await flush();
        await heartbeat();
      }
    }

    await flush();
    await commitOffsetsIfNecessary();
  };
}
