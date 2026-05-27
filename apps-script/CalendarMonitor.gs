function getInterviewEvents(lookAheadDays) {
  var config = getConfig();
  lookAheadDays = lookAheadDays || config.lookAheadDays;

  var now = new Date();
  var future = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
  var cal = CalendarApp.getDefaultCalendar();
  var events = cal.getEvents(now, future);

  console.log('Found ' + events.length + ' total calendar events');

  var seenIds = {};
  var interviews = [];
  for (var i = 0; i < events.length; i++) {
    var calEvent = events[i];
    var eventId = calEvent.getId();

    if (seenIds[eventId]) continue;
    seenIds[eventId] = true;

    if (isCancelledOrDeclined_(calEvent)) {
      console.log('  Skipping cancelled/declined: ' + calEvent.getTitle());
      continue;
    }

    if (isInterviewEvent_(calEvent, config)) {
      var parsed = parseCalendarEvent_(calEvent, config);
      interviews.push(parsed);
      console.log('  Interview found: ' + parsed.title + ' (' + formatDateTime_(parsed.startTime) + ')');
    }
  }

  interviews.sort(function (a, b) { return a.startTime.getTime() - b.startTime.getTime(); });
  console.log('Found ' + interviews.length + ' interview event(s)');
  return interviews;
}

function getNewInterviewEvents() {
  var events = getInterviewEvents();
  var processed = getProcessedEvents_();
  var debounceMs = 60 * 60 * 1000; // 1 hour
  var newEvents = [];
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    var entry = processed[ev.eventId];
    if (!entry) {
      newEvents.push(ev);
      continue;
    }
    if (ev.updated && entry.processedAt) {
      var lastUpdated = new Date(ev.updated).getTime();
      var processedAt = new Date(entry.processedAt).getTime();
      if (lastUpdated > processedAt + debounceMs) {
        ev._isUpdate = true;
        newEvents.push(ev);
        console.log('  Reprocessing updated event: ' + ev.title +
          ' (last updated ' + ev.updated + ', last processed ' + entry.processedAt + ')');
        continue;
      }
    }
    console.log('  Skipping already-processed: ' + ev.title);
  }
  return newEvents;
}

function isCancelledOrDeclined_(calEvent) {
  var myStatus = calEvent.getMyStatus();
  if (myStatus === CalendarApp.GuestStatus.NO) return true;
  return false;
}

function isInterviewEvent_(calEvent, config) {
  var title = calEvent.getTitle().toLowerCase();
  var description = (calEvent.getDescription() || '').toLowerCase();
  var normTitle = normalizeForMatch_(title);
  var normDescription = normalizeForMatch_(description);
  var recruitingDomains = getRecruitingDomains_(config);

  if (title.indexOf('interview') !== -1 || normTitle.indexOf('interview') !== -1) return true;

  var namesToCheck = [];
  if (config.userName) namesToCheck.push(config.userName.toLowerCase());
  var aliases = config.userAliases || [];
  for (var a = 0; a < aliases.length; a++) {
    if (aliases[a]) namesToCheck.push(aliases[a].toLowerCase());
  }
  for (var n = 0; n < namesToCheck.length; n++) {
    if (title.indexOf(namesToCheck[n]) !== -1) return true;
  }
  for (var nn = 0; nn < namesToCheck.length; nn++) {
    var nName = normalizeForMatch_(namesToCheck[nn]);
    if (nName && normTitle.indexOf(nName) !== -1) return true;
  }

  var extraKeywords = config.extraMatchKeywords || [];
  for (var k = 0; k < extraKeywords.length; k++) {
    if (extraKeywords[k] && title.indexOf(extraKeywords[k]) !== -1) return true;
  }
  for (var kk = 0; kk < extraKeywords.length; kk++) {
    var nKw = normalizeForMatch_(extraKeywords[kk]);
    if (nKw && normTitle.indexOf(nKw) !== -1) return true;
  }

  var guests = calEvent.getGuestList(false);
  var hasRecruitingAttendee = false;
  for (var i = 0; i < guests.length; i++) {
    var d = extractDomain_(guests[i].getEmail());
    if (d && recruitingDomains.indexOf(d) !== -1) {
      hasRecruitingAttendee = true;
      break;
    }
  }

  var softMatch = false;
  for (var j = 0; j < SOFT_KEYWORDS.length; j++) {
    if (title.indexOf(SOFT_KEYWORDS[j]) !== -1) {
      softMatch = true;
      break;
    }
  }
  if (!softMatch) {
    for (var jj = 0; jj < SOFT_KEYWORDS.length; jj++) {
      var nSoft = normalizeForMatch_(SOFT_KEYWORDS[jj]);
      if (nSoft && normTitle.indexOf(nSoft) !== -1) {
        softMatch = true;
        break;
      }
    }
  }

  if (description.indexOf('interview') !== -1 || normDescription.indexOf('interview') !== -1) {
    if (hasRecruitingAttendee || softMatch) return true;
  }

  if (hasRecruitingAttendee && softMatch) return true;

  return false;
}

