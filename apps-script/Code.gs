function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Interview Prep')
    .addItem('Run Manual Check', 'runManualCheck')
    .addItem('Refresh All Upcoming', 'refreshAllUpcoming')
    .addItem('Run Sample Event (test)', 'runSampleEvent')
    .addItem('View Pipeline', 'viewPipeline')
    .addItem('Log Debrief', 'logDebrief')
    .addItem('Update Pipeline Status', 'updatePipelineStatusMenu')
    .addSeparator()
    .addItem('Set Resume from Drive', 'setResumeFromDriveMenu')
    .addItem('Clear Research Cache', 'clearResearchCacheMenu')
    .addItem('Reset Company Pipeline', 'resetCompanyPipelineMenu')
    .addSeparator()
    .addItem('Setup API Keys', 'setupApiKeys')
    .addItem('Install Calendar Trigger', 'installCalendarTrigger')
    .addItem('Install Daily Reminder Trigger', 'installDailyReminderTrigger')
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
  console.log('Processing' + (event._isUpdate ? ' (updated)' : '') + ': ' + event.title);
  console.log('  Date: ' + formatDate_(event.startTime) + ' at ' + formatTime_(event.startTime));
  console.log('  Type: ' + event.interviewType);
  console.log('========================================');

  // Step 1: Gmail enrichment
  console.log('[1/7] Enriching from Gmail...');
  try {
    event = enrichFromGmail(event);
  } catch (e) {
    console.warn('Gmail enrichment failed (continuing): ' + e);
  }
  console.log('  Company: ' + (event.companyName || '(unknown)'));
  console.log('  Role: ' + (event.roleTitle || '(unknown)'));

  // Determine round number and load cached company research if round 2+
  var companyKeyGuess = resolveCompanyKey_(event.companyName || '');
  var roundNumber = companyKeyGuess ? getRoundNumber_(companyKeyGuess, event.eventId) : 1;
  var cached = (companyKeyGuess && roundNumber > 1) ? getCachedCompanyResearch_(companyKeyGuess) : null;
  if (roundNumber > 1) {
    console.log('  Detected round ' + roundNumber + ' (cached company research: ' + (cached ? 'yes' : 'no') + ')');
  }

  // Step 2: Web research
  console.log('[2/7] Researching...');
  var research;
  try {
    research = researchInterview(event, cached);
  } catch (e) {
    console.warn('Research failed: ' + e);
    research = {
      companyInfo: [], productsAndServices: [], competitors: [],
      companyNews: [], roleInfo: [], interviewerInfo: {},
      glassdoorInfo: [], compensationInfo: [],
      valuesInfo: [], socialLinks: {},
      jobDescriptionUrl: '', jobDescriptionSource: '',
      fromCache: false
    };
  }

  // Step 3: Summarize prior debriefs if round 2+
  var roundContext = { roundNumber: roundNumber, summary: [], appendix: [] };
  if (roundNumber > 1 && companyKeyGuess) {
    var priorStages = getPriorStages_(companyKeyGuess, event.eventId);
    if (priorStages.length > 0) {
      console.log('[3/7] Summarizing ' + priorStages.length + ' prior round(s)...');
      try {
        var summarized = summarizePriorDebriefs_(priorStages);
        roundContext.summary = summarized.summary;
        roundContext.appendix = summarized.appendix;
      } catch (e) {
        console.warn('Prior-debrief summarization failed: ' + e);
      }
    }
  }

  // Step 4: Claude synthesis (with optional per-company custom context)
  console.log('[4/7] Synthesizing prep materials (round ' + roundNumber + ')...');
  if (companyKeyGuess) {
    try {
      var customContext = getCustomContextForCompany_(companyKeyGuess);
      if (customContext) {
        roundContext.customContext = customContext;
        console.log('  Loaded ' + customContext.length + ' chars of custom context for ' + companyKeyGuess);
      }
    } catch (e) {
      console.warn('Could not read custom context: ' + e);
    }
  }
  var prep;
  try {
    prep = synthesizePrep(event, research, roundContext);
  } catch (e) {
    console.error('Synthesis failed: ' + e);
    logError_(event.title, 'Synthesis failed: ' + e);
    return;
  }

  // Step 5: Create Google Doc
  console.log('[5/7] Creating Google Doc...');
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

  // Step 6: Update tracker sheet
  console.log('[6/7] Updating tracker sheet...');
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

  // Step 7: Register pipeline, cache research, sync overview
  console.log('[7/7] Updating pipeline...');
  try {
    var companyKey = registerPipelineEvent_(event, prep, docUrl);
    if (!research.fromCache) {
      try {
        cacheCompanyResearch_(companyKey, researchToCacheDict_(research));
        console.log('  Company research cached for next round');
      } catch (e) {
        console.warn('Could not cache company research: ' + e);
      }
    }
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

  var toProcess = events.slice(0, MAX_EVENTS_PER_RUN);
  var remaining = events.slice(MAX_EVENTS_PER_RUN);

  for (var i = 0; i < toProcess.length; i++) {
    processEvent_(toProcess[i]);
  }

  var msg = toProcess.length + ' interview(s) processed. Check the "' +
    SHEET_NAME + '" sheet and your Google Drive for prep docs.';

  if (remaining.length > 0) {
    var queue = remaining.map(function (ev) { return ev.eventId; });
    savePendingQueue_(queue);
    ScriptApp.newTrigger('continueProcessing_')
      .timeBased()
      .after(30 * 1000)
      .create();
    msg += '\n\n' + remaining.length + ' more queued — they will process automatically in ~30 seconds (Apps Script execution-time limits prevent doing them all in one batch).';
  }

  ui.alert('Complete', msg, ui.ButtonSet.OK);
}

