const config = require('../../config');
const { childLogger } = require('../utils/logger');
const { retryResourceNotReady } = require('../utils/retryResourceNotReady');
const { findProjectFolder } = require('./step02c-trimProjectPlan');

const TOOLKIT_RETRY_DELAYS_MS = [3 * 60 * 1000, 3 * 60 * 1000, 5 * 60 * 1000];
const FATAL_TOOLKIT_FOLDER_MESSAGE = 'Fatal error - automation did not find the toolkit folder. Stopped all steps of the automation.';

class ToolkitFolderNotFoundError extends Error {
  constructor(ctx) {
    super(`Could not find the project toolkit folder for ${ctx.projectName || 'this project'}`);
    this.code = 'PROJECT_TOOLKIT_FOLDER_NOT_FOUND';
    this.status = 404;
  }
}

class FatalToolkitFolderNotFoundError extends Error {
  constructor(ctx, cause) {
    super(FATAL_TOOLKIT_FOLDER_MESSAGE);
    this.code = 'FATAL_PROJECT_TOOLKIT_FOLDER_NOT_FOUND';
    this.isFatalAutomationError = true;
    this.cause = cause;
    this.projectName = ctx.projectName;
    this.projectNumber = ctx.projectNumber;
  }
}

async function run(ctx) {
  const log = childLogger(ctx, 'step00a');

  try {
    const folder = await retryResourceNotReady(
      () => resolveProjectToolkitFolder(ctx),
      {
        log,
        resourceName: 'project toolkit folder',
        retries: TOOLKIT_RETRY_DELAYS_MS.length,
        delayScheduleMs: TOOLKIT_RETRY_DELAYS_MS,
        delayFn: ctx.projectToolkitRetryDelayFn
      }
    );

    ctx.folderIds.projectFolder = folder.id;
    ctx.folderIds.projectToolkit = folder.id;
    ctx.projectToolkitFolderName = folder.name;
    log.info({ folderId: folder.id, folderName: folder.name }, 'found project toolkit folder');
    return ctx;
  } catch (error) {
    if (error.code === 'PROJECT_TOOLKIT_FOLDER_NOT_FOUND') {
      throw new FatalToolkitFolderNotFoundError(ctx, error);
    }
    throw error;
  }
}

async function resolveProjectToolkitFolder(ctx) {
  const smartsheet = ctx.clients.smartsheet;
  const workspace = (await smartsheet.get(`/workspaces/${config.smartsheet.zActiveWorkspaceId}`)).data;
  const folder = findProjectFolder(workspace, ctx);

  if (!folder) {
    throw new ToolkitFolderNotFoundError(ctx);
  }

  return folder;
}

module.exports = {
  FATAL_TOOLKIT_FOLDER_MESSAGE,
  TOOLKIT_RETRY_DELAYS_MS,
  FatalToolkitFolderNotFoundError,
  ToolkitFolderNotFoundError,
  resolveProjectToolkitFolder,
  run
};