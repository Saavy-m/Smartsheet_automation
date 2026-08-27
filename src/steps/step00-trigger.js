// Step 00 receives the Graph mailbox webhook, validates the notification, parses the forwarded Smartsheet alert email,
// confirms the project against the Master Project List, and starts the orchestrator with the normalized project context.
// Helper functions extract email fields, normalize project type, validate webhook state, and read matching master-list cells.

const crypto = require('crypto');
const config = require('../../config');
const { createSmartsheetClient } = require('../clients/smartsheetClient');
const { createMailboxGraphClient, createOneDriveGraphClient } = require('../clients/graphClient');
const { childLogger, logger } = require('../utils/logger');

const GRAPH_SUBSCRIPTION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const EMAIL_BODY_LOG_MAX_LENGTH = 8000;
const SMARTSHEET_AUTOMATION_EMAIL = 'automation@app.smartsheet.com';

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
    try {
      await processNotification(notification, dependencies);
    } catch (error) {
      const logPayload = {
        err: error,
        messageId: notification.resourceData?.id || extractMessageId(notification.resource),
        resource: notification.resource
      };

      if (isNonProjectAlertEmailError(error)) {
        logger.warn(logPayload, 'skipping mailbox message that is not a project spin-up alert');
        continue;
      }

      logger.error(logPayload, 'failed to process Graph mailbox notification');
    }
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
  logReceivedMailboxMessage(message, messageId);
  const parsed = parseProjectDetailsFromMessage(message);
  const confirmedProject = await confirmProjectOnMasterList({ smartsheet, parsed });
  const runId = `${confirmedProject.projectNumber}-${crypto.randomUUID()}`;

  const ctx = {
    ...parsed,
    ...confirmedProject,
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
  const normalizedText = normalizeEmailText(html);
  const text = projectDetailsText(normalizedText);

  const fieldLabelGroups = [
    ['Project Number'],
    ['Project Name'],
    ['Project Dashboard'],
    ['Hourly or Flat Rate'],
    ['Project Vertical', 'Project Type', 'Vertical', 'Project Plan'],
    ['Comments'],
    ['Bypass Deposit on Project start'],
    ['Is this a Paterson Project'],
    ['Changes made by']
  ];
  const fields = extractOrderedFields(text, fieldLabelGroups);
  const masterProjectRowNumber = extractProjectListRowNumber(text) || extractProjectListRowNumber(normalizedText);

  const projectName = fields['Project Name'];
  const projectNumber = fields['Project Number'];
  const projectDashboardUrl = fields['Project Dashboard'];
  const patersonProject = fields['Is this a Paterson Project'];
  const projectVertical = config.projectTypeEmailLabels
    .map((label) => fields[label])
    .find(Boolean);
  const projectType = projectVertical ? normalizeProjectType(projectVertical) : '';

  if (!projectName || !projectType) {
    throw new NonProjectAlertEmailError('Could not parse Project Name, Project Number, and Project Type from forwarded alert email', {
      missingFields: [
        !projectName && 'Project Name',
        !projectType && 'Project Type'
      ].filter(Boolean)
    });
  }

  return { projectName, projectNumber, masterProjectRowNumber, projectVertical, projectType: normalizeProjectType(projectType), patersonProject, projectDashboardUrl };
}

function parseProjectDetailsFromMessage(message) {
  try {
    return parseProjectDetailsFromEmail(message.body?.content || '');
  } catch (error) {
    if (isNonProjectAlertEmailError(error) && isSmartsheetAutomationMessage(message)) {
      error.name = 'ProjectAlertParseError';
      error.code = 'PROJECT_ALERT_PARSE_FAILED';
      error.from = emailAddress(message.from);
      error.sender = emailAddress(message.sender);
    }
    throw error;
  }
}

function logReceivedMailboxMessage(message, messageId) {
  logger.info({
    messageId,
    internetMessageId: message.internetMessageId,
    conversationId: message.conversationId,
    subject: message.subject,
    from: emailAddress(message.from),
    sender: emailAddress(message.sender),
    receivedDateTime: message.receivedDateTime,
    bodyPreview: message.bodyPreview,
    bodyContentType: message.body?.contentType,
    bodyText: truncateForLog(normalizeEmailText(message.body?.content || ''), EMAIL_BODY_LOG_MAX_LENGTH)
  }, 'received Graph mailbox message');
}

function normalizeEmailText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function projectDetailsText(text) {
  const rowMatches = Array.from(String(text || '').matchAll(/\bRow\s+\d+\s+Project\s+(?:Number|Name)\b/gi));
  const rowMatch = rowMatches.at(-1);
  if (rowMatch) {
    return text.slice(rowMatch.index).replace(/^Row\s+\d+\s+/i, '').trim();
  }

  const detailsIndex = text.toLowerCase().lastIndexOf('project list details');
  if (detailsIndex >= 0) {
    return text.slice(detailsIndex).trim();
  }

  return text;
}

