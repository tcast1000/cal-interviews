var SHEET_NAME = 'Interview Tracker';
var HEADERS = ['Date/Time', 'Company', 'Role', 'Interviewer(s)', 'Type',
  'Key Talking Points', 'Status', 'Prep Doc', 'Calendar Link', 'Notes', 'API Cost'];
var COLUMN_WIDTHS = [180, 150, 200, 200, 120, 350, 100, 100, 100, 200, 90];

function writeToSheet(event, prep, docUrl, apiCost) {
  var sheet = getOrCreateTrackerSheet_();

  var interviewers = (prep.interviewer_names || []).join(', ');
  var talkingPoints = (prep.key_talking_points || []).slice(0, 5).map(function (tp) {
    return '• ' + tp;
  }).join('\n');
  var status = determineStatus_(event.startTime);

  var costStr = apiCost !== undefined ? apiCost.toFixed(4) : '';

  var row = [
    formatDateTime_(event.startTime),
    prep.company_name,
    prep.role_title,
    interviewers,
    prep.interview_type,
    truncate_(talkingPoints, 500),
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

  console.log('Added row ' + lastRow + ' to tracker sheet (API cost: $' + costStr + ')');
  return lastRow;
}

function getOrCreateTrackerSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_NAME);

  // Write headers
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setValues([HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setBackground('#336AB5');
  headerRange.setHorizontalAlignment('center');

  // Freeze header row
  sheet.setFrozenRows(1);

  // Set column widths
  for (var i = 0; i < COLUMN_WIDTHS.length; i++) {
    sheet.setColumnWidth(i + 1, COLUMN_WIDTHS[i]);
  }

  // Format cost column as currency
  sheet.getRange('K:K').setNumberFormat('$#,##0.0000');

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
  sheet.getRange(rowNum, 7).setBackground(bg);
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

  // Sum cost column (K = column 11), rows 2 to lastRow
  summarySheet.getRange('B1').setFormula(
    '=SUM(\'' + SHEET_NAME + '\'!K2:K)'
  ).setNumberFormat('$#,##0.0000');

  summarySheet.getRange('B2').setValue(new Date()).setNumberFormat('yyyy-MM-dd hh:mm:ss a');

  summarySheet.getRange('B3').setFormula(
    '=COUNTA(\'' + SHEET_NAME + '\'!A2:A)'
  );
}
