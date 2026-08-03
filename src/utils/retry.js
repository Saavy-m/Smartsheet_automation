async function withRetry(fn, options = {}) {
  const {
    retries = 4,
    minDelayMs = 500,
    maxDelayMs = 8000,
    factor = 2,
    shouldRetry = () => true,
    onRetry = () => {}
  } = options;

  let attempt = 0;
  let delay = minDelayMs;

  while (true) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) {
        throw error;
      }

      attempt += 1;
      onRetry(error, attempt);
      const jitter = Math.floor(Math.random() * 150);
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay + jitter, maxDelayMs)));
      delay *= factor;
    }
  }
}

function isRetryableHttpError(error) {
  const status = error.statusCode || error.status || error.code;
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status < 600);
}

module.exports = { withRetry, isRetryableHttpError };
