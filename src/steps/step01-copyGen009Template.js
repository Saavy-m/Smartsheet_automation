// Step 01 copies the configured GEN009 template sheet into SMARTSHEET_PROJECT_ROOT_FOLDER_PATH and records the new sheet ID.
// run() resolves the destination folder, creates the rendered {projectName} GEN009 sheet, and records an existing exact-name sheet if found.
// Helper functions render project templates, resolve folder paths, find sheets/folders, and normalize name comparisons.

const config = require('../../config');
const { pollAsyncOperation } = require('../utils/pollAsyncOperation');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step01');
  validateStep01Config();
  const smartsheet = ctx.clients.smartsheet;
  const sheetName = renderTemplate(config.smartsheet.gen009SheetNameTemplate, ctx);

  const workspace = (await smartsheet.get(`/workspaces/${config.smartsheet.zActiveWorkspaceId}`)).data;
  const folder = getProjectDestinationFolder(workspace);

  ctx.folderIds.projectRoot = folder.id;
  ctx.folderIds.projectToolkit = folder.id;
  const folderDetails = (await smartsheet.get(`/folders/${folder.id}`)).data;
  const existing = findSheetByName(folderDetails, sheetName);

  if (existing) {
    log.info({ sheetId: existing.id, sheetName }, 'reusing existing GEN009 sheet copy');
    ctx.sheetIds.gen009Checklist = existing.id;
    return ctx;
  }

  log.info({ sheetName, folderId: folder.id }, 'copying GEN009 template sheet');
  const response = await smartsheet.post(
    `/sheets/${config.smartsheet.gen009TemplateId}/copy`,
    {
      newName: sheetName,
      destinationType: 'folder',
      destinationId: folder.id
    },
    { query: { include: 'data,filters,forms,rules' } }
  );

  let copiedSheetId = sheetIdFromCopyResult(response.data);
  const location = response.headers.get('location');
  if (location) {
    const pollResult = await pollAsyncOperation({
      log,
      poll: () => smartsheet.get(pathFromLocation(location)),
      isComplete: (result) => result.status === 200 && result.data
    });
    copiedSheetId = copiedSheetId || sheetIdFromCopyResult(pollResult.data);
  }

  if (copiedSheetId) {
    await waitForCopiedSheet(smartsheet, copiedSheetId, log);
    ctx.sheetIds.gen009Checklist = copiedSheetId;
    log.info({ sheetId: copiedSheetId, sheetName }, 'copied GEN009 template sheet');
    return ctx;
  }

  const refreshedFolder = (await smartsheet.get(`/folders/${folder.id}`)).data;
  const created = findSheetByName(refreshedFolder, sheetName);
  if (!created) {
    throw new Error(`GEN009 copy completed but ${sheetName} was not found in destination folder`);
  }

  ctx.sheetIds.gen009Checklist = created.id;
  log.info({ sheetId: created.id, sheetName }, 'copied GEN009 template sheet');
  return ctx;
}

function validateStep01Config() {
  const requiredValues = [
    ['SMARTSHEET_Z_ACTIVE_WORKSPACE_ID', config.smartsheet.zActiveWorkspaceId],
    ['SMARTSHEET_GEN009_TEMPLATE_ID', config.smartsheet.gen009TemplateId],
    ['SMARTSHEET_PROJECT_ROOT_FOLDER_PATH', config.smartsheet.projectRootFolderPath]
  ];

  for (const [name, value] of requiredValues) {
    if (!value || /^replace-me$/i.test(String(value))) {
      throw new Error(`${name} must be set before running step01`);
    }
  }
}

function pathFromLocation(location) {
  const url = new URL(location);
  return url.pathname.replace('/2.0', '');
}

function renderTemplate(template, ctx) {
  return String(template)
    .replaceAll('{projectName}', ctx.projectName)
    .replaceAll('{projectNumber}', ctx.projectNumber)
    .replaceAll('{projectType}', ctx.projectType);
}

function sheetIdFromCopyResult(data) {
  if (!data || typeof data !== 'object') {
    return null;
  }
  if (data.id) {
    return data.id;
  }
  if (data.result?.id) {
    return data.result.id;
  }
  if (data.sheet?.id) {
    return data.sheet.id;
  }
  return null;
}

async function waitForCopiedSheet(smartsheet, sheetId, log) {
  await pollAsyncOperation({
    log,
    poll: async () => {
      try {
        return await smartsheet.get(`/sheets/${sheetId}`);
      } catch (error) {
        if (error.status === 404) {
          return { status: 404, data: null };
        }
        throw error;
      }
    },
    isComplete: (result) => result.status === 200 && result.data
  });
}

function getProjectDestinationFolder(workspace) {
  const rootPath = config.smartsheet.projectRootFolderPath;
  if (!rootPath) {
    throw new Error('SMARTSHEET_PROJECT_ROOT_FOLDER_PATH must point to the folder where GEN009 copies should be created');
  }

  const root = findFolderByPath(workspace, rootPath);
  if (!root) {
    const workspaceName = workspace.name || config.smartsheet.zActiveWorkspaceName || config.smartsheet.zActiveWorkspaceId;
    throw new Error(`Could not find configured Smartsheet project root folder: ${workspaceName}\\${rootPath}`);
  }
  return root;
}

function findFolderByPath(workspace, folderPath) {
  const segments = String(folderPath)
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments[0] && workspace.name && sameName(segments[0], workspace.name)) {
    segments.shift();
  }

  let current = workspace;
  for (const segment of segments) {
    current = findDirectFolderByName(current, segment);
    if (!current) {
      return null;
    }
  }
  return current;
}

function findDirectFolderByName(container, name) {
  return (container.folders || []).find((folder) => sameName(folder.name, name)) || null;
}

function findFolderByName(container, name) {
  for (const folder of container.folders || []) {
    if (sameName(folder.name, name)) {
      return folder;
    }
    const nested = findFolderByName(folder, name);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function findSheetByName(container, name) {
  const match = (container.sheets || []).find((sheet) => sameName(sheet.name, name));
  if (match) {
    return match;
  }
  for (const folder of container.folders || []) {
    const nested = findSheetByName(folder, name);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function sameName(left, right) {
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

module.exports = { run };
