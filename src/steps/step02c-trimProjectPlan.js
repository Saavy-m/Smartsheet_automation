// Step 02c trims the Project Plan sheet down to the matching project-type section.
// run() finds the project folder in the configured workspace, loads the existing Project Plan sheet, and deletes rows unless DRY_RUN is on.
// Helper functions discover project folders/sheets, identify section rows from Task Name, normalize project type, format sheet URLs, and batch row deletes.

const config = require('../../config');
const { childLogger } = require('../utils/logger');
const { retryResourceNotReady } = require('../utils/retryResourceNotReady');
const { findColumnByTitle, normalizeLookupKey } = require('../utils/smartsheetSheet');
const { truncateSmartsheetCopyName, truncateSmartsheetName } = require('./step01-copyGen009Template');

const TASK_NAME_COLUMN = 'Task Name';

async function run(ctx) {
  const log = childLogger(ctx, 'step02c');
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.projectPlan || await retryResourceNotReady(
    () => resolveProjectPlanSheetId(ctx),
    { log, resourceName: 'project folder or Project Plan sheet' }
  );
  const sheet = (await smartsheet.get(`/sheets/${sheetId}`)).data;

  ctx.sheetIds.projectPlan = sheetId;
  const projectPlanType = projectPlanTrimType(ctx);
  const rowsToDelete = findRowsOutsideProjectType(sheet, projectPlanType);

  log.warn({
    dryRun: config.dryRun,
    sheetId,
    rowIds: rowsToDelete.map((row) => row.id),
    rows: rowsToDelete.map((row) => ({ id: row.id, cells: row.cells }))
  }, 'project plan trim candidates');

  if (config.dryRun) {
    ctx.stepStatus.step02c = 'dry_run';
    return ctx;
  }

  for (const batch of chunk(rowsToDelete, 10)) {
    await smartsheet.delete(`/sheets/${sheetId}/rows`, {
      query: { ids: batch.map((row) => row.id).join(',') }
    });
  }

  log.info({ deletedRowCount: rowsToDelete.length }, 'trimmed non-matching project plan sections');
  return ctx;
}

async function resolveProjectPlanSheetId(ctx) {
  const smartsheet = ctx.clients.smartsheet;
  const workspace = (await smartsheet.get(`/workspaces/${config.smartsheet.zActiveWorkspaceId}`)).data;
  const projectFolder = findProjectFolder(workspace, ctx);

  if (!projectFolder) {
    throw new Error(`Could not find a project folder containing project name: ${ctx.projectName}`);
  }

  ctx.folderIds.projectFolder = projectFolder.id;
  ctx.folderIds.projectToolkit = projectFolder.id;

  const folder = (await smartsheet.get(`/folders/${projectFolder.id}`)).data;
  const projectPlanSheet = await findProjectPlanSheet(smartsheet, folder);
  if (projectPlanSheet) {
    return projectPlanSheet.id;
  }

  const nonSheetMatch = findProjectPlanNonSheet(folder);
  if (nonSheetMatch) {
    throw new Error(`Found ${nonSheetMatch.type} named "${nonSheetMatch.name}", but step02c must trim a Smartsheet sheet whose name includes "project plan"`);
  }

  throw new Error(`Could not find an existing Project Plan sheet with ${TASK_NAME_COLUMN} sections under project folder: ${projectFolder.name}`);
}

function findProjectFolder(container, ctx) {
  const folders = allFolders(container);
  const candidates = projectFolderNameCandidates(ctx).map(normalizeName).filter(Boolean);
  return folders.find((folder) => candidates.includes(normalizeName(folder.name)))
    || folders.find((folder) => candidates.some((candidate) => folderNameMatchesCandidate(folder.name, candidate)))
    || null;
}

