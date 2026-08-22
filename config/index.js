require('dotenv').config();

const REQUIRED = [
  'SMARTSHEET_API_TOKEN',
  'SMARTSHEET_GEN009_TEMPLATE_ID',
  'SMARTSHEET_Z_ACTIVE_WORKSPACE_ID',
  'SMARTSHEET_MASTER_PROJECT_LIST_SHEET_ID',
  'MS_GRAPH_TENANT_ID',
  'MS_GRAPH_CLIENT_ID',
  'MS_GRAPH_CLIENT_SECRET',
  'MS_GRAPH_MAILBOX_USER_ID',
  'MS_GRAPH_ONEDRIVE_USER_ID',
  'WEBHOOK_CALLBACK_URL',
  'WEBHOOK_CLIENT_STATE',
  'ONEDRIVE_CAD_TEMPLATE_PATH',
  'ONEDRIVE_CAD_DESTINATION_PATH',
  'ONEDRIVE_CLIENT_TEMPLATE_PATH',
  'ONEDRIVE_CLIENT_DESTINATION_PATH',
  'ORDERS_REPORT_PUBLISH_ACCESS_LEVEL',
  'SIGNED_KEYWORD',
  'MANUAL_CHECKPOINT_OWNER_EMAIL',
  'SMARTSHEET_REPORT_TEMPLATE_NAMES',
  'SMARTSHEET_REPORT_ACCOUNT_PLACEHOLDER',
  'SMARTSHEET_REPORT_FOLDER_NAME_CONTAINS',
  'SMARTSHEET_ORDERS_REPORT_MATCH',
  'MASTER_PROJECT_NUMBER_COLUMN',
  'MASTER_PROJECT_NAME_COLUMN',
  'PROJECT_PLAN_SECTION_NAMES',
  'PROJECT_TYPE_EMAIL_LABELS',
  'DRY_RUN',
  'PORT'
];

function getEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getBoolean(name) {
  const value = getEnv(name).toLowerCase();
  if (!['true', 'false'].includes(value)) {
    throw new Error(`${name} must be "true" or "false"`);
  }
  return value === 'true';
}

function getOptionalBoolean(name, defaultValue = false) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  if (!['true', 'false'].includes(value.toLowerCase())) {
    throw new Error(`${name} must be "true" or "false"`);
  }
  return value.toLowerCase() === 'true';
}

function getCsv(name) {
  return getEnv(name)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getOptionalString(name, defaultValue = '') {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value;
}

function getOptionalNumber(name, defaultValue = 0) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return number;
}

function getOptionalEnv(name, fallbackName) {
  const value = process.env[name];
  if (value !== undefined && value !== '') {
    return value;
  }
  return getEnv(fallbackName);
}

function validate() {
  REQUIRED.forEach(getEnv);
}

validate();

