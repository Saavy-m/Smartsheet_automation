const path = require('path');
const config = require('../../config');
const { childLogger } = require('../utils/logger');
const { pollAsyncOperation } = require('../utils/pollAsyncOperation');

async function run(ctx) {
  const log = childLogger(ctx, 'step04b');

  ctx.folderIds.oneDrive = ctx.folderIds.oneDrive || {};
  ctx.folderIds.oneDrive.cad = await copyPollRename({
    ctx,
    log,
    templatePath: config.oneDrive.cadTemplatePath,
    destinationPath: config.oneDrive.cadDestinationPath,
    finalName: ctx.projectName,
    label: 'CAD Files'
  });

  const clientFolderId = await copyPollRename({
    ctx,
    log,
    templatePath: config.oneDrive.clientTemplatePath,
    destinationPath: config.oneDrive.clientDestinationPath,
    finalName: ctx.projectName,
    label: 'Client Files'
  });

  const productionFolder = (await ctx.clients.graph.resolveDriveItemByPath(config.oneDrive.clientProductionPath)).data;
  const moved = (await ctx.clients.graph.patchDriveItem(clientFolderId, {
    parentReference: { id: productionFolder.id }
  })).data;
  ctx.folderIds.oneDrive.client = moved.id;

  log.info({ cadFolderId: ctx.folderIds.oneDrive.cad, clientFolderId: ctx.folderIds.oneDrive.client }, 'created OneDrive project folders');
  return ctx;
}

async function copyPollRename({ ctx, log, templatePath, destinationPath, finalName, label }) {
  const graph = ctx.clients.graph;
  const template = (await graph.resolveDriveItemByPath(templatePath)).data;
  const destination = (await graph.resolveDriveItemByPath(destinationPath)).data;
  const temporaryName = `${path.basename(templatePath)} - ${ctx.runId}`.slice(0, 120);

  const copyResponse = await graph.copyDriveItem({
    itemId: template.id,
    parentReferenceId: destination.id,
    name: temporaryName
  });
  const location = copyResponse.headers.get('location');

  if (!location) {
    throw new Error(`Graph copy for ${label} did not return a Location header`);
  }

  const copied = await pollAsyncOperation({
    log,
    poll: () => pollGraphCopy(location),
    isComplete: (result) => ['completed', 'complete'].includes(String(result.status || '').toLowerCase()),
    intervalMs: 3000,
    timeoutMs: 300000
  });

  const copiedId = copied.resourceId || copied.resourceLocation?.split('/').pop();
  if (!copiedId) {
    throw new Error(`Graph copy for ${label} completed without a resource id`);
  }

  const renamed = (await graph.patchDriveItem(copiedId, { name: finalName })).data;
  log.info({ label, folderId: renamed.id, finalName }, 'copied and renamed OneDrive template folder');
  return renamed.id;
}

async function pollGraphCopy(location) {
  const response = await fetch(location);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(text || `Graph copy poll failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

module.exports = { run };
