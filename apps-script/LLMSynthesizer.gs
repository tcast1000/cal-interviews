var SYSTEM_PROMPT = 'You are an expert interview preparation coach. Your job is to help candidates excel in their upcoming interviews by providing thorough, actionable preparation materials.\n\nYou will receive details about an upcoming interview (company, role, interviewers) along with web research results. Synthesize everything into a comprehensive prep document.\n\nYour output must be a JSON object with exactly these fields:\n{\n    "company_name": "string",\n    "role_title": "string",\n    "interview_date": "string (formatted nicely, e.g. \'Thursday, May 15, 2026\')",\n    "interview_time": "string (e.g. \'2:00 PM EST\')",\n    "interview_location": "string (physical address or \'Virtual\')",\n    "video_link": "string or empty",\n    "interviewer_names": ["list of interviewer names"],\n    "company_overview": "2-3 paragraphs about the company: what they do, their mission, size, stage, culture, and anything notable. Write in a way that helps the candidate sound knowledgeable.",\n    "recent_news": ["3-5 recent news items or developments, each 1-2 sentences"],\n    "role_analysis": "2-3 paragraphs analyzing the role: key responsibilities, required skills, and how to frame experience to match. If the candidate provided a resume, reference specific experience that maps to the role.",\n    "interviewer_backgrounds": {"interviewer name": "1-2 paragraphs about their background, role, interests, and potential topics they might focus on"},\n    "potential_questions": ["10 likely interview questions based on the role, company, and interview type. Include a mix of behavioral, technical, and role-specific questions."],\n    "questions_to_ask": ["8-10 thoughtful questions the candidate should ask. These should demonstrate research and genuine interest. Avoid generic questions."],\n    "key_talking_points": ["5 specific talking points connecting the candidate\'s potential strengths to this role and company. Make these concrete and memorable."],\n    "sources": ["list of URLs used in research"],\n    "interview_type": "string (e.g. \'Technical\', \'Behavioral\', \'Phone Screen\')"\n}\n\nGuidelines:\n- Be specific, not generic. Every talking point and question should reference something about THIS company or role.\n- For potential interview questions, tailor them to the interview type (technical interviews get coding/design questions, behavioral get STAR-format questions, etc.)\n- If information is missing, make reasonable inferences but note uncertainty.\n- Questions to ask should show the candidate has done their homework.\n- Key talking points should be the kind of things that make an interviewer think "this person really prepared."\n- Return ONLY the JSON object, no other text.';

var RESUME_ADDENDUM = '\n\nThe candidate has provided their resume/background for personalization:\n\n{resume}\n\nUse this to create highly specific talking points that connect their actual experience to this role.';

function synthesizePrep(event, research) {
  console.log('Synthesizing prep materials with Claude...');
  var config = getConfig();

  var systemPrompt = SYSTEM_PROMPT;
  if (config.resumeText) {
    systemPrompt += RESUME_ADDENDUM.replace('{resume}', config.resumeText);
  }

  var userContent = buildResearchContext_(event, research);
  var responseText = callClaudeApi_(systemPrompt, userContent, 4000);

  try {
    var text = responseText.trim();
    if (text.indexOf('```') === 0) {
      text = text.substring(text.indexOf('\n') + 1);
      text = text.substring(0, text.lastIndexOf('```')).trim();
    }
    var data = JSON.parse(text);
    console.log('Synthesis complete: ' + (data.company_name || 'Unknown') + ' — ' + (data.role_title || 'Unknown'));
    return data;
  } catch (e) {
    console.error('Failed to parse Claude response: ' + e);
    return buildFallbackPrep_(event);
  }
}

function buildFallbackPrep_(event) {
  return {
    company_name: event.companyName || 'Unknown Company',
    role_title: event.roleTitle || 'Unknown Role',
    interview_date: formatDate_(event.startTime),
    interview_time: formatTime_(event.startTime),
    interview_location: event.location || 'Virtual',
    video_link: event.videoLink || '',
    interviewer_names: event.interviewers.map(function (i) { return i.name; }),
    company_overview: 'Research synthesis failed. Please review manually.',
    recent_news: [],
    role_analysis: 'Could not synthesize role analysis.',
    interviewer_backgrounds: {},
    potential_questions: ['Tell me about yourself.', 'Why this company?', 'Why this role?'],
    questions_to_ask: ['What does a typical day look like?', 'What are the team\'s priorities?'],
    key_talking_points: ['Review raw research and prepare your own talking points.'],
    sources: [],
    interview_type: event.interviewType
  };
}