module.exports = {
  port: Number(getEnv('PORT')),
  dryRun: getBoolean('DRY_RUN'),
  automationStartDelayMs: getOptionalNumber('AUTOMATION_START_DELAY_SECONDS') * 1000,
  smartsheet: {
    token: getEnv('SMARTSHEET_API_TOKEN'),
    changeAgent: process.env.SMARTSHEET_CHANGE_AGENT || 'cmr-project-spin-up',
    gen009TemplateId: getEnv('SMARTSHEET_GEN009_TEMPLATE_ID'),
    zActiveWorkspaceId: getEnv('SMARTSHEET_Z_ACTIVE_WORKSPACE_ID'),
    zActiveWorkspaceName: getOptionalString('SMARTSHEET_Z_ACTIVE_WORKSPACE_NAME'),
    projectRootFolderPath: getOptionalString('SMARTSHEET_PROJECT_ROOT_FOLDER_PATH'),
    projectFolderNameTemplate: getOptionalString('SMARTSHEET_PROJECT_FOLDER_NAME_TEMPLATE', '{projectName} - Project Toolkit'),
    gen009SheetNameTemplate: getOptionalString('SMARTSHEET_GEN009_SHEET_NAME_TEMPLATE', '{projectName} GEN009'),
    masterProjectListSheetId: getEnv('SMARTSHEET_MASTER_PROJECT_LIST_SHEET_ID'),
    reportTemplateNames: getCsv('SMARTSHEET_REPORT_TEMPLATE_NAMES'),
    renameReports: getOptionalBoolean('SMARTSHEET_RENAME_REPORTS'),
    reportNameTemplate: process.env.SMARTSHEET_REPORT_NAME_TEMPLATE || '{projectNumber} {templateName}',
    reportAccountPlaceholder: getEnv('SMARTSHEET_REPORT_ACCOUNT_PLACEHOLDER'),
    reportNameContains: getEnv('SMARTSHEET_REPORT_FOLDER_NAME_CONTAINS'),
    ordersReportMatch: getEnv('SMARTSHEET_ORDERS_REPORT_MATCH'),
    ordersReportPublishAccessLevel: getEnv('ORDERS_REPORT_PUBLISH_ACCESS_LEVEL'),
    officeAdminGroupId: getOptionalString('OFFICE_ADMIN_GROUP_ID', 'replace-me')
  },
  graph: {
    tenantId: getEnv('MS_GRAPH_TENANT_ID'),
    clientId: getEnv('MS_GRAPH_CLIENT_ID'),
    clientSecret: getEnv('MS_GRAPH_CLIENT_SECRET'),
    mailTenantId: getOptionalEnv('MS_GRAPH_MAIL_TENANT_ID', 'MS_GRAPH_TENANT_ID'),
    mailClientId: getOptionalEnv('MS_GRAPH_MAIL_CLIENT_ID', 'MS_GRAPH_CLIENT_ID'),
    mailClientSecret: getOptionalEnv('MS_GRAPH_MAIL_CLIENT_SECRET', 'MS_GRAPH_CLIENT_SECRET'),
    oneDriveTenantId: getOptionalEnv('MS_GRAPH_ONEDRIVE_TENANT_ID', 'MS_GRAPH_TENANT_ID'),
    oneDriveClientId: getOptionalEnv('MS_GRAPH_ONEDRIVE_CLIENT_ID', 'MS_GRAPH_CLIENT_ID'),
    oneDriveClientSecret: getOptionalEnv('MS_GRAPH_ONEDRIVE_CLIENT_SECRET', 'MS_GRAPH_CLIENT_SECRET'),
    mailboxUserId: getEnv('MS_GRAPH_MAILBOX_USER_ID'),
    oneDriveUserId: getEnv('MS_GRAPH_ONEDRIVE_USER_ID'),
    callbackUrl: getEnv('WEBHOOK_CALLBACK_URL'),
    clientState: getEnv('WEBHOOK_CLIENT_STATE')
  },
  oneDrive: {
    cadTemplatePath: getEnv('ONEDRIVE_CAD_TEMPLATE_PATH'),
    cadDestinationPath: getEnv('ONEDRIVE_CAD_DESTINATION_PATH'),
    clientTemplatePath: getEnv('ONEDRIVE_CLIENT_TEMPLATE_PATH'),
    clientDestinationPath: getEnv('ONEDRIVE_CLIENT_DESTINATION_PATH')
  },
  columns: {
    checklistProjectName: getOptionalString('CHECKLIST_PROJECT_NAME_COLUMN', 'Project Name'),
    checklistProjectNumber: getOptionalString('CHECKLIST_PROJECT_NUMBER_COLUMN', 'Project Number'),
    checklistPatterson: getOptionalString('CHECKLIST_PATTERSON_COLUMN', 'Paterson'),
    checklistStatus: getOptionalString('CHECKLIST_STATUS_COLUMN', 'Step Status'),
    checklistStepRef: getOptionalString('CHECKLIST_STEP_REF_COLUMN'),
    checklistValue: getOptionalString('CHECKLIST_VALUE_COLUMN', 'Value'),
    checklistLink: getOptionalString('CHECKLIST_LINK_COLUMN', 'Link'),
    masterProjectNumber: getEnv('MASTER_PROJECT_NUMBER_COLUMN'),
    masterProjectName: getEnv('MASTER_PROJECT_NAME_COLUMN')
  },
  rows: {
    projectName: getOptionalString('CHECKLIST_PROJECT_NAME_ROW_LABEL', 'Project Name'),
    projectNumber: getOptionalString('CHECKLIST_PROJECT_NUMBER_ROW_LABEL', 'Project Number'),
    signed: getOptionalString('CHECKLIST_SIGNED_ROW_LABEL', 'Signed Contract'),
    manualSummary: getOptionalString('CHECKLIST_MANUAL_SUMMARY_ROW_LABEL')
  },
  projectPlanSectionNames: getCsv('PROJECT_PLAN_SECTION_NAMES'),
  projectTypeEmailLabels: getCsv('PROJECT_TYPE_EMAIL_LABELS'),
  signedKeyword: getEnv('SIGNED_KEYWORD'),
  manualCheckpointOwnerEmail: getEnv('MANUAL_CHECKPOINT_OWNER_EMAIL')
};
