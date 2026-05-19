function getProcessedEvents_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('PROCESSED_EVENTS');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Corrupt PROCESSED_EVENTS, resetting: ' + e);
    return {};
  }
}

function saveProcessedEvents_(events) {
  PropertiesService.getScriptProperties().setProperty('PROCESSED_EVENTS', JSON.stringify(events));
}

function isProcessed_(eventId) {
  var events = getProcessedEvents_();
  return events.hasOwnProperty(eventId);
}

function markProcessed_(eventId, docUrl, sheetRow) {
  var events = getProcessedEvents_();
  events[eventId] = {
    processedAt: new Date().toISOString(),
    docUrl: docUrl,
    sheetRow: sheetRow
  };
  saveProcessedEvents_(events);
}

function clearProcessedEvent_(eventId) {
  var events = getProcessedEvents_();
  delete events[eventId];
  saveProcessedEvents_(events);
}

function clearAllProcessed_() {
  PropertiesService.getScriptProperties().deleteProperty('PROCESSED_EVENTS');
}

function pruneOldEntries_() {
  var events = getProcessedEvents_();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  var cutoffStr = cutoff.toISOString();
  var changed = false;

  for (var id in events) {
    if (events[id].processedAt < cutoffStr) {
      delete events[id];
      changed = true;
    }
  }

  if (changed) saveProcessedEvents_(events);
}

function getPendingQueue_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PENDING_QUEUE');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch (e) { return []; }
}

function savePendingQueue_(queue) {
  if (queue.length === 0) {
    PropertiesService.getScriptProperties().deleteProperty('PENDING_QUEUE');
  } else {
    PropertiesService.getScriptProperties().setProperty('PENDING_QUEUE', JSON.stringify(queue));
  }
}

// --- Pipeline State ---

function getPipelines_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PIPELINES');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function savePipelines_(pipelines) {
  PropertiesService.getScriptProperties().setProperty('PIPELINES', JSON.stringify(pipelines));
}

function normalizeCompanyKey_(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function upsertPipeline_(companyKey, companyName, roleTitle) {
  var pipelines = getPipelines_();
  if (!pipelines[companyKey]) {
    pipelines[companyKey] = {
      companyName: companyName,
      roleTitle: roleTitle || '',
      status: 'Active',
      stages: [],
      lastActivity: new Date().toISOString(),
      followUpAfter: null,
      notes: []
    };
  } else {
    pipelines[companyKey].lastActivity = new Date().toISOString();
    if (roleTitle && !pipelines[companyKey].roleTitle) {
      pipelines[companyKey].roleTitle = roleTitle;
    }
  }
  savePipelines_(pipelines);
  return pipelines[companyKey];
}

function addPipelineStage_(companyKey, eventId, stageType, eventDate, docUrl) {
  var pipelines = getPipelines_();
  if (!pipelines[companyKey]) return;

  pipelines[companyKey].stages.push({
    eventId: eventId,
    stageType: stageType,
    eventDate: eventDate,
    docUrl: docUrl || '',
    debrief: null
  });
  pipelines[companyKey].lastActivity = new Date().toISOString();
  savePipelines_(pipelines);
}

function setPipelineFollowUp_(companyKey, followUpDate) {
  var pipelines = getPipelines_();
  if (!pipelines[companyKey]) return;
  pipelines[companyKey].followUpAfter = followUpDate;
  savePipelines_(pipelines);
}

function registerPipelineEvent_(event, prep, docUrl) {
  var company = prep.company_name || event.companyName || 'Unknown';
  var companyKey = normalizeCompanyKey_(company);

  upsertPipeline_(companyKey, company, prep.role_title || event.roleTitle);

  var eventDateStr = event.startTime.toISOString();
  addPipelineStage_(companyKey, event.eventId, event.interviewType || 'Interview', eventDateStr, docUrl);

  var followUp = new Date(event.startTime.getTime() + 3 * 24 * 60 * 60 * 1000);
  setPipelineFollowUp_(companyKey, followUp.toISOString());

  var pipelines = getPipelines_();
  var stageCount = pipelines[companyKey] ? pipelines[companyKey].stages.length : 0;
  console.log('Pipeline "' + company + '": stage ' + stageCount + ' (' + event.interviewType + ') registered');
  return companyKey;
}

function getPipelineSummaries_() {
  var pipelines = getPipelines_();
  var now = new Date();
  var summaries = [];

  for (var key in pipelines) {
    var p = pipelines[key];
    if (p.status === 'Rejected' || p.status === 'Withdrawn') continue;

    var stages = p.stages || [];
    var stageCount = stages.length;
    var currentStage = stageCount > 0 ? stages[stageCount - 1].stageType : 'Unknown';

    var lastActivity = new Date(p.lastActivity);
    var daysSilent = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));

    var needsFollowUp = false;
    if (p.followUpAfter) {
      needsFollowUp = now >= new Date(p.followUpAfter);
    }

    var needsDebrief = false;
    if (stageCount > 0) {
      var lastStage = stages[stageCount - 1];
      var stageDate = new Date(lastStage.eventDate);
      needsDebrief = stageDate < now && !lastStage.debrief;
    }

    var nextAction = 'None';
    if (needsDebrief) nextAction = 'Log debrief';
    else if (needsFollowUp) nextAction = 'Send follow-up';
    else if (p.status === 'Active' && daysSilent > 7) nextAction = 'Check in';

    var latestNote = '';
    if (p.notes && p.notes.length > 0) {
      latestNote = p.notes[p.notes.length - 1].text || '';
    }

    summaries.push({
      companyKey: key,
      companyName: p.companyName,
      roleTitle: p.roleTitle || '',
      status: p.status,
      stageCount: stageCount,
      currentStage: currentStage,
      daysSilent: daysSilent,
      needsFollowUp: needsFollowUp,
      needsDebrief: needsDebrief,
      nextAction: nextAction,
      lastActivity: Utilities.formatDate(lastActivity, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      latestNote: latestNote
    });
  }

  summaries.sort(function (a, b) { return a.daysSilent - b.daysSilent; });
  return summaries;
}
