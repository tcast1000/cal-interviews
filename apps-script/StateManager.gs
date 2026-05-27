var _processedCache = null;

function getProcessedEvents_() {
  if (_processedCache !== null) return _processedCache;
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('PROCESSED_EVENTS');
  if (!raw) { _processedCache = {}; return _processedCache; }
  try {
    _processedCache = JSON.parse(raw);
  } catch (e) {
    console.warn('Corrupt PROCESSED_EVENTS, resetting: ' + e);
    _processedCache = {};
  }
  return _processedCache;
}

function saveProcessedEvents_(events) {
  PropertiesService.getScriptProperties().setProperty('PROCESSED_EVENTS', JSON.stringify(events));
  _processedCache = events;
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
  _processedCache = {};
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

var _pipelinesCache = null;

function getPipelines_() {
  if (_pipelinesCache !== null) return _pipelinesCache;
  var raw = PropertiesService.getScriptProperties().getProperty('PIPELINES');
  if (!raw) { _pipelinesCache = {}; return _pipelinesCache; }
  try { _pipelinesCache = JSON.parse(raw); } catch (e) { _pipelinesCache = {}; }
  return _pipelinesCache;
}

function savePipelines_(pipelines) {
  PropertiesService.getScriptProperties().setProperty('PIPELINES', JSON.stringify(pipelines));
  _pipelinesCache = pipelines;
}

var COMPANY_SUFFIXES = [
  ' inc.', ' inc', ' corp.', ' corp', ' corporation', ' company',
  ' labs', ' lab', ' ltd.', ' ltd', ' llc.', ' llc', ' gmbh',
  ' holdings', ' group', ' technologies', ' technology',
  '.ai', '.io', '.com', '.co', '.net', '.org'
];

function stripCompanySuffix_(name) {
  var s = (name || '').toLowerCase().trim().replace(/[,.;]+$/, '');
  var changed = true;
  while (changed) {
    changed = false;
    for (var i = 0; i < COMPANY_SUFFIXES.length; i++) {
      var suf = COMPANY_SUFFIXES[i];
      if (s.length > suf.length && s.substring(s.length - suf.length) === suf) {
        s = s.substring(0, s.length - suf.length).trim().replace(/[,.;]+$/, '');
        changed = true;
        break;
      }
    }
  }
  return s;
}

function normalizeCompanyKey_(name) {
  return stripCompanySuffix_(name).replace(/[^a-z0-9]/g, '');
}

function resolveCompanyKey_(companyName) {
  var newKey = normalizeCompanyKey_(companyName);
  if (!newKey) return '';
  var pipelines = getPipelines_();
  if (pipelines[newKey]) return newKey;
  var keys = Object.keys(pipelines);
  for (var i = 0; i < keys.length; i++) {
    var existingKey = keys[i];
    var existingName = pipelines[existingKey].companyName || '';
    if (normalizeCompanyKey_(existingName) === newKey) {
      if (existingKey !== newKey) {
        pipelines[newKey] = pipelines[existingKey];
        delete pipelines[existingKey];
        savePipelines_(pipelines);
        var cache = getCompanyResearchCache_();
        if (cache[existingKey]) {
          cache[newKey] = cache[existingKey];
          delete cache[existingKey];
          saveCompanyResearchCache_(cache);
        }
        console.log('Migrated pipeline key ' + existingKey + ' -> ' + newKey);
      }
      return newKey;
    }
    var existingStripped = existingKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (existingStripped === newKey) return existingKey;
  }
  return newKey;
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

function getRoundNumber_(companyKey, eventId) {
  var pipelines = getPipelines_();
  var p = pipelines[companyKey];
  if (!p) return 1;
  var stages = p.stages || [];
  for (var i = 0; i < stages.length; i++) {
    if (stages[i].eventId === eventId) return i + 1;
  }
  return stages.length + 1;
}

function getPriorStages_(companyKey, excludeEventId) {
  var pipelines = getPipelines_();
  var p = pipelines[companyKey];
  if (!p) return [];
  var stages = p.stages || [];
  var out = [];
  for (var i = 0; i < stages.length; i++) {
    if (stages[i].eventId !== excludeEventId) out.push(stages[i]);
  }
  return out;
}

var _researchCache = null;

function getCompanyResearchCache_() {
  if (_researchCache !== null) return _researchCache;
  var raw = PropertiesService.getScriptProperties().getProperty('COMPANY_RESEARCH');
  if (!raw) { _researchCache = {}; return _researchCache; }
  try { _researchCache = JSON.parse(raw); } catch (e) { _researchCache = {}; }
  return _researchCache;
}

function saveCompanyResearchCache_(cache) {
  PropertiesService.getScriptProperties().setProperty('COMPANY_RESEARCH', JSON.stringify(cache));
  _researchCache = cache;
}

var CACHE_TTL_DAYS = 90;

function getCachedCompanyResearch_(companyKey) {
  var cache = getCompanyResearchCache_();
  var entry = cache[companyKey];
  if (!entry) return null;
  if (entry.cachedAt) {
    var cachedAt = new Date(entry.cachedAt);
    var ageMs = new Date().getTime() - cachedAt.getTime();
    if (ageMs > CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      console.log('Cached research for ' + companyKey + ' expired (>' + CACHE_TTL_DAYS + ' days), ignoring');
      return null;
    }
  }
  return entry;
}

function cacheCompanyResearch_(companyKey, researchDict) {
  var cache = getCompanyResearchCache_();
  cache[companyKey] = {
    cachedAt: new Date().toISOString(),
    data: researchDict
  };
  saveCompanyResearchCache_(cache);
}

function clearCompanyResearchCache_(companyKey) {
  var cache = getCompanyResearchCache_();
  var removed;
  if (companyKey) {
    removed = cache[companyKey] ? 1 : 0;
    delete cache[companyKey];
  } else {
    removed = Object.keys(cache).length;
    cache = {};
  }
  saveCompanyResearchCache_(cache);
  return removed;
}

function deletePipeline_(companyKey) {
  var pipelines = getPipelines_();
  if (!pipelines[companyKey]) return false;
  delete pipelines[companyKey];
  savePipelines_(pipelines);
  var cache = getCompanyResearchCache_();
  if (cache[companyKey]) {
    delete cache[companyKey];
    saveCompanyResearchCache_(cache);
  }
  return true;
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
