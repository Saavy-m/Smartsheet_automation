// Step 00 receives the Graph mailbox webhook, validates the notification, parses the forwarded Smartsheet alert email,
// confirms the project against the Master Project List, and starts the orchestrator with the normalized project context.
// Helper functions extract email fields, normalize project type, validate webhook state, and read matching master-list cells.

const crypto = require('crypto');
const config = require('../../config');
const { createSmartsheetClient } = require('../clients/smartsheetClient');
const { createMailboxGraphClient, createOneDriveGraphClient } = require('../clients/graphClient');
const { childLogger } = require('../utils/logger');

const GRAPH_SUBSCRIPTION_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerSubscription({ graph = createMailboxGraphClient(), log, callbackUrl = config.graph.callbackUrl, clientState = config.graph.clientState, expirationDateTime } = {}) {
  const subscriptionExpiration = expirationDateTime || new Date(Date.now() + GRAPH_SUBSCRIPTION_TTL_MS).toISOString();
  const resource = mailboxMessageResource(config.graph.mailboxUserId);
  const existingSubscription = await findSubscription({ graph, resource, callbackUrl });

  if (existingSubscription) {
    const response = await graph.updateSubscription(existingSubscription.id, { expirationDateTime: subscriptionExpiration });

    if (log) {
      log.info({ subscriptionId: response.data.id, expirationDateTime: response.data.expirationDateTime }, 'renewed Graph mailbox subscription');
    }

    return response.data;
  }

  const response = await graph.createSubscription({
    mailboxUserId: config.graph.mailboxUserId,
    callbackUrl,
    clientState,
    expirationDateTime: subscriptionExpiration
  });

  if (log) {
    log.info({ subscriptionId: response.data.id, expirationDateTime: subscriptionExpiration }, 'registered Graph mailbox subscription');
  }

  return response.data;
}

async function findSubscription({ graph, resource, callbackUrl }) {
  const response = await graph.listSubscriptions();
  return (response.data?.value || []).find((subscription) => (
    subscription.resource === resource && subscription.notificationUrl === callbackUrl
  ));
}

function mailboxMessageResource(mailboxUserId) {
  return `/users/${mailboxUserId}/mailFolders('Inbox')/messages`;
}

async function handleGraphWebhook(req, res, dependencies = {}) {
  if (req.query.validationToken) {
    res.status(200).type('text/plain').send(req.query.validationToken);
    return;
  }

  const notifications = req.body?.value || [];
  res.sendStatus(202);

  for (const notification of notifications) {
    await processNotification(notification, dependencies);
  }
}

async function processNotification(notification, dependencies = {}) {
  validateClientState(notification.clientState);

  const mailGraph = dependencies.mailGraph || dependencies.graph || createMailboxGraphClient();
  const oneDriveGraph = dependencies.oneDriveGraph || createOneDriveGraphClient();
  const smartsheet = dependencies.smartsheet || createSmartsheetClient();
  const orchestrator = dependencies.orchestrator || require('../orchestrator');
  const messageId = notification.resourceData?.id || extractMessageId(notification.resource);

  if (!messageId) {
    throw new Error('Graph notification did not include a message id');
  }

  const message = (await mailGraph.getMessage(config.graph.mailboxUserId, messageId)).data;
  const parsed = parseProjectDetailsFromEmail(message.body?.content || '');
  const runId = `${parsed.projectNumber}-${crypto.randomUUID()}`;

  const ctx = {
    ...parsed,
    runId,
    sheetIds: {},
    folderIds: {},
    reportIds: {},
    publishedUrls: {},
    checklistRowMap: {},
    stepStatus: {},
    clients: { smartsheet, mailGraph, oneDriveGraph }
  };
  ctx.log = childLogger(ctx, 'trigger');

  const automationStartDelayMs = dependencies.automationStartDelayMs ?? config.automationStartDelayMs;
  if (automationStartDelayMs > 0) {
    ctx.log.info({ delaySeconds: automationStartDelayMs / 1000 }, 'delaying project spin-up run after forwarded alert email');
    await (dependencies.delay || delay)(automationStartDelayMs);
  }

  ctx.log.info('starting project spin-up run from forwarded alert email');

  await orchestrator.run(ctx);
}

function validateClientState(clientState) {
  const expected = Buffer.from(config.graph.clientState);
  const actual = Buffer.from(clientState || '');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('Invalid Graph webhook clientState');
  }
}

function extractMessageId(resource = '') {
  const match = resource.match(/messages\/?\('?([^')/]+)'?\)?$/i);
  return match?.[1];
}