function refreshAllUpcoming() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert('Refresh All',
    'This will re-process all upcoming interviews, creating new docs even if they were already processed. Cached company research will also be cleared so every doc gets fresh research.\n\nContinue?',
    ui.ButtonSet.YES_NO);

  if (result !== ui.Button.YES) return;

  clearAllProcessed_();
  clearCompanyResearchCache_(null);
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

function logDebrief() {
  var ui = SpreadsheetApp.getUi();
  var summaries = getPipelineSummaries_();
  if (summaries.length === 0) {
    ui.alert('No Pipelines', 'No active pipelines found. Process an interview first.', ui.ButtonSet.OK);
    return;
  }

  var lines = [];
  for (var i = 0; i < summaries.length; i++) {
    lines.push((i + 1) + '. ' + summaries[i].companyName + ' — ' + (summaries[i].roleTitle || 'Role TBD') +
      ' (' + summaries[i].stageCount + ' round' + (summaries[i].stageCount === 1 ? '' : 's') + ')');
  }

  var pick = ui.prompt(
    'Log Debrief — Pick a Company',
    'Active pipelines:\n\n' + lines.join('\n') + '\n\nEnter the number of the company to log a debrief for:',
    ui.ButtonSet.OK_CANCEL
  );
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  var idx = parseInt(pick.getResponseText().trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= summaries.length) {
    ui.alert('Invalid selection.');
    return;
  }

  var companyKey = summaries[idx].companyKey;
  var pipeline = getPipelines_()[companyKey];
  if (!pipeline) {
    ui.alert('Pipeline not found.');
    return;
  }

  var stages = pipeline.stages || [];
  var stageLines = [];
  for (var s = 0; s < stages.length; s++) {
    var dateLabel = (stages[s].eventDate || '').substring(0, 10);
    var debriefedFlag = stages[s].debrief ? ' [debriefed]' : '';
    stageLines.push((s + 1) + '. ' + stages[s].stageType + ' on ' + dateLabel + debriefedFlag);
  }

  var stagePick = ui.prompt(
    'Pick a Round',
    'Rounds for ' + pipeline.companyName + ':\n\n' + stageLines.join('\n') + '\n\nEnter the round number:',
    ui.ButtonSet.OK_CANCEL
  );
  if (stagePick.getSelectedButton() !== ui.Button.OK) return;
  var stageIdx = parseInt(stagePick.getResponseText().trim(), 10) - 1;
  if (isNaN(stageIdx) || stageIdx < 0 || stageIdx >= stages.length) {
    ui.alert('Invalid selection.');
    return;
  }

  var notesPick = ui.prompt(
    'Debrief Notes',
    'Paste your debrief notes for ' + pipeline.companyName + ' — ' + stages[stageIdx].stageType + '.\n\n' +
    'Tip: if you use Granola or any other notes app, copy the meeting summary here. ' +
    'These notes will be summarized and surfaced in your prep doc for the next round.',
    ui.ButtonSet.OK_CANCEL
  );
  if (notesPick.getSelectedButton() !== ui.Button.OK) return;
  var notes = notesPick.getResponseText().trim();
  if (!notes) {
    ui.alert('Empty notes — nothing saved.');
    return;
  }

  var pipelines = getPipelines_();
  pipelines[companyKey].stages[stageIdx].debrief = notes;
  pipelines[companyKey].lastActivity = new Date().toISOString();
  savePipelines_(pipelines);

  ui.alert('Saved', 'Debrief saved for ' + pipeline.companyName + ' — ' + stages[stageIdx].stageType + '.', ui.ButtonSet.OK);
}