function projectFolderNameCandidates(ctx) {
  const projectName = typeof ctx === 'string' ? ctx : ctx.projectName;
  const projectNumber = typeof ctx === 'string' ? '' : ctx.projectNumber;
  const truncatedProjectName = truncateSmartsheetCopyName(`${projectName} GEN009`).replace(/\s+GEN009$/i, '').trim();
  const candidates = [projectName];

  if (projectNumber) {
    candidates.push(`${projectName} - ${projectNumber}`);
  }
  if (truncatedProjectName && truncatedProjectName !== projectName) {
    candidates.push(truncatedProjectName);
    if (projectNumber) {
      candidates.push(`${truncatedProjectName} - ${projectNumber}`);
    }
  }

  for (const name of [...candidates]) {
    candidates.push(renderProjectFolderName(name, projectNumber));
  }

  for (const name of [...candidates]) {
    candidates.push(truncateProjectFolderCopyName(name, projectNumber));
  }

  return [...new Set(candidates.map((candidate) => String(candidate || '').trim()).filter(Boolean))];
}

function truncateProjectFolderCopyName(name, projectNumber) {
  return truncateSmartsheetName(name, projectFolderTemplateSuffix(projectNumber));
}

function projectFolderTemplateSuffix(projectNumber) {
  const template = String(config.smartsheet.projectFolderNameTemplate || '{projectName}');
  const projectNameToken = '{projectName}';
  const projectNameIndex = template.indexOf(projectNameToken);
  if (projectNameIndex === -1) {
    return '';
  }

  return renderProjectFolderFragment(template.slice(projectNameIndex + projectNameToken.length), projectNumber);
}

function renderProjectFolderFragment(template, projectNumber) {
  return String(template)
    .replaceAll('{projectNumber}', projectNumber || '')
    .trimEnd();
}

function renderProjectFolderName(projectName, projectNumber) {
  return String(config.smartsheet.projectFolderNameTemplate || '{projectName}')
    .replaceAll('{projectName}', projectName)
    .replaceAll('{projectNumber}', projectNumber || '')
    .trim();
}

function folderNameMatchesCandidate(folderName, normalizedCandidate) {
  const normalizedFolderName = normalizeName(folderName);
  return normalizedFolderName.includes(normalizedCandidate)
    || (normalizedCandidate.length >= 20 && normalizedFolderName.length >= 20 && normalizedCandidate.startsWith(normalizedFolderName));
}

function allFolders(container) {
  const folders = [];
  for (const folder of container.folders || []) {
    folders.push(folder, ...allFolders(folder));
  }
  return folders;
}

async function findProjectPlanSheet(smartsheet, container, visitedFolderIds = new Set()) {
  for (const sheetSummary of container.sheets || []) {
    const sheet = await loadSheetIfReadable(smartsheet, sheetSummary.id);
    if (sheet && hasProjectPlanSections(sheet)) {
      return { id: sheetSummary.id, name: sheetSummary.name };
    }
  }

  for (const folder of container.folders || []) {
    if (visitedFolderIds.has(folder.id)) {
      continue;
    }
    visitedFolderIds.add(folder.id);
    const folderDetails = (await smartsheet.get(`/folders/${folder.id}`)).data;
    const nested = await findProjectPlanSheet(smartsheet, folderDetails, visitedFolderIds);
    if (nested) {
      return nested;
    }
  }
  return null;
}

