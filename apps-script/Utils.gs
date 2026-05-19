var PERSONAL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'aol.com', 'protonmail.com', 'mail.com',
  'live.com', 'msn.com'
];

var DEFAULT_RECRUITING_DOMAINS = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'goodtime.io',
  'calendly.com', 'hire.lever.co', 'app.greenhouse.io',
  'resource.io', 'modernloop.com', 'prelude.co', 'gem.com',
  'brighthire.ai', 'metaview.ai',
  'icims.com', 'workday.com', 'smartrecruiters.com',
  'rippling.com', 'bamboohr.com', 'jobvite.com',
  'myworkdayjobs.com', 'hirebridge.com', 'breezy.hr'
];

var SOFT_KEYWORDS = [
  'screen', 'chat', 'meet', 'call', 'interview',
  'discussion', 'intro', 'conversation', 'debrief', '1:1',
  'one on one', 'phone', 'virtual', 'video'
];

function getRecruitingDomains_(config) {
  var domains = DEFAULT_RECRUITING_DOMAINS.slice();
  var extra = config.extraRecruitingDomains || [];
  for (var i = 0; i < extra.length; i++) {
    if (extra[i] && domains.indexOf(extra[i]) === -1) domains.push(extra[i]);
  }
  return domains;
}

var INTERVIEW_TYPE_KEYWORDS = {
  'phone screen': 'Phone Screen',
  'recruiter': 'Phone Screen',
  'recruiter screen': 'Phone Screen',
  'technical': 'Technical',
  'coding': 'Technical',
  'system design': 'Technical',
  'live coding': 'Technical',
  'take home': 'Technical',
  'behavioral': 'Behavioral',
  'culture fit': 'Behavioral',
  'culture': 'Behavioral',
  'values': 'Behavioral',
  'panel': 'Panel',
  'team': 'Panel',
  'final': 'Final Round',
  'final round': 'Final Round',
  'onsite': 'Final Round',
  'on-site': 'Final Round',
  'hiring manager': 'Hiring Manager'
};

var MAX_EVENTS_PER_RUN = 3;

function extractDomain_(email) {
  if (!email || email.indexOf('@') === -1) return null;
  var domain = email.split('@')[1].toLowerCase();
  if (PERSONAL_DOMAINS.indexOf(domain) !== -1) return null;
  return domain;
}

function getNonPersonalDomains_(attendees) {
  var domains = [];
  for (var i = 0; i < attendees.length; i++) {
    var d = extractDomain_(attendees[i].email);
    if (d && domains.indexOf(d) === -1) domains.push(d);
  }
  return domains;
}

function cleanHtml_(html) {
  if (!html) return '';
  var text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&#\d+;/g, '');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

function truncate_(text, maxChars) {
  maxChars = maxChars || 500;
  if (!text || text.length <= maxChars) return text || '';
  return text.substring(0, maxChars - 3) + '...';
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEEE, MMMM d, yyyy");
}

function formatTime_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "h:mm a");
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
}
