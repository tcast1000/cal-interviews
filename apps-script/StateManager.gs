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
