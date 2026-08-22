// Step 04b creates the project OneDrive folders from configured template folders.
// run() copies CAD and Client Files templates into their configured destinations, then renames them for the project.
// Helper functions start Graph copy operations, poll asynchronous completion, and rename copied folders.

const path = require('path');
const config = require('../../config');
const { childLogger } = require('../utils/logger');
const { pollAsyncOperation } = require('../utils/pollAsyncOperation');

async function run(ctx) {
  const log = childLogger(ctx, 'step04b');
  const finalName = `${ctx.projectName} - ${ctx.projectNumber}`;

  log.info({
    oneDriveUserId: config.graph.oneDriveUserId,
    finalName,
    cadTemplatePath: config.oneDrive.cadTemplatePath,
    cadDestinationPath: config.oneDrive.cadDestinationPath,
    clientTemplatePath: config.oneDrive.clientTemplatePath,
    clientDestinationPath: config.oneDrive.clientDestinationPath
  }, 'starting OneDrive folder creation');

  ctx.folderIds.oneDrive = ctx.folderIds.oneDrive || {};
  ctx.folderUrls = ctx.folderUrls || {};
  ctx.folderUrls.oneDrive = ctx.folderUrls.oneDrive || {};

  const cadFolder = await copyPollRename({
    ctx,
    log,
    templatePath: config.oneDrive.cadTemplatePath,
    destinationPath: config.oneDrive.cadDestinationPath,
    finalName,
    label: 'CAD Files'
  });
  ctx.folderIds.oneDrive.cad = cadFolder.id;
  ctx.folderUrls.oneDrive.cad = cadFolder.webUrl;

  const clientFolder = await copyPollRename({
    ctx,
    log,
    templatePath: config.oneDrive.clientTemplatePath,
    destinationPath: config.oneDrive.clientDestinationPath,
    finalName,
    label: 'Client Files'
  });
  ctx.folderIds.oneDrive.client = clientFolder.id;
  ctx.folderUrls.oneDrive.client = clientFolder.webUrl;

  log.info({
    cadFolderId: ctx.folderIds.oneDrive.cad,
    cadFolderUrl: ctx.folderUrls.oneDrive.cad,
    clientFolderId: ctx.folderIds.oneDrive.client,
    clientFolderUrl: ctx.folderUrls.oneDrive.client
  }, 'created OneDrive project folders');
  return ctx;
}

async function copyPollRename({ ctx, log, templatePath, destinationPath, finalName, label }) {
  try {
    const graph = ctx.clients.oneDriveGraph || ctx.clients.graph;
    log.info({ label, templatePath, destinationPath }, 'resolving OneDrive template and destination folders');

    const template = (await graph.resolveDriveItemByPath(templatePath)).data;
    const destination = (await graph.resolveDriveItemByPath(destinationPath)).data;
    log.info({
      label,
      templateId: template.id,
      templateName: template.name,
      templateUrl: template.webUrl,
      destinationId: destination.id,
      destinationName: destination.name,
      destinationUrl: destination.webUrl
    }, 'resolved OneDrive template and destination folders');

    const temporaryName = `${path.basename(templatePath)} - ${ctx.runId}`.slice(0, 120);
    log.info({ label, templateId: template.id, destinationId: destination.id, temporaryName, finalName }, 'starting OneDrive template folder copy');

    const copyResponse = await graph.copyDriveItem({
      itemId: template.id,
      parentReferenceId: destination.id,
      name: temporaryName
    });
    const location = copyResponse.headers.get('location');

    if (!location) {
      throw new Error(`Graph copy for ${label} did not return a Location header`);
    }

    log.info({ label, status: copyResponse.status, temporaryName }, 'OneDrive copy accepted by Graph; polling for completion');

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

    log.info({ label, copiedId, copyStatus: copied.status, temporaryName }, 'OneDrive copy completed; renaming copied folder');

    const renamed = (await graph.patchDriveItem(copiedId, { name: finalName })).data;
    log.info({
      label,
      folderId: renamed.id,
      folderName: renamed.name,
      folderUrl: renamed.webUrl,
      finalName,
      sourceTemplateUrl: template.webUrl,
      destinationUrl: destination.webUrl
    }, 'copied and renamed OneDrive template folder');
    return { id: renamed.id, webUrl: renamed.webUrl };
  } catch (error) {
    log.error({ err: error, label, templatePath, destinationPath, finalName }, 'OneDrive template folder copy failed');
    throw error;
  }
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