function clearResearchCacheMenu() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    'Clear Research Cache',
    'Enter a company name to clear cache for that company only, or leave blank to clear ALL cached research.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var companyName = result.getResponseText().trim();
  var removed;
  if (companyName) {
    var key = resolveCompanyKey_(companyName);
    removed = clearCompanyResearchCache_(key);
    ui.alert('Cleared ' + removed + ' cache entr' + (removed === 1 ? 'y' : 'ies') + ' for "' + companyName + '" (key: ' + key + ').');
  } else {
    removed = clearCompanyResearchCache_(null);
    ui.alert('Cleared ' + removed + ' cached company research entr' + (removed === 1 ? 'y' : 'ies') + '.');
  }
}

function resetCompanyPipelineMenu() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    'Reset Company Pipeline',
    'Enter the company name whose pipeline (and cached research) you want to DELETE.\n\nThis is irreversible.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var companyName = result.getResponseText().trim();
  if (!companyName) {
    ui.alert('No company name provided.');
    return;
  }
  var key = resolveCompanyKey_(companyName);
  if (!key) {
    ui.alert('Could not resolve a key from "' + companyName + '".');
    return;
  }
  var confirm = ui.alert(
    'Confirm Reset',
    'Delete pipeline and cache for "' + companyName + '" (key: ' + key + ')?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;
  if (deletePipeline_(key)) {
    ui.alert('Pipeline for "' + companyName + '" deleted.');
    try {
      var summaries = getPipelineSummaries_();
      syncPipelineSheet_(summaries);
    } catch (e) {
      console.warn('Could not sync pipeline sheet after reset: ' + e);
    }
  } else {
    ui.alert('No pipeline found for "' + companyName + '" (key: ' + key + ').');
  }
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

// --- Resume from Drive ---

function setResumeFromDriveMenu() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    'Set Resume from Drive',
    'Paste a Google Doc file ID or full URL.\n\n' +
    'Examples:\n' +
    '  1aBcDe...XyZ   (file ID)\n' +
    '  https://docs.google.com/document/d/1aBcDe...XyZ/edit\n\n' +
    'Only Google Docs are supported. Convert PDFs by right-clicking the file in Drive → Open with → Google Docs.',
    ui.ButtonSet.OK_CANCEL
  );
  if (result.getSelectedButton() !== ui.Button.OK) return;
  var input = result.getResponseText().trim();
  if (!input) { ui.alert('Nothing entered — resume not changed.'); return; }

  var fileId = input;
  var urlMatch = input.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) fileId = urlMatch[1];

  try {
    var doc = DocumentApp.openById(fileId);
    var text = doc.getBody().getText().trim();
    if (!text) { ui.alert('That Doc is empty.'); return; }

    PropertiesService.getScriptProperties().setProperty('RESUME_TEXT', text);
    invalidateConfigCache_();
    ui.alert('Resume loaded', text.length + ' characters saved. Future prep docs will use this resume for personalization.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Could not read Doc', 'Error: ' + e + '\n\nMake sure the file ID is correct and the script has permission to read it. Only Google Docs are supported (not PDFs).', ui.ButtonSet.OK);
  }
}

