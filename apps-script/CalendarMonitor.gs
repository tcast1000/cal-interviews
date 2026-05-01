function getInterviewEvents(lookAheadDays) {
  var config = getConfig();
  lookAheadDays = lookAheadDays || config.lookAheadDays;

  var now = new Date();
  var future = new Date(now.getTime() + lookAheadDays * 24 * 60 * 60 * 1000);
  var cal = CalendarApp.getDefaultCalendar();
  var events = cal.getEvents(now, future);

  console.log('Found ' + events.length + ' total calendar events');

  var interviews = [];
  for (var i = 0; i < events.length; i++) {
    if (isInterviewEvent_(events[i], config)) {
      var parsed = parseCalendarEvent_(events[i], config);
      interviews.push(parsed);
      console.log('  Interview found: ' + parsed.title + ' (' + formatDateTime_(parsed.startTime) + ')');
    }
  }

  console.log('Found ' + interviews.length + ' interview event(s)');
  return interviews;
}

function getNewInterviewEvents() {
  var events = getInterviewEvents();
  var newEvents = [];
  for (var i = 0; i < events.length; i++) {
    if (!isProcessed_(events[i].eventId)) {
      newEvents.push(events[i]);
    } else {
      console.log('  Skipping already-processed: ' + events[i].title);
    }
  }
  return newEvents;
}

function isInterviewEvent_(calEvent, config) {
  var title = calEvent.getTitle().toLowerCase();
  var description = (calEvent.getDescription() || '').toLowerCase();

  if (title.indexOf('interview') !== -1) return true;

  if (config.userName && title.indexOf(config.userName.toLowerCase()) !== -1) return true;

  if (description.indexOf('interview') !== -1) {
    var guests = calEvent.getGuestList(false);
    for (var i = 0; i < guests.length; i++) {
      var d = extractDomain_(guests[i].getEmail());
      if (d && RECRUITING_DOMAINS.indexOf(d) !== -1) return true;
    }
    var screenKeywords = ['screen', 'chat', 'meet', 'call'];
    for (var j = 0; j < screenKeywords.length; j++) {
      if (title.indexOf(screenKeywords[j]) !== -1) return true;
    }
  }

  var guests = calEvent.getGuestList(false);
  for (var i = 0; i < guests.length; i++) {
    var d = extractDomain_(guests[i].getEmail());
    if (d && RECRUITING_DOMAINS.indexOf(d) !== -1) {
      var keywords = ['screen', 'chat', 'meet', 'call', 'interview'];
      for (var j = 0; j < keywords.length; j++) {
        if (title.indexOf(keywords[j]) !== -1) return true;
      }
    }
  }

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
    preparationInstructions: null
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

  return { company: null, role: null };
}

function detectInterviewType_(title, description) {
  var text = (title + ' ' + (description || '')).toLowerCase();
  for (var keyword in INTERVIEW_TYPE_KEYWORDS) {
    if (text.indexOf(keyword) !== -1) {
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
