const config = require('../../config');
const { childLogger } = require('../utils/logger');

async function run(ctx) {
  const log = childLogger(ctx, 'step02d');
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;

  await smartsheet.post(
    `/sheets/${sheetId}/shares`,
    {
      groupId: config.smartsheet.officeAdminGroupId,
      accessLevel: 'EDITOR_SHARE'
    },
    { query: { sendEmail: 'true' } }
  );

  log.info({ sheetId, groupId: config.smartsheet.officeAdminGroupId }, 'shared checklist with Office Admin group');
  return ctx;
}

module.exports = { run };
