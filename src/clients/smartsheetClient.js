const smartsheet = require('smartsheet');
const config = require('../../config');
const { withRetry, isRetryableHttpError } = require('../utils/retry');

class SmartsheetClient {
  constructor({ token = config.smartsheet.token, changeAgent = config.smartsheet.changeAgent, log } = {}) {
    this.token = token;
    this.changeAgent = changeAgent;
    this.log = log;
    this.sdk = smartsheet.createClient({ accessToken: token, logLevel: 'error' });
  }

  async request(method, path, { query, body, headers } = {}) {
    const url = new URL(`https://api.smartsheet.com/2.0${path}`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });

    return withRetry(
      async () => {
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'Smartsheet-Change-Agent': this.changeAgent,
            ...headers
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });

        const text = await response.text();
        const data = text ? JSON.parse(text) : null;

        if (!response.ok) {
          const error = new Error(data?.message || `Smartsheet ${method} ${path} failed`);
          error.status = response.status;
          error.details = data;
          throw error;
        }

        return {
          data,
          headers: response.headers,
          status: response.status
        };
      },
      {
        shouldRetry: isRetryableHttpError,
        onRetry: (error, attempt) => {
          if (this.log) {
            this.log.warn({ err: error, attempt, path, method }, 'retrying Smartsheet request');
          }
        }
      }
    );
  }

  async get(path, options) {
    return this.request('GET', path, options);
  }

  async post(path, body, options = {}) {
    return this.request('POST', path, { ...options, body });
  }

  async put(path, body, options = {}) {
    return this.request('PUT', path, { ...options, body });
  }

  async delete(path, options) {
    return this.request('DELETE', path, options);
  }
}

function createSmartsheetClient(options) {
  return new SmartsheetClient(options);
}

module.exports = { SmartsheetClient, createSmartsheetClient };
