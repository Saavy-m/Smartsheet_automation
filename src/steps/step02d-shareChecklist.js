// Step 02d shares the copied GEN009 checklist with the Office Admin Smartsheet group or named users.
// run() sends the Smartsheet share request with email notifications and records the share target in logs.

const config = require('../../config');
const { childLogger } = require('../utils/logger');

const OFFICE_ADMIN_EMAILS = [
  'aron@cmr-design.com',
  'ashley@cmr-design.com',
  'satyamofficial4916@gmail.com',
  'satyamshukla4916@gmail.com'
];
const ACCESS_LEVEL = 'EDITOR_SHARE';
const SEND_SHARE_EMAIL = true;
const DEFAULT_SHARE_EMAIL_CC_ME = true;

async function run(ctx) {
  const log = childLogger(ctx, 'step02d');
  const smartsheet = ctx.clients.smartsheet;
  const sheetId = ctx.sheetIds.gen009Checklist;
  const groupId = ctx.officeAdminGroupId ?? config.smartsheet.officeAdminGroupId;
  const officeAdminEmails = ctx.officeAdminEmails || OFFICE_ADMIN_EMAILS;
  const shareEmail = buildShareEmail(ctx);

  if (isPlaceholderGroupId(groupId)) {
    log.info({ sheetId, emails: officeAdminEmails, sendEmail: SEND_SHARE_EMAIL, shareEmail }, 'sharing checklist with Office Admin users');
    const response = await shareWithOfficeAdminUsers(smartsheet, sheetId, officeAdminEmails, shareEmail);
    recordShareResult(ctx, {
      mode: 'users',
      sheetId,
      emails: officeAdminEmails,
      sendEmail: SEND_SHARE_EMAIL,
      shareEmail,
      response
    });
    log.info(buildShareLog(ctx.step02dShare), 'shared checklist with Office Admin users');
    return ctx;
  }

  try {
    log.info({ sheetId, groupId, sendEmail: SEND_SHARE_EMAIL, shareEmail }, 'sharing checklist with Office Admin group');
    const response = await shareWithOfficeAdminGroup(smartsheet, sheetId, groupId, shareEmail);
    recordShareResult(ctx, {
      mode: 'group',
      sheetId,
      groupId,
      sendEmail: SEND_SHARE_EMAIL,
      shareEmail,
      response
    });
  } catch (error) {
    if (error.status === 404 || error.details?.errorCode === 1106) {
      log.warn({ err: error, sheetId, groupId }, 'Office Admin group was not found; sharing checklist with Office Admin users');
      log.info({ sheetId, emails: officeAdminEmails, sendEmail: SEND_SHARE_EMAIL, fallbackFromGroupId: groupId, shareEmail }, 'sharing checklist with Office Admin users');
      const response = await shareWithOfficeAdminUsers(smartsheet, sheetId, officeAdminEmails, shareEmail);
      recordShareResult(ctx, {
        mode: 'users',
        sheetId,
        emails: officeAdminEmails,
        fallbackFromGroupId: groupId,
        sendEmail: SEND_SHARE_EMAIL,
        shareEmail,
        response
      });
      log.info(buildShareLog(ctx.step02dShare), 'shared checklist with Office Admin users');
      return ctx;
    }
    throw error;
  }

  log.info(buildShareLog(ctx.step02dShare), 'shared checklist with Office Admin group');
  return ctx;
}

module.exports = { run };

function shareWithOfficeAdminGroup(smartsheet, sheetId, groupId, shareEmail) {
  return shareSheet(smartsheet, sheetId, [
    {
      groupId: Number(groupId),
      accessLevel: ACCESS_LEVEL,
      ...(shareEmail || {})
    }
  ]);
}

function shareWithOfficeAdminUsers(smartsheet, sheetId, emails = OFFICE_ADMIN_EMAILS, shareEmail) {
  return shareSheet(
    smartsheet,
    sheetId,
    emails.map((email) => ({
      email,
      accessLevel: ACCESS_LEVEL,
      ...(shareEmail || {})
    }))
  );
}

function shareSheet(smartsheet, sheetId, shares) {
  return smartsheet.post('/shares', shares, {
    query: {
      assetType: 'sheet',
      assetId: sheetId,
      sendEmail: SEND_SHARE_EMAIL
    }
  });
}

function recordShareResult(ctx, share) {
  const result = share.response?.data?.result || [];
  ctx.step02dShare = {
    mode: share.mode,
    sheetId: share.sheetId,
    groupId: share.groupId,
    emails: share.emails,
    fallbackFromGroupId: share.fallbackFromGroupId,
    sendEmail: share.sendEmail,
    shareEmail: share.shareEmail,
    status: share.response?.status,
    message: share.response?.data?.message,
    resultCode: share.response?.data?.resultCode,
    resultCount: result.length,
    shares: result.map((item) => ({
      id: item.id,
      type: item.type,
      email: item.email,
      userId: item.userId,
      groupId: item.groupId,
      accessLevel: item.accessLevel,
      scope: item.scope
    }))
  };
}

function buildShareLog(share) {
  return {
    sheetId: share.sheetId,
    mode: share.mode,
    groupId: share.groupId,
    emails: share.emails,
    fallbackFromGroupId: share.fallbackFromGroupId,
    sendEmail: share.sendEmail,
    shareEmail: share.shareEmail,
    status: share.status,
    resultCode: share.resultCode,
    resultCount: share.resultCount,
    shares: share.shares
  };
}

function buildShareEmail(ctx) {
  if (ctx.useSmartsheetDefaultShareEmail) {
    return undefined;
  }

  return {
    subject: ctx.shareEmailSubject || buildDefaultSubject(ctx),
    message: ctx.shareEmailMessage || buildDefaultMessage(ctx),
    ccMe: ctx.shareEmailCcMe ?? DEFAULT_SHARE_EMAIL_CC_ME
  };
}

function buildDefaultSubject(ctx) {
  if (ctx.sheetNames?.gen009Checklist) {
    return `You're invited to the Sheet: ${ctx.sheetNames.gen009Checklist}`;
  }
  if (ctx.projectName) {
    return `You're invited to the Sheet: ${ctx.projectName} GEN009`;
  }
  return "You're invited to the Sheet: GEN009";
}

function buildDefaultMessage(ctx) {
  if (ctx.sheetNames?.gen009Checklist) {
    return `${ctx.sheetNames.gen009Checklist} is ready in Smartsheet.`;
  }
  if (ctx.projectName) {
    return `${ctx.projectName} GEN009 is ready in Smartsheet.`;
  }
  return 'The GEN009 project checklist is ready in Smartsheet.';
}

function isPlaceholderGroupId(groupId) {
  return !groupId || /^replace-me$/i.test(String(groupId).trim());
}
