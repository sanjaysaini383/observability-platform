/**
 * Builds a one-shot shutdown handler for SIGINT / SIGTERM.
 *
 * Order matters: stop the flush timer, stop the consumer so no new messages
 * arrive, flush what is buffered, then disconnect and exit. A second signal
 * while shutting down is ignored.
 */
export function createShutdown({ stopTimer, consumer, flush, exit = process.exit, log = console.log }) {
  let running = false;

  return async function shutdown(signal) {
    if (running) return;
    running = true;

    log(`\n⏹️  ${signal} received, shutting down consumer...`);
    let code = 0;
    try {
      stopTimer();
      await consumer.stop();
      await flush();
    } catch (error) {
      code = 1;
      console.error('Error during shutdown:', error.message);
    }
    try {
      await consumer.disconnect();
    } catch (error) {
      code = 1;
      console.error('Error disconnecting consumer:', error.message);
    }
    log('✓ Consumer stopped');
    exit(code);
  };
}