function buildResearchContext_(event, research) {
  var sections = [];

  sections.push('EVENT DETAILS:');
  sections.push('  Title: ' + event.title);
  sections.push('  Date: ' + formatDate_(event.startTime));
  sections.push('  Time: ' + formatTime_(event.startTime));
  sections.push('  Location: ' + (event.location || 'Not specified'));
  sections.push('  Video Link: ' + (event.videoLink || 'None'));
  sections.push('  Company: ' + (event.companyName || 'Unknown'));
  sections.push('  Role: ' + (event.roleTitle || 'Unknown'));
  sections.push('  Interview Type: ' + event.interviewType);
  sections.push('  Description: ' + (event.description || 'None'));

  if (event.interviewers && event.interviewers.length > 0) {
    sections.push('\nINTERVIEWERS:');
    for (var i = 0; i < event.interviewers.length; i++) {
      var iv = event.interviewers[i];
      sections.push('  - ' + iv.name + ' (' + (iv.title || 'title unknown') + ') — ' + (iv.email || 'email unknown'));
    }
  }

  if (event.preparationInstructions) {
    sections.push('\nPREPARATION INSTRUCTIONS FROM EMAILS:');
    sections.push('  ' + event.preparationInstructions);
  }

  if (research.companyInfo && research.companyInfo.length > 0) {
    sections.push('\nCOMPANY RESEARCH:');
    for (var i = 0; i < research.companyInfo.length; i++) {
      var r = research.companyInfo[i];
      sections.push('  [' + r.title + '](' + r.url + ')');
      sections.push('  ' + r.snippet);
    }
  }

  if (research.companyNews && research.companyNews.length > 0) {
    sections.push('\nRECENT NEWS:');
    for (var i = 0; i < research.companyNews.length; i++) {
      var r = research.companyNews[i];
      sections.push('  [' + r.title + '](' + r.url + ')');
      sections.push('  ' + r.snippet);
    }
  }

  if (research.roleInfo && research.roleInfo.length > 0) {
    sections.push('\nROLE RESEARCH:');
    for (var i = 0; i < research.roleInfo.length; i++) {
      var r = research.roleInfo[i];
      sections.push('  [' + r.title + '](' + r.url + ')');
      sections.push('  ' + r.snippet);
    }
  }

  if (research.interviewerInfo) {
    var hasAny = false;
    for (var name in research.interviewerInfo) { hasAny = true; break; }
    if (hasAny) {
      sections.push('\nINTERVIEWER RESEARCH:');
      for (var name in research.interviewerInfo) {
        sections.push('  ' + name + ':');
        var results = research.interviewerInfo[name];
        for (var i = 0; i < results.length; i++) {
          sections.push('    [' + results[i].title + '](' + results[i].url + ')');
          sections.push('    ' + results[i].snippet);
        }
      }
    }
  }

  if (research.glassdoorInfo && research.glassdoorInfo.length > 0) {
    sections.push('\nINTERVIEW TIPS & GLASSDOOR:');
    for (var i = 0; i < research.glassdoorInfo.length; i++) {
      var r = research.glassdoorInfo[i];
      sections.push('  [' + r.title + '](' + r.url + ')');
      sections.push('  ' + r.snippet);
    }
  }

  if (!research.companyInfo || research.companyInfo.length === 0) {
    sections.push('\nNOTE: No web research was available. Please use your training knowledge about the company and role to provide the best possible preparation materials.');
  }

  return sections.join('\n');
}

// Per-million-token pricing by model family (input / output)
var MODEL_PRICING = {
  'claude-sonnet': { input: 3.0, output: 15.0 },
  'claude-haiku':  { input: 0.80, output: 4.0 },
  'claude-opus':   { input: 15.0, output: 75.0 }
};

function getModelPricing_(model) {
  for (var prefix in MODEL_PRICING) {
    if (model.indexOf(prefix) === 0) return MODEL_PRICING[prefix];
  }
  return MODEL_PRICING['claude-sonnet'];
}

function calculateCost_(inputTokens, outputTokens, model) {
  var pricing = getModelPricing_(model);
  return (inputTokens / 1000000) * pricing.input + (outputTokens / 1000000) * pricing.output;
}

// Accumulates token usage across calls within a single processEvent_ run
var _runUsage = { inputTokens: 0, outputTokens: 0 };

function resetRunUsage_() {
  _runUsage = { inputTokens: 0, outputTokens: 0 };
}

function getRunCost_() {
  var config = getConfig();
  return calculateCost_(_runUsage.inputTokens, _runUsage.outputTokens, config.claudeModel);
}

function callClaudeApi_(systemPrompt, userMessage, maxTokens) {
  var config = getConfig();
  maxTokens = maxTokens || 1000;

  var payload = {
    model: config.claudeModel,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userMessage }]
  };

  if (systemPrompt) {
    payload.system = systemPrompt;
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': config.anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
  var code = response.getResponseCode();
  var body = JSON.parse(response.getContentText());

  if (code !== 200) {
    throw new Error('Claude API error (' + code + '): ' + (body.error ? body.error.message : JSON.stringify(body)));
  }

  if (!body.content || body.content.length === 0) {
    throw new Error('Claude API returned empty content');
  }

  var usage = body.usage || {};
  var inTok = usage.input_tokens || 0;
  var outTok = usage.output_tokens || 0;
  _runUsage.inputTokens += inTok;
  _runUsage.outputTokens += outTok;

  console.log('  Token usage: ' + inTok + ' input, ' + outTok + ' output');

  return body.content[0].text;
}
