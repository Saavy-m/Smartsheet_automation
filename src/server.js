const express = require('express');
const config = require('../config');
const { logger } = require('./utils/logger');
const trigger = require('./steps/step00-trigger');
const projectSpinUpApi = require('./routes/projectSpinUpApi');

const app = express();
app.use(express.json({ limit: '1mb', type: shouldParseJsonBody }));

const WEBHOOK_REGISTRATION_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/webhooks/graph/messages', async (req, res, next) => {
  try {
    await trigger.handleGraphWebhook(req, res);
  } catch (error) {
    next(error);
  }
});

app.use('/api/project-spin-up', projectSpinUpApi);

app.post('/webhooks/graph/register', async (req, res, next) => {
  try {
    const subscription = await trigger.registerSubscription({
      log: logger,
      callbackUrl: req.body?.notificationUrl,
      clientState: req.body?.clientState,
      expirationDateTime: req.body?.expirationDateTime
    });
    res.status(201).json(subscription);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  logger.error({ err: error }, 'request failed');
  if (res.headersSent) {
    next(error);
    return;
  }
  const body = { error: error.message };
  if (error.automationReport) {
    body.automationReport = error.automationReport;
  }
  res.status(error.status || 500).json(body);
});

if (require.main === module) {
  app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Smartsheet project spin-up service listening');
    startWebhookRegistrationSchedule();
  });
}

module.exports = { app };

function shouldParseJsonBody(req) {
  const contentType = req.headers['content-type'];
  if (!contentType) {
    return true;
  }
  return /^(application\/json|application\/[^;]+\+json|text\/plain)(;|$)/i.test(contentType);
}

function startWebhookRegistrationSchedule() {
  registerConfiguredWebhook();
  const interval = setInterval(registerConfiguredWebhook, WEBHOOK_REGISTRATION_INTERVAL_MS);
  interval.unref?.();
}

async function registerConfiguredWebhook() {
  try {
    const subscription = await trigger.registerSubscription({ log: logger });
    logger.info({ subscriptionId: subscription.id, notificationUrl: config.graph.callbackUrl }, 'Graph webhook subscription is set');
  } catch (error) {
    logger.error({ err: error, notificationUrl: config.graph.callbackUrl }, 'failed to set Graph webhook subscription');
  }
}
