function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Interview Prep')
    .addItem('Run Manual Check', 'runManualCheck')
    .addItem('Refresh All Upcoming', 'refreshAllUpcoming')
    .addItem('View Pipeline', 'viewPipeline')
    .addSeparator()
    .addItem('Setup API Keys', 'setupApiKeys')
    .addItem('Install Calendar Trigger', 'installCalendarTrigger')
    .addItem('Check Setup', 'checkSetup')
    .addToUi();
}

function onCalendarUpdate(e) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.log('Another execution is running, skipping');
    return;
  }

  try {
    pruneOldEntries_();
    var validation = validateConfig();
    if (!validation.valid) {
      console.error('Config errors: ' + validation.errors.join(', '));
      return;
    }

    var events = getNewInterviewEvents();
    if (events.length === 0) {
      console.log('No new interview events to process');
      return;
    }

    console.log('Found ' + events.length + ' new interview event(s)');

    var toProcess = events.slice(0, MAX_EVENTS_PER_RUN);
    var remaining = events.slice(MAX_EVENTS_PER_RUN);

    for (var i = 0; i < toProcess.length; i++) {
      processEvent_(toProcess[i]);
    }

    if (remaining.length > 0) {
      console.log(remaining.length + ' events remain, scheduling continuation...');
      var queue = remaining.map(function (ev) { return ev.eventId; });
      savePendingQueue_(queue);
      ScriptApp.newTrigger('continueProcessing_')
        .timeBased()
        .after(30 * 1000)
        .create();
    }
  } finally {
    lock.releaseLock();
  }
}

function continueProcessing_() {
  // Clean up the trigger that fired this
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'continueProcessing_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;

  try {
    var queuedIds = getPendingQueue_();
    if (queuedIds.length === 0) return;

    var allEvents = getInterviewEvents();
    var toProcess = [];
    for (var i = 0; i < allEvents.length; i++) {
      if (queuedIds.indexOf(allEvents[i].eventId) !== -1 && !isProcessed_(allEvents[i].eventId)) {
        toProcess.push(allEvents[i]);
      }
    }

    var batch = toProcess.slice(0, MAX_EVENTS_PER_RUN);
    var remaining = toProcess.slice(MAX_EVENTS_PER_RUN);

    for (var i = 0; i < batch.length; i++) {
      processEvent_(batch[i]);
    }

    if (remaining.length > 0) {
      var queue = remaining.map(function (ev) { return ev.eventId; });
      savePendingQueue_(queue);
      ScriptApp.newTrigger('continueProcessing_')
        .timeBased()
        .after(30 * 1000)
        .create();
    } else {
      savePendingQueue_([]);
    }
  } finally {
    lock.releaseLock();
  }
}

function processEvent_(event) {
  resetRunUsage_();

  console.log('');
  console.log('========================================');
  console.log('Processing: ' + event.title);
  console.log('  Date: ' + formatDate_(event.startTime) + ' at ' + formatTime_(event.startTime));
  console.log('  Type: ' + event.interviewType);
  console.log('========================================');

  // Step 1: Gmail enrichment
  console.log('[1/6] Enriching from Gmail...');
  try {
    event = enrichFromGmail(event);
  } catch (e) {
    console.warn('Gmail enrichment failed (continuing): ' + e);
  }
  console.log('  Company: ' + (event.companyName || '(unknown)'));
  console.log('  Role: ' + (event.roleTitle || '(unknown)'));

  // Step 2: Web research
  console.log('[2/6] Researching...');
  var research;
  try {
    research = researchInterview(event);
  } catch (e) {
    console.warn('Research failed: ' + e);
    research = {
      companyInfo: [], productsAndServices: [], competitors: [],
      companyNews: [], roleInfo: [], interviewerInfo: {},
      glassdoorInfo: [], compensationInfo: []
    };
  }

  // Step 3: Claude synthesis
  console.log('[3/6] Synthesizing prep materials...');
  var prep;
  try {
    prep = synthesizePrep(event, research);
  } catch (e) {
    console.error('Synthesis failed: ' + e);
    logError_(event.title, 'Synthesis failed: ' + e);
    return;
  }

  // Step 4: Create Google Doc
  console.log('[4/6] Creating Google Doc...');
  var docUrl = '';
  try {
    docUrl = createPrepDoc(prep);
  } catch (e) {
    console.error('Doc creation failed: ' + e);
    logError_(event.title, 'Doc creation failed: ' + e);
  }

  // Calculate API cost for this event
  var apiCost = getRunCost_();
  console.log('  API cost for this event: $' + apiCost.toFixed(4));

  // Step 5: Update tracker sheet
  console.log('[5/6] Updating tracker sheet...');
  var rowNum = 0;
  try {
    rowNum = writeToSheet(event, prep, docUrl, apiCost);
  } catch (e) {
    console.error('Sheet update failed: ' + e);
  }

  // Mark as processed
  if (docUrl) {
    markProcessed_(event.eventId, docUrl, rowNum);
  }

  // Step 6: Register pipeline & sync overview
  console.log('[6/6] Updating pipeline...');
  try {
    registerPipelineEvent_(event, prep, docUrl);
    var summaries = getPipelineSummaries_();
    if (summaries.length > 0) {
      syncPipelineSheet_(summaries);
    }
  } catch (e) {
    console.warn('Pipeline update failed: ' + e);
  }

  console.log('Done! Prep doc: ' + docUrl);
}

