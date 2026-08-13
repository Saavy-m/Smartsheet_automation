require('dotenv').config();

const REQUIRED = [
  'SMARTSHEET_API_TOKEN',
  'SMARTSHEET_GEN009_TEMPLATE_ID',
  'SMARTSHEET_Z_ACTIVE_WORKSPACE_ID',
  'SMARTSHEET_MASTER_PROJECT_LIST_SHEET_ID',
  'OFFICE_ADMIN_GROUP_ID',
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
  'ONEDRIVE_CLIENT_PRODUCTION_PATH',
  'ORDERS_REPORT_PUBLISH_ACCESS_LEVEL',
  'SIGNED_KEYWORD',
  'UNSIGNED_KEYWORD',
  'MANUAL_CHECKPOINT_OWNER_EMAIL',
  'CHECKLIST_PROJECT_NAME_COLUMN',
  'CHECKLIST_PROJECT_NUMBER_COLUMN',
  'CHECKLIST_PATTERSON_COLUMN',
  'CHECKLIST_STATUS_COLUMN',
  'CHECKLIST_STEP_REF_COLUMN',
  'CHECKLIST_VALUE_COLUMN',
  'CHECKLIST_LINK_COLUMN',
  'CHECKLIST_PROJECT_NAME_ROW_LABEL',
  'CHECKLIST_PROJECT_NUMBER_ROW_LABEL',
  'CHECKLIST_SIGNED_ROW_LABEL',
  'CHECKLIST_MANUAL_SUMMARY_ROW_LABEL',
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

function validate() {
  REQUIRED.forEach(getEnv);
}

validate();

module.exports = {
  port: Number(getEnv('PORT')),
  dryRun: getBoolean('DRY_RUN'),
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
    officeAdminGroupId: getEnv('OFFICE_ADMIN_GROUP_ID')
  },
  graph: {
    tenantId: getEnv('MS_GRAPH_TENANT_ID'),
    clientId: getEnv('MS_GRAPH_CLIENT_ID'),
    clientSecret: getEnv('MS_GRAPH_CLIENT_SECRET'),
    mailboxUserId: getEnv('MS_GRAPH_MAILBOX_USER_ID'),
    oneDriveUserId: getEnv('MS_GRAPH_ONEDRIVE_USER_ID'),
    callbackUrl: getEnv('WEBHOOK_CALLBACK_URL'),
    clientState: getEnv('WEBHOOK_CLIENT_STATE')
  },
  oneDrive: {
    cadTemplatePath: getEnv('ONEDRIVE_CAD_TEMPLATE_PATH'),
    cadDestinationPath: getEnv('ONEDRIVE_CAD_DESTINATION_PATH'),
    clientTemplatePath: getEnv('ONEDRIVE_CLIENT_TEMPLATE_PATH'),
    clientDestinationPath: getEnv('ONEDRIVE_CLIENT_DESTINATION_PATH'),
    clientProductionPath: getEnv('ONEDRIVE_CLIENT_PRODUCTION_PATH')
  },
  columns: {
    checklistProjectName: getEnv('CHECKLIST_PROJECT_NAME_COLUMN'),
    checklistProjectNumber: getEnv('CHECKLIST_PROJECT_NUMBER_COLUMN'),
    checklistPatterson: getEnv('CHECKLIST_PATTERSON_COLUMN'),
    checklistStatus: getEnv('CHECKLIST_STATUS_COLUMN'),
    checklistStepRef: getEnv('CHECKLIST_STEP_REF_COLUMN'),
    checklistValue: getEnv('CHECKLIST_VALUE_COLUMN'),
    checklistLink: getEnv('CHECKLIST_LINK_COLUMN'),
    masterProjectNumber: getEnv('MASTER_PROJECT_NUMBER_COLUMN'),
    masterProjectName: getEnv('MASTER_PROJECT_NAME_COLUMN')
  },
  rows: {
    projectName: getEnv('CHECKLIST_PROJECT_NAME_ROW_LABEL'),
    projectNumber: getEnv('CHECKLIST_PROJECT_NUMBER_ROW_LABEL'),
    signed: getEnv('CHECKLIST_SIGNED_ROW_LABEL'),
    manualSummary: getEnv('CHECKLIST_MANUAL_SUMMARY_ROW_LABEL')
  },
  projectPlanSectionNames: getCsv('PROJECT_PLAN_SECTION_NAMES'),
  projectTypeEmailLabels: getCsv('PROJECT_TYPE_EMAIL_LABELS'),
  signedKeyword: getEnv('SIGNED_KEYWORD'),
  manualCheckpointOwnerEmail: getEnv('MANUAL_CHECKPOINT_OWNER_EMAIL')
};
