const config = require('../../config');
const { pollAsyncOperation } = require('../utils/pollAsyncOperation');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step01');
  const smartsheet = ctx.clients.smartsheet;
  const sheetName = `${ctx.projectName} Gen 009`;
  const folderName = `${ctx.projectName} - Project Toolkit`;

  const workspace = (await smartsheet.get(`/workspaces/${config.smartsheet.zActiveWorkspaceId}`)).data;
  const folder = findFolderByName(workspace, folderName);
  if (!folder) {
    throw new Error(`Could not find destination folder: ${folderName}`);
  }

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

  const location = response.headers.get('location');
  if (location) {
    await pollAsyncOperation({
      log,
      poll: () => smartsheet.get(pathFromLocation(location)),
      isComplete: (result) => result.status === 200 && result.data
    });
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

function pathFromLocation(location) {
  const url = new URL(location);
  return url.pathname.replace('/2.0', '');
}

function findFolderByName(container, name) {
  const expected = String(name).trim().toLowerCase();
  for (const folder of container.folders || []) {
    if (String(folder.name).trim().toLowerCase() === expected) {
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
  const expected = String(name).trim().toLowerCase();
  const match = (container.sheets || []).find((sheet) => String(sheet.name).trim().toLowerCase() === expected);
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

module.exports = { run };