function extractProjectListRowNumber(text) {
  const rowMatches = Array.from(String(text || '').matchAll(/\bRow\s+(\d+)\s+Project\s+(?:Number|Name)\b/gi));
  const rowNumber = rowMatches.at(-1)?.[1];
  return rowNumber ? Number(rowNumber) : null;
}

function isSmartsheetAutomationMessage(message) {
  const addresses = [emailAddress(message.from), emailAddress(message.sender)];
  return addresses.some((address) => address.toLowerCase() === SMARTSHEET_AUTOMATION_EMAIL);
}

function emailAddress(value) {
  return value?.emailAddress?.address || value?.emailAddress?.name || '';
}

function truncateForLog(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}

function extractOrderedFields(text, fieldLabelGroups = []) {
  const fields = {};
  let cursor = 0;

  for (let index = 0; index < fieldLabelGroups.length; index += 1) {
    const labelMatch = findNextLabel(text, fieldLabelGroups[index], cursor);
    if (!labelMatch) {
      continue;
    }

    const nextMatch = findNextLabel(text, fieldLabelGroups[index + 1] || [], labelMatch.valueStart);
    const valueEnd = nextMatch?.index ?? text.length;
    const value = text.slice(labelMatch.valueStart, valueEnd).trim();
    for (const label of fieldLabelGroups[index]) {
      fields[label] = value;
    }
    cursor = valueEnd;
  }

  return fields;
}

function findNextLabel(text, labels = [], startIndex = 0) {
  let best = null;
  for (const label of labels) {
    const pattern = new RegExp(`\\b${escapeRegExp(label)}\\b\\s*[:|-]?\\s*`, 'i');
    const match = pattern.exec(text.slice(startIndex));
    if (!match) {
      continue;
    }
    const index = startIndex + match.index;
    if (!best || index < best.index) {
      best = { label, index, valueStart: index + match[0].length };
    }
  }
  return best;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  const row = findMasterProjectRow(sheet, numberColumn, nameColumn, parsed);

  if (!row) {
    throw new Error(masterProjectNotFoundMessage(parsed));
  }

  const projectName = cellValue(row, nameColumn.id) || parsed.projectName;
  const projectNumber = cellValue(row, numberColumn.id) || parsed.projectNumber;

  if (!projectNumber) {
    throw new Error(`Master Project List row ${row.rowNumber} is missing ${config.columns.masterProjectNumber}`);
  }

  return {
    projectName,
    projectNumber: String(projectNumber).trim(),
    projectType: parsed.projectType,
    patersonProject: parsed.patersonProject,
    projectDashboardUrl: parsed.projectDashboardUrl,
    masterProjectListSheetId: config.smartsheet.masterProjectListSheetId,
    masterProjectRowId: row.id
  };
}

function findMasterProjectRow(sheet, numberColumn, nameColumn, parsed) {
  if (parsed.projectNumber) {
    const expectedProjectNumber = String(parsed.projectNumber).trim();
    const projectNumberMatch = (sheet.rows || []).find((candidate) => {
      return String(cellValue(candidate, numberColumn.id) || '').trim() === expectedProjectNumber;
    });
    if (projectNumberMatch) {
      return projectNumberMatch;
    }
  }

  if (parsed.masterProjectRowNumber) {
    const rowNumberMatch = (sheet.rows || []).find((candidate) => candidate.rowNumber === parsed.masterProjectRowNumber);
    if (rowNumberMatch) {
      return rowNumberMatch;
    }
  }

  return findMasterProjectRowByName(sheet, nameColumn, parsed.projectName);
}

function findMasterProjectRowByName(sheet, nameColumn, projectName) {
  const expectedProjectName = normalizeProjectNameForMatch(projectName);
  if (!expectedProjectName) {
    return null;
  }

  return (sheet.rows || []).find((candidate) => {
    return normalizeProjectNameForMatch(cellValue(candidate, nameColumn.id)) === expectedProjectName;
  }) || null;
}

function normalizeProjectNameForMatch(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function masterProjectNotFoundMessage(parsed) {
  if (parsed.projectNumber) {
    return `Project ${parsed.projectNumber} was not found on the Master Project List by project number, row number, or project name`;
  }
  if (parsed.masterProjectRowNumber) {
    return `Master Project List row ${parsed.masterProjectRowNumber} from the Smartsheet alert was not found by row number or project name`;
  }
  return `Project ${parsed.projectName || ''} was not found on the Master Project List by project name`;
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

class NonProjectAlertEmailError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'NonProjectAlertEmailError';
    this.code = 'NON_PROJECT_ALERT_EMAIL';
    Object.assign(this, details);
  }
}

function isNonProjectAlertEmailError(error) {
  return error?.code === 'NON_PROJECT_ALERT_EMAIL';
}

module.exports = {
  confirmProjectOnMasterList,
  handleGraphWebhook,
  isNonProjectAlertEmailError,
  NonProjectAlertEmailError,
  parseProjectDetailsFromEmail,
  processNotification,
  registerSubscription,
  run: processNotification
};