function runManualCheck() {
  var ui = SpreadsheetApp.getUi();
  var validation = validateConfig();
  if (!validation.valid) {
    ui.alert('Setup Required', validation.errors.join('\n'), ui.ButtonSet.OK);
    return;
  }

  pruneOldEntries_();
  var events = getNewInterviewEvents();

  if (events.length === 0) {
    ui.alert('No New Interviews', 'No unprocessed interview events found in the next ' +
      getConfig().lookAheadDays + ' days.', ui.ButtonSet.OK);
    return;
  }

  var names = events.map(function (e) {
    return '• ' + e.title + ' — ' + formatDate_(e.startTime);
  }).join('\n');

  var result = ui.alert('Found ' + events.length + ' Interview(s)',
    'Process these interviews?\n\n' + names,
    ui.ButtonSet.YES_NO);

  if (result !== ui.Button.YES) return;

  for (var i = 0; i < events.length; i++) {
    processEvent_(events[i]);
  }

  ui.alert('Complete', events.length + ' interview(s) processed. Check the "' +
    SHEET_NAME + '" sheet and your Google Drive for prep docs.', ui.ButtonSet.OK);
}

function refreshAllUpcoming() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert('Refresh All',
    'This will re-process all upcoming interviews, creating new docs even if they were already processed.\n\nContinue?',
    ui.ButtonSet.YES_NO);

  if (result !== ui.Button.YES) return;

  clearAllProcessed_();
  runManualCheck();
}

function installCalendarTrigger() {
  var ui = SpreadsheetApp.getUi();

  // Remove existing calendar triggers
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onCalendarUpdate') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  var email = Session.getActiveUser().getEmail();
  if (!email) {
    ui.alert('Error', 'Could not detect your email. Please try again.', ui.ButtonSet.OK);
    return;
  }

  ScriptApp.newTrigger('onCalendarUpdate')
    .forUserCalendar(email)
    .onEventUpdated()
    .create();

  var msg = 'Calendar trigger installed for ' + email + '!';
  if (removed > 0) msg += '\n(' + removed + ' old trigger(s) removed)';
  msg += '\n\nThe script will now automatically run when interview events are created or updated on your calendar.';

  ui.alert('Trigger Installed', msg, ui.ButtonSet.OK);
}

function checkSetup() {
  var ui = SpreadsheetApp.getUi();
  var results = [];

  // Check config
  var config = getConfig();
  var validation = validateConfig();
  if (validation.valid) {
    results.push('✓ API keys configured');
  } else {
    for (var i = 0; i < validation.errors.length; i++) {
      results.push('✗ ' + validation.errors[i]);
    }
  }

  // Check Calendar
  try {
    CalendarApp.getDefaultCalendar().getName();
    results.push('✓ Google Calendar accessible');
  } catch (e) {
    results.push('✗ Google Calendar: ' + e);
  }

  // Check Gmail
  try {
    GmailApp.search('test', 0, 1);
    results.push('✓ Gmail accessible');
  } catch (e) {
    results.push('✗ Gmail: ' + e);
  }

  // Check Sheets
  try {
    SpreadsheetApp.getActiveSpreadsheet().getName();
    results.push('✓ Google Sheets accessible');
  } catch (e) {
    results.push('✗ Google Sheets: ' + e);
  }

  // Check Docs
  try {
    var testDoc = DocumentApp.create('__test_delete_me');
    DriveApp.getFileById(testDoc.getId()).setTrashed(true);
    results.push('✓ Google Docs creation works');
  } catch (e) {
    results.push('✗ Google Docs: ' + e);
  }

  // Check Claude API
  if (config.anthropicApiKey) {
    try {
      callClaudeApi_('', 'Say "ok"', 10);
      results.push('✓ Claude API accessible');
    } catch (e) {
      results.push('✗ Claude API: ' + e);
    }
  }

  // Check trigger
  var hasTrigger = false;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onCalendarUpdate') {
      hasTrigger = true;
      break;
    }
  }
  results.push(hasTrigger ? '✓ Calendar trigger installed' : '⚠ Calendar trigger not installed (use "Install Calendar Trigger")');

  // Check Tavily
  if (config.tavilyApiKey) {
    results.push('✓ Tavily API key configured (web search enabled)');
  } else {
    results.push('⚠ No Tavily key (Claude will use training knowledge for research)');
  }

  ui.alert('Setup Check Results', results.join('\n'), ui.ButtonSet.OK);
}

function viewPipeline() {
  var ui = SpreadsheetApp.getUi();
  var summaries = getPipelineSummaries_();

  if (summaries.length === 0) {
    ui.alert('Pipeline', 'No active pipelines.', ui.ButtonSet.OK);
    return;
  }

  syncPipelineSheet_(summaries);

  var lines = [];
  for (var i = 0; i < summaries.length; i++) {
    var s = summaries[i];
    var flag = '';
    if (s.needsDebrief) flag = ' [DEBRIEF NEEDED]';
    else if (s.needsFollowUp) flag = ' [FOLLOW UP]';
    else if (s.daysSilent > 7) flag = ' [' + s.daysSilent + 'd silent]';

    lines.push(s.companyName + ' — ' + (s.roleTitle || 'Role TBD'));
    lines.push('  Status: ' + s.status + ' | Stage: ' + s.currentStage + ' | Rounds: ' + s.stageCount + flag);
    if (s.nextAction !== 'None') lines.push('  Next: ' + s.nextAction);
    lines.push('');
  }

  ui.alert('Interview Pipeline (' + summaries.length + ' active)', lines.join('\n'), ui.ButtonSet.OK);
}

function logError_(eventTitle, errorMsg) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var errorSheet = ss.getSheetByName('Errors');
    if (!errorSheet) {
      errorSheet = ss.insertSheet('Errors');
      errorSheet.appendRow(['Timestamp', 'Event', 'Error']);
      errorSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    }
    errorSheet.appendRow([new Date().toISOString(), eventTitle, errorMsg]);
  } catch (e) {
    console.error('Could not log error to sheet: ' + e);
  }
}