// --- Pipeline Status ---

var PIPELINE_STATUSES = ['Active', 'Offer', 'Rejected', 'Withdrawn', 'On Hold'];

function updatePipelineStatusMenu() {
  var ui = SpreadsheetApp.getUi();
  var pipelines = getPipelines_();
  var keys = Object.keys(pipelines);
  if (keys.length === 0) {
    ui.alert('No pipelines found. Process an interview first.');
    return;
  }

  var lines = [];
  for (var i = 0; i < keys.length; i++) {
    var p = pipelines[keys[i]];
    lines.push((i + 1) + '. ' + p.companyName + ' — ' + (p.roleTitle || 'Role TBD') + ' [' + p.status + ']');
  }

  var pick = ui.prompt(
    'Update Pipeline Status — Pick a Company',
    lines.join('\n') + '\n\nEnter the number:',
    ui.ButtonSet.OK_CANCEL
  );
  if (pick.getSelectedButton() !== ui.Button.OK) return;
  var idx = parseInt(pick.getResponseText().trim(), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= keys.length) {
    ui.alert('Invalid selection.');
    return;
  }

  var statusList = [];
  for (var s = 0; s < PIPELINE_STATUSES.length; s++) {
    statusList.push((s + 1) + '. ' + PIPELINE_STATUSES[s]);
  }
  var statusPick = ui.prompt(
    'Pick New Status for ' + pipelines[keys[idx]].companyName,
    statusList.join('\n') + '\n\nEnter the number:',
    ui.ButtonSet.OK_CANCEL
  );
  if (statusPick.getSelectedButton() !== ui.Button.OK) return;
  var sIdx = parseInt(statusPick.getResponseText().trim(), 10) - 1;
  if (isNaN(sIdx) || sIdx < 0 || sIdx >= PIPELINE_STATUSES.length) {
    ui.alert('Invalid selection.');
    return;
  }

  pipelines[keys[idx]].status = PIPELINE_STATUSES[sIdx];
  pipelines[keys[idx]].lastActivity = new Date().toISOString();
  savePipelines_(pipelines);

  try {
    var summaries = getPipelineSummaries_();
    syncPipelineSheet_(summaries);
  } catch (e) {
    console.warn('Pipeline sheet sync after status update failed: ' + e);
  }

  ui.alert('Updated', pipelines[keys[idx]].companyName + ' → ' + PIPELINE_STATUSES[sIdx], ui.ButtonSet.OK);
}

// --- Sample / test event runner ---