function parseProjectDetailsFromEmail(html) {
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

  const fieldLabels = [
    'Project Number',
    'Project Name',
    'Project Dashboard',
    'Hourly or Flat Rate',
    'Project Vertical',
    'Project Type',
    'Vertical',
    'Project Plan',
    'Comments',
    'Bypass Deposit on Project start',
    'Is this a Paterson Project',
    'Changes made by'
  ];

  const projectName = extractField(text, 'Project Name', fieldLabels);
  const projectNumber = extractField(text, 'Project Number', fieldLabels);
  const projectDashboardUrl = extractField(text, 'Project Dashboard', fieldLabels);
  const patersonProject = extractField(text, 'Is this a Paterson Project', fieldLabels);
  const projectVertical = config.projectTypeEmailLabels
    .map((label) => extractField(text, label, fieldLabels))
    .find(Boolean);
  const projectType = determineProjectType({ patersonProject, projectVertical });

  if (!projectName || !projectNumber || !projectType) {
    throw new Error('Could not parse Project Name, Project Number, and Project Type from forwarded alert email');
  }

  return { projectName, projectNumber, projectVertical, projectType: normalizeProjectType(projectType), patersonProject, projectDashboardUrl };
}

function extractField(text, label, fieldLabels = []) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nextLabels = fieldLabels
    .filter((candidate) => candidate.toLowerCase() !== label.toLowerCase())
    .map((candidate) => candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const boundary = nextLabels.length ? `(?=\\s*(?:${nextLabels.join('|')})|$)` : '$';
  const match = text.match(new RegExp(`${escaped}\\s*[:|-]?\\s*(.*?)${boundary}`, 'i'));
  return match?.[1]?.trim() || '';
}

function determineProjectType({ patersonProject, projectVertical }) {
  if (isAffirmative(patersonProject)) {
    return 'Patterson';
  }
  return normalizeProjectType(projectVertical);
}

function isAffirmative(value) {
  return /^(yes|y|true)$/i.test(String(value || '').trim());
}

async function confirmProjectOnMasterList({ smartsheet, parsed }) {
  if (isPlaceholder(config.smartsheet.masterProjectListSheetId)) {
    throw new Error('SMARTSHEET_MASTER_PROJECT_LIST_SHEET_ID must be set to the real Project List sheet ID before webhook-triggered runs can confirm projects');
  }

  const sheet = (await smartsheet.get(`/sheets/${config.smartsheet.masterProjectListSheetId}`)).data;
  const columns = columnsByTitle(sheet);
  const numberColumn = columns[config.columns.masterProjectNumber];
  const nameColumn = columns[config.columns.masterProjectName];

  if (!numberColumn || !nameColumn) {
    throw new Error('Master Project List is missing one or more configured project columns');
  }

  const row = (sheet.rows || []).find((candidate) => {
    return String(cellValue(candidate, numberColumn.id) || '').trim() === String(parsed.projectNumber).trim();
  });

  if (!row) {
    throw new Error(`Project ${parsed.projectNumber} was not found on the Master Project List`);
  }

  const projectName = cellValue(row, nameColumn.id) || parsed.projectName;

  return {
    projectName,
    projectNumber: parsed.projectNumber,
    projectType: parsed.projectType,
    patersonProject: parsed.patersonProject,
    projectDashboardUrl: parsed.projectDashboardUrl,
    masterProjectListSheetId: config.smartsheet.masterProjectListSheetId,
    masterProjectRowId: row.id
  };
}

function isPlaceholder(value) {
  return !value || /^replace-me$/i.test(String(value).trim());
}

function normalizeProjectType(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('Project Type is blank on the Master Project List row');
  }
  if (/^patterson$/i.test(normalized)) return 'Patterson';
  if (/^commercial$/i.test(normalized)) return 'Commercial';
  if (/^(residential|residentail)$/i.test(normalized)) return 'Residential';
  return normalized;
}

function columnsByTitle(sheetOrColumns) {
  const columns = Array.isArray(sheetOrColumns) ? sheetOrColumns : sheetOrColumns.columns || [];
  return Object.fromEntries(columns.map((column) => [column.title, column]));
}

function cellValue(row, columnId) {
  const cell = (row.cells || []).find((item) => item.columnId === columnId);
  return cell?.displayValue ?? cell?.value;
}

module.exports = {
  confirmProjectOnMasterList,
  handleGraphWebhook,
  determineProjectType,
  parseProjectDetailsFromEmail,
  processNotification,
  registerSubscription,
  run: processNotification
};
