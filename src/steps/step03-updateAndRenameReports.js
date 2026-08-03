const config = require('../../config');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step03');
  const smartsheet = ctx.clients.smartsheet;
  const folders = await loadReportFolders(smartsheet, ctx.folderIds.projectToolkit);
  const reportMatches = findConfiguredReports(folders);

  if (reportMatches.length !== config.smartsheet.reportTemplateNames.length) {
    throw new Error(`Expected ${config.smartsheet.reportTemplateNames.length} reports, found ${reportMatches.length}`);
  }

  ctx.reportIds.updatedReports = [];

  for (const report of reportMatches) {
    const beforeId = report.id;
    const beforeName = report.name;
    const reportDetail = (await smartsheet.get(`/reports/${beforeId}`)).data;
    const newName = buildReportName(beforeName, ctx);
    const definition = replaceAccountNumber(reportDetail, ctx.projectNumber);

    const createResponse = await smartsheet.post('/reports', {
      name: newName,
      destinationType: 'folder',
      destinationId: report.parentFolderId || ctx.folderIds.projectToolkit
    });
    const created = createResponse.data.result || createResponse.data;

    if (!created?.id) {
      throw new Error(`Report create did not return an ID for ${newName}`);
    }

    await smartsheet.put(`/reports/${created.id}/definition`, definition);
    await smartsheet.delete(`/reports/${beforeId}`);

    ctx.reportIds.updatedReports.push({ beforeId, beforeName, afterId: created.id, afterName: newName });
    if (beforeName.toLowerCase().includes(config.smartsheet.ordersReportMatch.toLowerCase())) {
      ctx.reportIds.ordersReport = created.id;
    }

    log.info({ beforeId, beforeName, afterId: created.id, afterName: newName }, 'updated and recreated report with project-specific name');
  }

  return ctx;
}

async function loadReportFolders(smartsheet, projectToolkitFolderId) {
  const mainFolder = (await smartsheet.get(`/folders/${projectToolkitFolderId}`)).data;
  const updateFilterFolders = findFoldersByNameContains(mainFolder, config.smartsheet.reportFolderNameContains);
  const folders = [mainFolder];

  for (const folder of updateFilterFolders) {
    folders.push((await smartsheet.get(`/folders/${folder.id}`)).data);
  }

  return folders;
}

function findConfiguredReports(folders) {
  const matches = [];
  for (const templateName of config.smartsheet.reportTemplateNames) {
    const match = folders
      .flatMap((folder) => (folder.reports || []).map((report) => ({ ...report, parentFolderId: folder.id })))
      .find((report) => report.name.includes(templateName));
    if (match) {
      matches.push(match);
    }
  }
  return matches;
}

function buildReportName(beforeName, ctx) {
  const name = config.smartsheet.reportNameTemplate
    .replaceAll('{projectNumber}', ctx.projectNumber)
    .replaceAll('{projectName}', ctx.projectName)
    .replaceAll('{templateName}', stripTemplateToken(beforeName));
  return name.slice(0, 50);
}

function stripTemplateToken(name) {
  return name.replace(/\{\{.*?\}\}/g, '').replace(/\s+/g, ' ').trim();
}

function replaceAccountNumber(definition, projectNumber) {
  const placeholder = config.smartsheet.reportAccountPlaceholder;
  const cloned = JSON.parse(JSON.stringify(definition));

  function visit(value) {
    if (Array.isArray(value)) {
      return value.map(visit);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
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

function findFoldersByNameContains(container, token) {
  const expected = String(token).trim().toLowerCase();
  const matches = [];
  for (const folder of container.folders || []) {
    if (String(folder.name).trim().toLowerCase().includes(expected)) {
      matches.push(folder);
    }
    matches.push(...findFoldersByNameContains(folder, token));
  }
  return matches;
}

module.exports = { buildReportName, replaceAccountNumber, run };
