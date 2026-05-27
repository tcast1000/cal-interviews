var MAX_SNIPPETS = 5;
var MAX_SNIPPET_CHARS = 2000;

var EXTRACTION_PROMPT = 'You are extracting interview details from email content. Given the following email snippets related to a calendar event titled "{title}", extract structured information.\n\nReturn a JSON object with these fields (use null for anything you can\'t determine):\n{\n    "company_name": "the company conducting the interview",\n    "role_title": "the job title/role being interviewed for",\n    "interview_type": "one of: Phone Screen, Technical, Behavioral, Panel, Final Round, Hiring Manager, or Interview",\n    "interviewers": [\n        {"name": "interviewer name", "email": "their email", "title": "their job title"}\n    ],\n    "preparation_instructions": "any specific prep instructions mentioned in the emails"\n}\n\nEmail snippets:\n{snippets}\n\nReturn ONLY the JSON object, no other text.';

function enrichFromGmail(event) {
  console.log('Searching Gmail for context on: ' + event.title);

  var queries = buildGmailQueries_(event);
  if (queries.length === 0) {
    console.log('No Gmail search queries could be built');
    return event;
  }

  var allSnippets = [];
  var seenThreadIds = {};

  for (var q = 0; q < queries.length; q++) {
    if (allSnippets.length >= MAX_SNIPPETS) break;
    try {
      var threads = GmailApp.search(queries[q], 0, 5);
      for (var t = 0; t < threads.length; t++) {
        var threadId = threads[t].getId();
        if (seenThreadIds[threadId] || allSnippets.length >= MAX_SNIPPETS) continue;
        seenThreadIds[threadId] = true;
        var snippet = getMessageSnippet_(threads[t]);
        if (snippet) allSnippets.push(snippet);
      }
    } catch (e) {
      console.warn('Gmail search failed for "' + queries[q] + '": ' + e);
    }
  }

  if (allSnippets.length === 0) {
    console.log('No relevant emails found');
    return event;
  }

  console.log('Found ' + allSnippets.length + ' relevant email(s), extracting with Claude...');

  try {
    var prompt = EXTRACTION_PROMPT
      .replace('{title}', event.title)
      .replace('{snippets}', allSnippets.join('\n\n---\n\n'));

    var responseText = callClaudeApi_('', prompt, 700, { model: FAST_MODEL });
    var text = responseText.trim();
    if (text.indexOf('```') === 0) {
      text = text.substring(text.indexOf('\n') + 1);
      text = text.substring(0, text.lastIndexOf('```')).trim();
    }
    var data = JSON.parse(text);

    if (data.company_name && !event.companyName) event.companyName = data.company_name;
    if (data.role_title && !event.roleTitle) event.roleTitle = data.role_title;
    if (data.interview_type && event.interviewType === 'Interview') event.interviewType = data.interview_type;
    if (data.preparation_instructions) event.preparationInstructions = data.preparation_instructions;

    if (data.interviewers && data.interviewers.length > 0) {
      for (var i = 0; i < data.interviewers.length; i++) {
        if (data.interviewers[i].name) {
          event.interviewers.push({
            name: data.interviewers[i].name,
            email: data.interviewers[i].email || null,
            title: data.interviewers[i].title || null,
            linkedinUrl: null
          });
        }
      }
    }

    console.log('Gmail enrichment complete — company: ' + event.companyName + ', role: ' + event.roleTitle);
  } catch (e) {
    console.warn('Claude extraction from emails failed: ' + e);
  }

  return event;
}

function buildGmailQueries_(event) {
  var queries = [];

  var domains = getNonPersonalDomains_(event.attendees);
  for (var i = 0; i < Math.min(domains.length, 2); i++) {
    queries.push('from:(' + domains[i] + ') subject:(interview OR schedule OR confirmation) newer_than:30d');
  }

  if (event.companyName) {
    queries.push(event.companyName + ' (interview OR schedule OR confirmation) newer_than:30d');
  }

  for (var i = 0; i < event.attendees.length; i++) {
    var att = event.attendees[i];
    if (att.email && !att.isOrganizer) {
      var d = extractDomain_(att.email);
      if (d) queries.push('from:' + att.email + ' newer_than:30d');
    }
  }

  if (queries.length === 0) {
    var words = event.title.split(/\s+/).filter(function (w) {
      return w.length > 3 && w.toLowerCase() !== 'interview';
    });
    if (words.length > 0) {
      queries.push(words.slice(0, 3).join(' ') + ' interview newer_than:30d');
    }
  }

  return queries;
}

function getMessageSnippet_(thread) {
  try {
    var messages = thread.getMessages();
    if (messages.length === 0) return null;

    // Pick first + last 2 messages (deduped). First captures original context;
    // recent messages capture reschedules, added interviewers, and prep updates.
    var picked = [messages[0]];
    if (messages.length >= 2) picked.push(messages[messages.length - 1]);
    if (messages.length >= 3) picked.push(messages[messages.length - 2]);
    picked.sort(function (a, b) { return a.getDate().getTime() - b.getDate().getTime(); });

    var seenIds = {};
    var parts = [];
    for (var i = 0; i < picked.length; i++) {
      var m = picked[i];
      var id = m.getId();
      if (seenIds[id]) continue;
      seenIds[id] = true;

      var body = m.getPlainBody();
      if (!body) body = cleanHtml_(m.getBody());
      if (!body) continue;

      var dateStr = Utilities.formatDate(m.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
      parts.push('[' + dateStr + '] From: ' + m.getFrom() + '\nSubject: ' + m.getSubject() + '\n\n' + body);
    }
    if (parts.length === 0) return null;

    var combined = parts.join('\n\n--- next message in thread ---\n\n');
    return combined.substring(0, MAX_SNIPPET_CHARS);
  } catch (e) {
    console.warn('Failed to read thread: ' + e);
    return null;
  }
}