function parseCalendarEvent_(calEvent, config) {
  var guests = calEvent.getGuestList(true);
  var attendees = [];
  for (var i = 0; i < guests.length; i++) {
    attendees.push({
      email: guests[i].getEmail(),
      name: guests[i].getName() || null,
      isOrganizer: false
    });
  }

  var creators = calEvent.getCreators();
  if (creators && creators.length > 0) {
    var creatorEmail = creators[0];
    var found = false;
    for (var i = 0; i < attendees.length; i++) {
      if (attendees[i].email === creatorEmail) {
        attendees[i].isOrganizer = true;
        found = true;
        break;
      }
    }
    if (!found) {
      attendees.push({ email: creatorEmail, name: null, isOrganizer: true });
    }
  }

  var title = calEvent.getTitle();
  var description = calEvent.getDescription() || '';
  var extracted = extractCompanyAndRole_(title, description);
  var videoLink = extractVideoLink_(calEvent);

  var event = {
    eventId: calEvent.getId(),
    title: title,
    startTime: calEvent.getStartTime(),
    endTime: calEvent.getEndTime(),
    description: description || null,
    location: calEvent.getLocation() || null,
    videoLink: videoLink,
    calendarLink: null,
    attendees: attendees,
    companyName: extracted.company,
    roleTitle: extracted.role,
    interviewType: detectInterviewType_(title, description),
    interviewers: [],
    preparationInstructions: null,
    updated: calEvent.getLastUpdated() ? calEvent.getLastUpdated().toISOString() : null
  };

  if (!event.companyName) {
    var domains = getNonPersonalDomains_(attendees);
    if (domains.length > 0) {
      event.companyName = domains[0].split('.')[0];
      event.companyName = event.companyName.charAt(0).toUpperCase() + event.companyName.slice(1);
    }
  }

  return event;
}

function extractCompanyAndRole_(title, description) {
  var t = title.trim();
  var m;

  m = t.match(/^interview\s+(?:with|at|@)\s+(.+?)(?:\s*[-|:]\s*(.+))?$/i);
  if (m) return { company: m[1].trim(), role: m[2] ? m[2].trim() : null };

  m = t.match(/^interview\s+\w+\s*[-–—]\s*(.+?)\|\s*(.+)$/i);
  if (m) return { company: m[1].trim(), role: m[2].trim() };

  m = t.match(/^(.+?)\s*[-|]\s*(.+?)\s*[-–—]\s*interview$/i);
  if (m) return { company: m[1].trim(), role: m[2].trim() };

  m = t.match(/^(.+?)\s*[-–—]\s*interview/i);
  if (m) {
    var candidate = m[1].trim();
    if (candidate.split(/\s+/).length <= 4) {
      return { company: candidate, role: null };
    }
  }

  m = t.match(/^interview\s*[-:–—]\s*(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (m) return { company: m[2].trim(), role: m[1].trim() };

  m = t.match(/^interview(?:with|at|@)?\s*([A-Z][\w.&-]+(?:\s+[\w.&-]+){0,3})/i);
  if (m) return { company: m[1].trim(), role: null };

  return { company: null, role: null };
}

function detectInterviewType_(title, description) {
  var text = (title + ' ' + (description || '')).toLowerCase();
  for (var keyword in INTERVIEW_TYPE_KEYWORDS) {
    var pattern = new RegExp('\\b' + keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
    if (pattern.test(text)) {
      return INTERVIEW_TYPE_KEYWORDS[keyword];
    }
  }
  return 'Interview';
}

function extractVideoLink_(calEvent) {
  var desc = calEvent.getDescription() || '';

  var zoomMatch = desc.match(/https:\/\/[\w.-]*zoom\.us\/j\/\S+/);
  if (zoomMatch) return zoomMatch[0];

  var teamsMatch = desc.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/\S+/);
  if (teamsMatch) return teamsMatch[0];

  var meetMatch = desc.match(/https:\/\/meet\.google\.com\/\S+/);
  if (meetMatch) return meetMatch[0];

  return null;
}
