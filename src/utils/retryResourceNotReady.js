const DEFAULT_RETRIES = 2;
const DEFAULT_DELAY_MS = 60 * 1000;

async function retryResourceNotReady(fn, { log, resourceName = 'resource', retries = DEFAULT_RETRIES, delayMs = DEFAULT_DELAY_MS } = {}) {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isResourceNotReadyError(error)) {
        throw error;
      }

      attempt += 1;
      log?.warn({ err: error, resourceName, retryAttempt: attempt, maxRetries: retries, delaySeconds: delayMs / 1000 }, 'resource not ready; retrying');
      await delay(delayMs);
    }
  }
}

function isResourceNotReadyError(error) {
  const status = error.statusCode || error.status || error.code;
  if (status === 404) {
    return true;
  }

  return /could not find|not found|no update-filter reports found/i.test(error.message || '');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { retryResourceNotReady };