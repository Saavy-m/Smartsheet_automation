// Step 05 records manual handoff metadata for the final automation report.
// run() builds the dashboard/Dynamic View handoff summary for the report email.
// Helper functions format email/status/problem text and resolve source/destination URLs.

const config = require('../../config');
const { childLogger } = require('../utils/logger');

const DYNAMIC_VIEW_SOURCE_URL = 'https://app.smartsheet.com/dynamicview/views/d9e9377f-6857-4475-9853-b6eb27571526/admin/basic';
const DYNAMIC_VIEW_SHARED_DOMAINS = [
  'CMR-Design.com',
  'LiviaDesigngroup.com',
  'LiviaDesign.com',
  'SusanStraussDesign.com'
];

async function run(ctx) {
  const log = childLogger(ctx, 'step05');
  const manualTasks = await buildManualTasks(ctx, log);
  const summary = buildManualSummary(ctx, manualTasks);

  ctx.manualCheckpoint = {
    owner: config.manualCheckpointOwnerEmail,
    ordersReportUrl: manualTasks[0].sourceUrl,
    dashboardUrl: manualTasks[0].destinationUrl,
    tasks: manualTasks,
    summary,
    warnings: []
  };

  log.info({ owner: config.manualCheckpointOwnerEmail }, 'manual checkpoint handoff recorded');
  return ctx;
}

async function buildManualTasks(ctx, log) {
  const ordersReportUrl = await resolveOrdersReportUrl(ctx, log);
  const dashboardUrl = await resolveDashboardUrl(ctx, log);

  return [
    {
      id: 'publish-order-report-widget',
      title: 'Publish the Order Report Widget to the dashboard',
      sourceLabel: 'Project Order report',
      sourceUrl: ordersReportUrl,
      destinationLabel: 'Project Dashboard',
      destinationUrl: dashboardUrl,
      details: 'Click Publish in the Order report, copy the provided embed code, then open the destination dashboard and double click the current widget to replace it.'
    },
    {
      id: 'publish-dynamic-view-pencil-widget',
      title: 'Publish Dynamic View to pencil icon',
      sourceLabel: 'Dynamic View sharing settings',
      sourceUrl: DYNAMIC_VIEW_SOURCE_URL,
      destinationLabel: 'Project Dashboard',
      destinationUrl: dashboardUrl,
      sharedDomains: DYNAMIC_VIEW_SHARED_DOMAINS,
      details: 'Go to the Dynamic View source, open the Sharing tab, add the shared domains, return to View, copy the browser URL, then open the destination dashboard and double click the pencil widget. Paste the copied URL under widget behavior.'
    }
  ];
}

function buildManualSummary(ctx, manualTasks) {
  const lines = ['Manual steps remaining:'];

  manualTasks.forEach((task, index) => {
    lines.push(
      '',
      `${index + 1}. ${task.title}`,
      `Source: ${task.sourceUrl || `${task.sourceLabel} URL unavailable`}`,
      `Destination: ${task.destinationUrl || `${task.destinationLabel} URL unavailable`}`
    );
    if (task.sharedDomains?.length) {
      lines.push(`Shared domains: ${task.sharedDomains.join(', ')}`);
    }
    lines.push(`Task details: ${task.details}`);
  });

  lines.push('', `Signed contract: ${formatSignedStatus(ctx)}`, '', formatProblems(ctx));
  return lines.join('\n');
}

async function resolveOrdersReportUrl(ctx, log) {
  const reportId = ctx.reportIds?.ordersReport || findProjectOrderReportId(ctx);
  if (!reportId) {
    return ctx.publishedUrls?.ordersReport || '';
  }

  try {
    const report = (await ctx.clients.smartsheet.get(`/reports/${reportId}`)).data;
    return report.permalink || ctx.publishedUrls?.ordersReport || '';
  } catch (error) {
    log.warn({ err: error, reportId }, 'could not resolve Project Order report URL for manual checkpoint');
    return ctx.publishedUrls?.ordersReport || '';
  }
}

function findProjectOrderReportId(ctx) {
  const match = (ctx.reportIds?.updatedReports || []).find((report) => {
    const name = `${report.afterName || ''} ${report.beforeName || ''}`.toLowerCase();
    return name.includes('project order') || name.includes('orders report') || name.includes('order report');
  });
  return match?.afterId || match?.beforeId || '';
}

async function resolveDashboardUrl(ctx, log) {
  if (ctx.projectDashboardUrl) {
    return ctx.projectDashboardUrl;
  }

  const folderId = ctx.folderIds?.projectToolkit || ctx.folderIds?.projectFolder;
  if (!folderId) {
    return '';
  }

  try {
    const folder = (await ctx.clients.smartsheet.get(`/folders/${folderId}`)).data;
    const dashboard = await findProjectDashboard(ctx.clients.smartsheet, folder);
    if (!dashboard) {
      return '';
    }
    const dashboardUrl = dashboard.permalink || await resolveDashboardPermalink(ctx.clients.smartsheet, dashboard.id, log);
    ctx.projectDashboardUrl = dashboardUrl;
    return dashboardUrl;
  } catch (error) {
    log.warn({ err: error, folderId }, 'could not resolve Project Dashboard URL for manual checkpoint');
    return '';
  }
}

async function findProjectDashboard(smartsheet, container) {
  const match = (container.sights || []).find((item) => String(item.name || '').toLowerCase().includes('project dashboard'));
  if (match) {
    return match;
  }

  for (const folder of container.folders || []) {
    const folderDetails = folder.sights ? folder : (await smartsheet.get(`/folders/${folder.id}`)).data;
    const nested = await findProjectDashboard(smartsheet, folderDetails);
    if (nested) {
      return nested;
    }
  }

  return null;
}

async function resolveDashboardPermalink(smartsheet, dashboardId, log) {
  try {
    const dashboard = (await smartsheet.get(`/sights/${dashboardId}`)).data;
    return dashboard.permalink || '';
  } catch (error) {
    log.warn({ err: error, dashboardId }, 'could not resolve Project Dashboard permalink');
    return dashboardId ? `https://app.smartsheet.com/dashboards/${encodeURIComponent(dashboardId)}` : '';
  }
}

function formatSignedStatus(ctx) {
  if (ctx.contract?.needsManualReview) {
    return `Needs manual review (${ctx.contract.reason})`;
  }
  if (ctx.contract?.signed === true) {
    return ctx.contract.signedLine || 'Yes';
  }
  if (ctx.contract?.signed === false) {
    return 'No';
  }
  return 'Not checked';
}

function formatProblems(ctx) {
  const problems = ctx.problems || [];
  if (problems.length === 0) {
    return 'Automation problems: None reported.';
  }
  return ['Automation problems:', ...problems.map(formatProblem)].join('\n');
}

function formatProblem(problem) {
  const lines = [`- ${problem.step}: ${problem.message}`];
  if (problem.guidance) {
    lines.push(`  Guidance: ${problem.guidance}`);
  }
  return lines.join('\n');
}

module.exports = { run };
