async function pollAsyncOperation({ poll, isComplete, intervalMs = 2000, timeoutMs = 300000, log }) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await poll();
    if (isComplete(result)) {
      return result;
    }

    if (log) {
      log.info({ elapsedMs: Date.now() - startedAt }, 'async operation still pending');
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Async operation did not complete within ${timeoutMs}ms`);
}

module.exports = { pollAsyncOperation };
