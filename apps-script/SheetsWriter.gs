var SHEET_NAME = 'Interview Tracker';
var PIPELINE_SHEET_NAME = 'Pipeline Overview';
var HEADERS = ['Date/Time', 'Company', 'Role', 'Round', 'Interviewer(s)', 'Type',
  'Key Talking Points', 'Comp Range', 'Status', 'Prep Doc', 'Calendar Link', 'Notes', 'API Cost'];
var PIPELINE_HEADERS = ['Company', 'Role', 'Status', 'Current Stage', 'Rounds',
  'Days Silent', 'Next Action', 'Last Activity', 'Latest Note', 'Custom Context'];
var COLUMN_WIDTHS = [180, 150, 200, 70, 200, 120, 350, 140, 100, 100, 100, 200, 90];
var PIPELINE_COLUMN_WIDTHS = [150, 200, 100, 140, 70, 90, 140, 140, 200, 280];

var CUSTOM_CONTEXT_COL = 10; // 1-indexed column in Pipeline Overview

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
  } else {
    // Migrate existing sheets that may be missing newer headers (e.g. Custom Context column).
    var headerRow = sheet.getRange(1, 1, 1, PIPELINE_HEADERS.length).getValues()[0];
    var needsHeaderRewrite = false;
    for (var hh = 0; hh < PIPELINE_HEADERS.length; hh++) {
      if (headerRow[hh] !== PIPELINE_HEADERS[hh]) { needsHeaderRewrite = true; break; }
    }
    if (needsHeaderRewrite) {
      var rewriteRange = sheet.getRange(1, 1, 1, PIPELINE_HEADERS.length);
      rewriteRange.setValues([PIPELINE_HEADERS]);
      rewriteRange.setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#336AB5').setHorizontalAlignment('center');
      for (var jj = 0; jj < PIPELINE_COLUMN_WIDTHS.length; jj++) {
        sheet.setColumnWidth(jj + 1, PIPELINE_COLUMN_WIDTHS[jj]);
      }
      console.log('Pipeline Overview headers migrated to ' + PIPELINE_HEADERS.length + ' columns');
    }
  }

  // Preserve user-entered Custom Context before clearing rows.
  var existingContext = readCustomContextFromSheet_(sheet);

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
      truncate_(p.latestNote || '', 200),
      existingContext[p.companyKey] || ''
    ]);
  }

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, PIPELINE_HEADERS.length).clearContent();
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, PIPELINE_HEADERS.length).setValues(rows);
    // Tint the Custom Context column so it's visibly editable
    sheet.getRange(2, CUSTOM_CONTEXT_COL, rows.length, 1).setBackground('#FFF9E6');
  }

  applyPipelineFormatting_(sheet, pipelines);
  console.log('Pipeline overview synced: ' + rows.length + ' rows');
}

// Read existing Custom Context entries into a {companyKey: text} map by matching
// on company name (normalized) since the sheet doesn't store the raw key.
function readCustomContextFromSheet_(sheet) {
  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return map;
  var data = sheet.getRange(2, 1, lastRow - 1, PIPELINE_HEADERS.length).getValues();
  for (var i = 0; i < data.length; i++) {
    var companyName = data[i][0];
    var customContext = data[i][CUSTOM_CONTEXT_COL - 1];
    if (companyName && customContext) {
      map[normalizeCompanyKey_(String(companyName))] = String(customContext);
    }
  }
  return map;
}

// Public-ish helper: read the Custom Context for a specific company key.
function getCustomContextForCompany_(companyKey) {
  if (!companyKey) return '';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PIPELINE_SHEET_NAME);
  if (!sheet) return '';
  var map = readCustomContextFromSheet_(sheet);
  return map[companyKey] || '';
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
  var freshlyCreated = false;

  if (!summarySheet) {
    summarySheet = ss.insertSheet('Summary');
    summarySheet.getRange('A1').setValue('Total API Cost').setFontWeight('bold');
    summarySheet.getRange('A2').setValue('Last Updated').setFontWeight('bold');
    summarySheet.getRange('A3').setValue('Interviews Processed').setFontWeight('bold');
    summarySheet.setColumnWidth(1, 180);
    summarySheet.setColumnWidth(2, 220);
    summarySheet.getRange('B1')
      .setFormula('=SUM(\'' + SHEET_NAME + '\'!M2:M)')
      .setNumberFormat('$#,##0.0000');
    summarySheet.getRange('B3').setFormula('=COUNTA(\'' + SHEET_NAME + '\'!A2:A)');
    freshlyCreated = true;
  }

  // B1 and B3 are formulas set once at sheet creation — they recompute on their own.
  // Only B2 (last-updated timestamp) needs to be re-written on each call.
  summarySheet.getRange('B2').setValue(new Date()).setNumberFormat('yyyy-MM-dd hh:mm:ss a');

  if (!freshlyCreated) {
    var b1 = summarySheet.getRange('B1');
    if (!b1.getFormula()) {
      b1.setFormula('=SUM(\'' + SHEET_NAME + '\'!M2:M)').setNumberFormat('$#,##0.0000');
    }
    var b3 = summarySheet.getRange('B3');
    if (!b3.getFormula()) {
      b3.setFormula('=COUNTA(\'' + SHEET_NAME + '\'!A2:A)');
    }
  }
}