function runSampleEvent() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    'Run Sample Event',
    'Runs the full pipeline on a fake interview event to smoke-test your setup. ' +
    'Creates a real prep doc and tracker row (you can delete them after). Does NOT register a pipeline.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  var validation = validateConfig();
  if (!validation.valid) {
    ui.alert('Setup Required', validation.errors.join('\n'), ui.ButtonSet.OK);
    return;
  }

  var startTime = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days out
  var sampleEvent = {
    eventId: 'SAMPLE_' + Date.now(),
    title: '[SAMPLE] Phone Screen — Anthropic — Sr. Product Marketing Manager',
    startTime: startTime,
    endTime: new Date(startTime.getTime() + 45 * 60 * 1000),
    description: 'Sample event generated by the Run Sample Event menu. This is a smoke test.',
    location: 'Virtual',
    videoLink: 'https://meet.google.com/sample-link',
    calendarLink: null,
    attendees: [
      { email: 'recruiter@anthropic.com', name: 'Sample Recruiter', isOrganizer: true }
    ],
    companyName: 'Anthropic',
    roleTitle: 'Sr. Product Marketing Manager',
    interviewType: 'Phone Screen',
    interviewers: [
      { name: 'Sample Recruiter', email: 'recruiter@anthropic.com', title: 'Recruiter', linkedinUrl: null }
    ],
    preparationInstructions: null,
    updated: new Date().toISOString(),
    _isSample: true
  };

  resetRunUsage_();
  console.log('Running sample event pipeline...');
  try {
    var research = researchInterview(sampleEvent, null);
    var prep = synthesizePrep(sampleEvent, research, { roundNumber: 1, summary: [], appendix: [] });
    var docUrl = createPrepDoc(prep);
    var apiCost = getRunCost_();
    writeToSheet(sampleEvent, prep, docUrl, apiCost);
    ui.alert('Sample complete', 'Sample prep doc:\n' + docUrl + '\n\nAPI cost: $' + apiCost.toFixed(4) +
      '\n\nDelete the doc and tracker row when you\'re done reviewing.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Sample failed', String(e), ui.ButtonSet.OK);
  }
}

// --- Daily reminder trigger ---

function installDailyReminderTrigger() {
  var ui = SpreadsheetApp.getUi();
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDailyDigest_') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }

  ScriptApp.newTrigger('sendDailyDigest_')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();

  var msg = 'Daily digest trigger installed for 8 AM (script timezone).';
  if (removed > 0) msg += '\n(' + removed + ' old trigger(s) removed.)';
  msg += '\n\nEach morning you\'ll get an email summarizing interviews in the next 48 hours.';
  ui.alert('Trigger Installed', msg, ui.ButtonSet.OK);
}

function sendDailyDigest_() {
  var config = getConfig();
  if (!config.userEmail) {
    console.warn('Daily digest skipped — no USER_EMAIL configured');
    return;
  }

  var now = new Date();
  var horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  var pipelines = getPipelines_();
  var processed = getProcessedEvents_();

  var upcoming = [];
  for (var key in pipelines) {
    var p = pipelines[key];
    if (p.status === 'Rejected' || p.status === 'Withdrawn') continue;
    var stages = p.stages || [];
    for (var s = 0; s < stages.length; s++) {
      var stage = stages[s];
      var when = new Date(stage.eventDate);
      if (when >= now && when <= horizon) {
        upcoming.push({
          companyName: p.companyName,
          roleTitle: p.roleTitle || '',
          stageType: stage.stageType,
          when: when,
          docUrl: stage.docUrl || (processed[stage.eventId] ? processed[stage.eventId].docUrl : '')
        });
      }
    }
  }

  if (upcoming.length === 0) {
    console.log('Daily digest: no interviews in the next 48h, skipping email');
    return;
  }

  upcoming.sort(function (a, b) { return a.when.getTime() - b.when.getTime(); });

  var lines = upcoming.map(function (u) {
    var whenStr = Utilities.formatDate(u.when, Session.getScriptTimeZone(), 'EEE MMM d, h:mm a');
    var line = whenStr + ' — ' + u.companyName + ' — ' + u.stageType;
    if (u.roleTitle) line += ' (' + u.roleTitle + ')';
    if (u.docUrl) line += '\n   Prep doc: ' + u.docUrl;
    return line;
  });

  var subject = 'Interview prep digest — ' + upcoming.length + ' interview' + (upcoming.length === 1 ? '' : 's') + ' in the next 48h';
  var bodyText = 'Upcoming interviews:\n\n' + lines.join('\n\n') + '\n\n— Interview Prep Automation';

  MailApp.sendEmail({ to: config.userEmail, subject: subject, body: bodyText });
  console.log('Daily digest sent to ' + config.userEmail + ' with ' + upcoming.length + ' interview(s)');
}
