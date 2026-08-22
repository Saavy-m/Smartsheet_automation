const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const config = require('../../config');
const { withRetry, isRetryableHttpError } = require('../utils/retry');

class GraphClient {
  constructor({ tenantId = config.graph.tenantId, clientId = config.graph.clientId, clientSecret = config.graph.clientSecret, oneDriveUserId = config.graph.oneDriveUserId, log } = {}) {
    this.credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    this.oneDriveUserId = oneDriveUserId;
    this.log = log;
    this.client = Client.initWithMiddleware({
      authProvider: {
        getAccessToken: async () => this.getAccessToken()
      }
    });
  }

  async getAccessToken() {
    const token = await this.credential.getToken('https://graph.microsoft.com/.default');
    return token.token;
  }

  async request(method, path, { body, headers, raw = false } = {}) {
    return withRetry(
      async () => {
        const token = await this.getAccessToken();
        const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...headers
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });

        if (raw) {
          if (!response.ok) {
            const text = await response.text();
            const error = new Error(text || `Graph ${method} ${path} failed`);
            error.status = response.status;
            throw error;
          }
          return response;
        }

        const text = await response.text();
        const data = text ? JSON.parse(text) : null;

        if (!response.ok) {
          const error = new Error(data?.error?.message || `Graph ${method} ${path} failed`);
          error.status = response.status;
          error.details = data;
          throw error;
        }

        return { data, headers: response.headers, status: response.status };
      },
      {
        shouldRetry: isRetryableHttpError,
        onRetry: (error, attempt) => {
          if (this.log) {
            this.log.warn({ err: error, attempt, path, method }, 'retrying Graph request');
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

  async patch(path, body, options = {}) {
    return this.request('PATCH', path, { ...options, body });
  }

  async delete(path, options) {
    return this.request('DELETE', path, options);
  }

  async getMessage(mailboxUserId, messageId) {
    return this.get(`/users/${encodeURIComponent(mailboxUserId)}/messages/${encodeURIComponent(messageId)}`);
  }

  async listSubscriptions() {
    return this.get('/subscriptions');
  }

  async updateSubscription(subscriptionId, { expirationDateTime }) {
    return this.patch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { expirationDateTime });
  }

  async createSubscription({ mailboxUserId, callbackUrl, clientState, expirationDateTime }) {
    return this.post('/subscriptions', {
      changeType: 'created',
      notificationUrl: callbackUrl,
      resource: `/users/${mailboxUserId}/mailFolders('Inbox')/messages`,
      expirationDateTime,
      clientState
    });
  }

  async resolveDriveItemByPath(path) {
    const normalized = path.replace(/^\/+|\/+$/g, '');
    return this.get(`/users/${encodeURIComponent(this.oneDriveUserId)}/drive/root:/${encodeGraphPath(normalized)}`);
  }

  async copyDriveItem({ itemId, parentReferenceId, name }) {
    return this.post(`/users/${encodeURIComponent(this.oneDriveUserId)}/drive/items/${encodeURIComponent(itemId)}/copy`, {
      parentReference: { id: parentReferenceId },
      name
    });
  }

  async patchDriveItem(itemId, body) {
    return this.patch(`/users/${encodeURIComponent(this.oneDriveUserId)}/drive/items/${encodeURIComponent(itemId)}`, body);
  }

  async sendMail({ fromUserId, to, subject, html }) {
    const recipients = normalizeRecipients(to);
    return this.post(`/users/${encodeURIComponent(fromUserId)}/sendMail`, {
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: recipients.map((address) => ({ emailAddress: { address } }))
      },
      saveToSentItems: true
    });
  }

  async download(url) {
    return withRetry(async () => {
      const response = await fetch(url);
      if (!response.ok) {
        const error = new Error(`Download failed: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return Buffer.from(await response.arrayBuffer());
    }, { shouldRetry: isRetryableHttpError });
  }
}

function encodeGraphPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function normalizeRecipients(value) {
  const recipients = (Array.isArray(value) ? value : String(value || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error('sendMail requires at least one recipient');
  }

  return recipients;
}

function createGraphClient(options) {
  return new GraphClient(options);
}

function createMailboxGraphClient(options = {}) {
  return new GraphClient({
    tenantId: config.graph.mailTenantId,
    clientId: config.graph.mailClientId,
    clientSecret: config.graph.mailClientSecret,
    oneDriveUserId: config.graph.oneDriveUserId,
    ...options
  });
}

function createOneDriveGraphClient(options = {}) {
  return new GraphClient({
    tenantId: config.graph.oneDriveTenantId,
    clientId: config.graph.oneDriveClientId,
    clientSecret: config.graph.oneDriveClientSecret,
    oneDriveUserId: config.graph.oneDriveUserId,
    ...options
  });
}

module.exports = { GraphClient, createGraphClient, createMailboxGraphClient, createOneDriveGraphClient };
