// Step 03 updates configured Smartsheet report definitions with the project number while preserving report IDs.
// run() loads the project root folder, finds update-filter reports, renames them, replaces account-number placeholders, and records IDs.
// Helper functions discover reports, match report templates, build names, replace placeholders recursively, and identify the Orders report.

const config = require('../../config');
const { childLogger } = require('../utils/logger');
const { retryResourceNotReady } = require('../utils/retryResourceNotReady');

const REPORT_DEFINITION_READ_ONLY_FIELDS = new Set(['defaultType', 'forceNullsToBottom', 'id']);

async function run(ctx) {
  const log = childLogger(ctx, 'step03');
  const smartsheet = ctx.clients.smartsheet;
  const projectRootFolder = await loadProjectRootFolder(smartsheet, ctx);
  const reportMatches = await retryResourceNotReady(
    () => findRequiredConfiguredReports(smartsheet, projectRootFolder, ctx),
    { log, resourceName: 'update-filter reports' }
  );
  const filterFailures = [];

  ctx.reportIds.updatedReports = [];

  for (const report of reportMatches) {
    const reportId = report.id;
    const reportName = report.name;
    const updatedName = await renameReport({ smartsheet, log, reportId, reportName, ctx });
    const updatedReport = { beforeId: reportId, beforeName: reportName, afterId: reportId, afterName: updatedName, renamed: updatedName !== reportName, filterUpdated: false };
    ctx.reportIds.updatedReports.push(updatedReport);

    try {
      const reportDefinition = (await smartsheet.get(`/reports/${reportId}/definition`)).data;
      const definition = replaceAccountNumber(reportDefinition, ctx.projectNumber);
      validateReportDefinitionForUpdate(reportName, definition);

      await smartsheet.put(`/reports/${reportId}/definition`, definition);
      updatedReport.filterUpdated = true;
    } catch (error) {
      updatedReport.filterError = error.message;
      filterFailures.push({ reportName: updatedName, message: error.message });
      log.warn({ err: error, reportId, reportName, updatedName }, 'report filter update failed after rename');
    }

    if (isOrdersReport(reportName) || isOrdersReport(updatedName)) {
      ctx.reportIds.ordersReport = reportId;
    }

    log.info({ reportId, reportName, updatedName, filterUpdated: updatedReport.filterUpdated }, 'processed report while preserving report ID');
  }

  if (filterFailures.length) {
    throw new Error(`Report renames completed, but ${filterFailures.length} filter update(s) failed: ${filterFailures.map((failure) => `${failure.reportName}: ${failure.message}`).join('; ')}`);
  }

  return ctx;
}

async function loadProjectRootFolder(smartsheet, ctx) {
  const projectRootFolderId = ctx.folderIds.projectFolder || ctx.folderIds.projectToolkit;
  if (!projectRootFolderId) {
    throw new Error('Step 03 requires the project root folder ID from step02c');
  }

  return (await smartsheet.get(`/folders/${projectRootFolderId}`)).data;
}

async function findConfiguredReports(smartsheet, projectRootFolder, ctx) {
  return findReportsByNameContains(smartsheet, projectRootFolder, config.smartsheet.reportNameContains || '{{update filter #}}', ctx.projectNumber);
}

async function findRequiredConfiguredReports(smartsheet, projectRootFolder, ctx) {
  const reportMatches = await findConfiguredReports(smartsheet, projectRootFolder, ctx);
  if (!reportMatches.length) {
    throw new Error(`No update-filter reports found under project folder. Expected names containing ${config.smartsheet.reportNameContains || '{{update filter #}}'}`);
  }
  return reportMatches;
}

async function findReportsByNameContains(smartsheet, container, token, projectNumber, visitedFolderIds = new Set()) {
  const expected = normalizeReportSearchText(token);
  const renamedToken = normalizeReportSearchText(projectNumber);
  const matches = (container.reports || [])
    .filter((report) => {
      const name = normalizeReportSearchText(report.name);
      return reportNameMatchesSearch(name, expected, renamedToken);
    })
    .map((report) => ({ ...report, parentFolderId: container.id }));

  for (const folder of container.folders || []) {
    if (visitedFolderIds.has(folder.id)) {
      continue;
    }
    visitedFolderIds.add(folder.id);
    const folderDetails = (await smartsheet.get(`/folders/${folder.id}`)).data;
    matches.push(...await findReportsByNameContains(smartsheet, folderDetails, token, projectNumber, visitedFolderIds));
  }

  return matches;
}

function normalizeReportSearchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[{}]/g, ' ')
    .replace(/\bfilters\b/g, 'filter')
    .replace(/\s+/g, ' ')
    .trim();
}

function reportNameMatchesSearch(normalizedName, expected, renamedToken) {
  return normalizedName.includes(expected)
    || normalizedName.includes(renamedToken)
    || /\bupdate\s+filters?\b/.test(normalizedName);
}

async function renameReport({ smartsheet, log, reportId, reportName, ctx }) {
  const newName = buildReportName(reportName, ctx);
  if (newName === reportName) {
    return reportName;
  }

  try {
    await smartsheet.put(`/reports/${reportId}`, { name: newName });
    return newName;
  } catch (error) {
    log.warn({ err: error, reportId, reportName, newName }, 'report rename failed; keeping existing report name');
    return reportName;
  }
}

function buildReportName(beforeName, ctx) {
  return beforeName.replace(/\{+\s*update\s+filters?\s*#?\s*\}*|\bupdate\s+filters?(?:\s*#)?(?=\s|$|\})/gi, ctx.projectNumber).slice(0, 50);
}

function stripTemplateToken(name) {
  return name.replace(/\{\{.*?\}\}/g, '').replace(/\s+/g, ' ').trim();
}

function isOrdersReport(reportName) {
  return reportName.toLowerCase().includes(config.smartsheet.ordersReportMatch.toLowerCase());
}

function replaceAccountNumber(definition, projectNumber) {
  const placeholder = config.smartsheet.reportAccountPlaceholder;
  const cloned = JSON.parse(JSON.stringify(definition));
  replaceProjectNumberCriteria(cloned, projectNumber);

  function visit(value) {
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (value && typeof value === 'object') {
      const next = Object.fromEntries(Object.entries(value)
        .filter(([key]) => !REPORT_DEFINITION_READ_ONLY_FIELDS.has(key))
        .map(([key, item]) => [key, visit(item)]));
      if (value.defaultType !== undefined && isReportColumnReference(value) && next.type === undefined) {
        next.type = writableColumnType(value.defaultType);
      }
      return next;
    }
    if (typeof value === 'string') {
      return value.replaceAll(placeholder, projectNumber);
    }
    return value;
  }

  delete cloned.id;
  delete cloned.permalink;
  delete cloned.createdAt;
  delete cloned.modifiedAt;
  return visit(cloned);
}

function replaceProjectNumberCriteria(definition, projectNumber) {
  for (const criterion of allCriteria(definition.filters)) {
    if (isProjectNumberColumn(criterion.column)) {
      criterion.operator = 'EQUAL';
      criterion.values = [String(projectNumber)];
      delete criterion.value;
    }
  }
}

function allCriteria(filterExpression) {
  if (!filterExpression || typeof filterExpression !== 'object') {
    return [];
  }

  const direct = Array.isArray(filterExpression.criteria) ? filterExpression.criteria : [];
  const nested = (filterExpression.nestedCriteria || []).flatMap(allCriteria);
  return [...direct, ...nested];
}

function isReportColumnReference(value) {
  return value.title !== undefined
    || value.primary === true
    || value.sheetNameColumn === true
    || value.systemColumnType !== undefined;
}

function isProjectNumberColumn(column) {
  return normalizeFilterText(column?.title) === 'projectnumber'
    || normalizeFilterText(column?.title) === 'accountnumber';
}

function normalizeFilterText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function writableColumnType(defaultType) {
  const normalized = String(defaultType || '').toUpperCase();
  const mappings = {
    TEXTNUMBER: 'TEXT_NUMBER',
    MULTI_PICKLIST: 'MULTI_PICKLIST',
    MULTICONTACT: 'MULTI_CONTACT_LIST',
    CONTACT: 'CONTACT_LIST'
  };
  return mappings[normalized] || normalized;
}

function validateReportDefinitionForUpdate(reportName, definition) {
  if (!definition.filters || typeof definition.filters !== 'object' || Array.isArray(definition.filters)) {
    throw new Error(`Report "${reportName}" has no editable filter definition. Add a report filter containing ${config.smartsheet.reportAccountPlaceholder} before running step03.`);
  }
}

module.exports = { buildReportName, replaceAccountNumber, reportNameMatchesSearch, run };
