var SHEET_NAME = 'Interview Tracker';
var PIPELINE_SHEET_NAME = 'Pipeline Overview';
var HEADERS = ['Date/Time', 'Company', 'Role', 'Round', 'Interviewer(s)', 'Type',
  'Key Talking Points', 'Comp Range', 'Status', 'Prep Doc', 'Calendar Link', 'Notes', 'API Cost'];
var PIPELINE_HEADERS = ['Company', 'Role', 'Status', 'Current Stage', 'Rounds',
  'Days Silent', 'Next Action', 'Last Activity', 'Notes'];
var COLUMN_WIDTHS = [180, 150, 200, 70, 200, 120, 350, 140, 100, 100, 100, 200, 90];
var PIPELINE_COLUMN_WIDTHS = [150, 200, 100, 140, 70, 90, 140, 140, 250];

function writeToSheet(event, prep, docUrl, apiCost) {
  var sheet = getOrCreateTrackerSheet_();

  var interviewers = (prep.interviewer_names || []).join(', ');

  var points = (prep.sheet_talking_points && prep.sheet_talking_points.length > 0)
    ? prep.sheet_talking_points
    : (prep.key_talking_points || []).slice(0, 3);
  var talkingPoints = points.map(function (tp) {
    return '• ' + tp;
  }).join('\n');

  var status = determineStatus_(event.startTime);
  var costStr = apiCost !== undefined ? apiCost.toFixed(4) : '';

  var comp = prep.compensation || {};
  var compDisplay = comp.base_range || '';
  if (comp.total_comp_range) {
    compDisplay += ' (TC: ' + comp.total_comp_range + ')';
  }

  var row = [
    formatDateTime_(event.startTime),
    prep.company_name,
    prep.role_title,
    prep.round_number || 1,
    interviewers,
    prep.interview_type,
    truncate_(talkingPoints, 500),
    compDisplay,
    status,
    docUrl ? '=HYPERLINK("' + docUrl + '","Open Doc")' : '',
    '',
    '',
    costStr
  ];

  sheet.appendRow(row);
  var lastRow = sheet.getLastRow();

  applyRowFormatting_(sheet, lastRow, status);
  updateCostSummary_(sheet);

  console.log('Added row ' + lastRow + ' to tracker sheet (round ' + (prep.round_number || 1) + ', API cost: $' + costStr + ')');
  return lastRow;
}

function getOrCreateTrackerSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_NAME);

  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setBackground('#336AB5');
  headerRange.setHorizontalAlignment('center');

  sheet.setFrozenRows(1);

  for (var i = 0; i < COLUMN_WIDTHS.length; i++) {
    sheet.setColumnWidth(i + 1, COLUMN_WIDTHS[i]);
  }

  sheet.getRange('M:M').setNumberFormat('$#,##0.0000');

  // Create Pipeline Overview tab
  var pipelineSheet = ss.getSheetByName(PIPELINE_SHEET_NAME);
  if (!pipelineSheet) {
    pipelineSheet = ss.insertSheet(PIPELINE_SHEET_NAME);
    var pHeaderRange = pipelineSheet.getRange(1, 1, 1, PIPELINE_HEADERS.length);
    pHeaderRange.setValues([PIPELINE_HEADERS]);
    pHeaderRange.setFontWeight('bold');
    pHeaderRange.setFontColor('#FFFFFF');
    pHeaderRange.setBackground('#336AB5');
    pHeaderRange.setHorizontalAlignment('center');
    pipelineSheet.setFrozenRows(1);
    for (var j = 0; j < PIPELINE_COLUMN_WIDTHS.length; j++) {
      pipelineSheet.setColumnWidth(j + 1, PIPELINE_COLUMN_WIDTHS[j]);
    }
  }

  console.log('Created "' + SHEET_NAME + '" sheet with headers');
  return sheet;
}