async function loadSheetIfReadable(smartsheet, sheetId) {
  try {
    return (await smartsheet.get(`/sheets/${sheetId}`)).data;
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

function hasProjectPlanSections(sheet) {
  const taskNameColumn = findColumnByTitle(sheet, TASK_NAME_COLUMN);
  if (!taskNameColumn) {
    return false;
  }

  const sectionNames = findSectionStarts(sheet, taskNameColumn, config.projectPlanSectionNames)
    .map((section) => normalizeProjectType(section.name));
  return ['Residential', 'Commercial', 'Patterson'].every((sectionName) => sectionNames.includes(sectionName));
}

function findProjectPlanNonSheet(container) {
  const collections = [
    ['report', container.reports || []],
    ['dashboard', container.sights || []],
    ['template', container.templates || []]
  ];

  for (const [type, items] of collections) {
    const match = items.find((item) => isProjectPlanName(item.name));
    if (match) {
      return { type, name: match.name, id: match.id };
    }
  }

  for (const folder of container.folders || []) {
    const nested = findProjectPlanNonSheet(folder);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function isProjectPlanName(name) {
  return normalizeName(name).includes('project plan');
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function findRowsOutsideProjectType(sheet, projectType) {
  const taskNameColumn = findColumnByTitle(sheet, TASK_NAME_COLUMN);
  if (!taskNameColumn) {
    throw new Error(`Project Plan sheet has no ${TASK_NAME_COLUMN} column`);
  }

  const sectionNames = config.projectPlanSectionNames;
  const normalizedType = normalizeProjectType(projectType);
  const sectionStarts = findSectionStarts(sheet, taskNameColumn, sectionNames);

  if (!sectionStarts.length) {
    throw new Error('Could not identify any Project Plan sections');
  }

  if (!sectionStarts.some((section) => section.name === normalizedType)) {
    throw new Error(`Could not identify matching ${normalizedType} Project Plan section. Found: ${sectionStarts.map((section) => section.name).join(', ')}`);
  }

  const rows = sheet.rows || [];
  const rowsToDelete = [];
  sectionStarts.forEach((section, position) => {
    const next = sectionStarts[position + 1]?.index ?? rows.length;
    if (section.name !== normalizedType) {
      const sectionRow = rows[section.index];
      if (hasChildRows(rows, sectionRow)) {
        rowsToDelete.push(sectionRow);
      } else {
        rowsToDelete.push(...rows.slice(section.index, next));
      }
    }
  });

  return rowsToDelete;
}

function hasChildRows(rows, sectionRow) {
  return rows.some((row) => row.parentId === sectionRow.id);
}

function findSectionStarts(sheet, primary, sectionNames) {
  const rows = sheet.rows || [];
  const exactMatches = collectSectionStarts(rows, primary, sectionNames, isExactSectionMatch);
  if (exactMatches.length >= 3) {
    return exactMatches;
  }

  const topLevelMatches = collectSectionStarts(rows.filter((row) => !row.parentId), primary, sectionNames, isLooseSectionMatch, rows);
  if (topLevelMatches.length >= 3) {
    return topLevelMatches;
  }

  return collectSectionStarts(rows, primary, sectionNames, isLooseSectionMatch);
}

function collectSectionStarts(rows, primary, sectionNames, predicate, originalRows = rows) {
  const matchesByName = new Map();

  rows.forEach((row) => {
    const value = cellValue(row, primary.id);
    const matched = sectionNames.find((section) => predicate(value, section));
    if (matched && !matchesByName.has(normalizeProjectType(matched))) {
      matchesByName.set(normalizeProjectType(matched), {
        name: normalizeProjectType(matched),
        index: originalRows.findIndex((item) => item.id === row.id)
      });
    }
  });

  return Array.from(matchesByName.values()).sort((left, right) => left.index - right.index);
}

function isExactSectionMatch(value, section) {
  return String(value || '').trim().toLowerCase() === String(section || '').trim().toLowerCase();
}

function isLooseSectionMatch(value, section) {
  const normalizedValue = normalizeLookupKey(value);
  const normalizedSection = normalizeLookupKey(section);
  return normalizedValue === normalizedSection
    || normalizedValue.startsWith(normalizedSection)
    || normalizedValue.endsWith(normalizedSection)
    || normalizedValue.includes(`${normalizedSection}project`);
}

function normalizeProjectType(value) {
  const normalized = normalizeLookupKey(value);
  if (normalized === 'hospitality') return 'Commercial';
  if (normalized === 'nhorpaterson' || normalized === 'nhorpatterson') return 'Patterson';
  if (/^commercial$/i.test(value)) return 'Commercial';
  if (/^residential$/i.test(value)) return 'Residential';
  if (/^pat{1,2}erson$/i.test(value)) return 'Patterson';
  return String(value || '').trim();
}

function projectPlanTrimType(ctx) {
  return normalizeProjectType(ctx.projectType || ctx.projectVertical);
}

function projectPlanUrl(sheet, sheetId) {
  return sheet.permalink || `https://app.smartsheet.com/sheets/${sheetId}`;
}

function primaryColumn(sheet) {
  return (sheet.columns || []).find((column) => column.primary) || sheet.columns?.[0];
}

function cellValue(row, columnId) {
  const cell = (row.cells || []).find((item) => item.columnId === columnId);
  return cell?.displayValue ?? cell?.value;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

module.exports = { findProjectFolder, findRowsOutsideProjectType, projectFolderNameCandidates, projectPlanTrimType, projectPlanUrl, run };