function determineStatus_(startTime) {
  var now = new Date();
  var diffMs = startTime.getTime() - now.getTime();
  var diffHours = diffMs / (1000 * 60 * 60);

  if (diffMs < 0) return 'Completed';
  if (diffHours < 24) return 'Imminent';
  return 'Upcoming';
}

function applyRowFormatting_(sheet, rowNum, status) {
  var colorMap = {
    'Upcoming': '#D9EAD3',
    'Imminent': '#FFF2CC',
    'Completed': '#E8E8E8'
  };

  var bg = colorMap[status] || '#FFFFFF';
  sheet.getRange(rowNum, 9).setBackground(bg);
}

function syncPipelineSheet_(pipelines) {
  if (!pipelines || pipelines.length === 0) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PIPELINE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PIPELINE_SHEET_NAME);
    var pHeaderRange = sheet.getRange(1, 1, 1, PIPELINE_HEADERS.length);
    pHeaderRange.setValues([PIPELINE_HEADERS]);
    pHeaderRange.setFontWeight('bold');
    pHeaderRange.setFontColor('#FFFFFF');
    pHeaderRange.setBackground('#336AB5');
    pHeaderRange.setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    for (var j = 0; j < PIPELINE_COLUMN_WIDTHS.length; j++) {
      sheet.setColumnWidth(j + 1, PIPELINE_COLUMN_WIDTHS[j]);
    }
  }

  var rows = [];
  for (var i = 0; i < pipelines.length; i++) {
    var p = pipelines[i];
    rows.push([
      p.companyName,
      p.roleTitle || '',
      p.status,
      p.currentStage,
      p.stageCount,
      p.daysSilent,
      p.nextAction,
      p.lastActivity,
      truncate_(p.latestNote || '', 200)
    ]);
  }

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, PIPELINE_HEADERS.length).clearContent();
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, PIPELINE_HEADERS.length).setValues(rows);
  }

  applyPipelineFormatting_(sheet, pipelines);
  console.log('Pipeline overview synced: ' + rows.length + ' rows');
}

function applyPipelineFormatting_(sheet, pipelines) {
  var statusColors = {
    'Active': '#D9EAD3',
    'Offer': '#CFE2F3',
    'Rejected': '#F4CCCC',
    'Withdrawn': '#E8E8E8'
  };

  for (var i = 0; i < pipelines.length; i++) {
    var bg = statusColors[pipelines[i].status] || '#FFFFFF';
    sheet.getRange(i + 2, 3).setBackground(bg);

    if (pipelines[i].needsFollowUp || pipelines[i].daysSilent > 7) {
      sheet.getRange(i + 2, 7).setBackground('#FCE5CD').setFontWeight('bold');
    }
  }
}

function updateCostSummary_(sheet) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var summarySheet = ss.getSheetByName('Summary');

  if (!summarySheet) {
    summarySheet = ss.insertSheet('Summary');
    summarySheet.getRange('A1').setValue('Total API Cost').setFontWeight('bold');
    summarySheet.getRange('A2').setValue('Last Updated').setFontWeight('bold');
    summarySheet.getRange('A3').setValue('Interviews Processed').setFontWeight('bold');
    summarySheet.setColumnWidth(1, 180);
    summarySheet.setColumnWidth(2, 220);
  }

  var trackerSheet = ss.getSheetByName(SHEET_NAME);
  var lastRow = trackerSheet.getLastRow();

  if (lastRow < 2) {
    summarySheet.getRange('B1').setValue(0).setNumberFormat('$#,##0.0000');
    summarySheet.getRange('B2').setValue(new Date());
    summarySheet.getRange('B3').setValue(0);
    return;
  }

  summarySheet.getRange('B1').setFormula(
    '=SUM(\'' + SHEET_NAME + '\'!M2:M)'
  ).setNumberFormat('$#,##0.0000');

  summarySheet.getRange('B2').setValue(new Date()).setNumberFormat('yyyy-MM-dd hh:mm:ss a');

  summarySheet.getRange('B3').setFormula(
    '=COUNTA(\'' + SHEET_NAME + '\'!A2:A)'
  );
}
