var FAST_MODEL = 'claude-haiku-4-5-20251001';
var SNIPPET_MAX_CHARS = 300;

function truncateSnippet_(text) {
  if (!text) return '';
  if (text.length <= SNIPPET_MAX_CHARS) return text;
  return text.substring(0, SNIPPET_MAX_CHARS - 1).replace(/\s+$/, '') + '…';
}

var SYSTEM_PROMPT = 'You are an expert interview preparation coach. Your job is to help candidates excel in their upcoming interviews by providing thorough, actionable preparation materials.\n\nYou will receive details about an upcoming interview (company, role, interviewers) along with web research results. Synthesize everything into a comprehensive prep document.\n\nYour output must be a JSON object with exactly these fields:\n{\n    "company_name": "string",\n    "role_title": "string",\n    "interview_date": "string (formatted nicely, e.g. \'Thursday, May 15, 2026\')",\n    "interview_time": "string (e.g. \'2:00 PM EST\')",\n    "interview_location": "string (physical address or \'Virtual\')",\n    "video_link": "string or empty",\n    "interviewer_names": ["list of interviewer names"],\n    "company_overview": "2 paragraphs about the company: what they do, their mission, size, stage, culture, and anything notable. Write in a way that helps the candidate sound knowledgeable.",\n    "values": ["4-6 short bullet items capturing the company\'s core values, principles, or cultural pillars, extracted from the COMPANY RESEARCH below. Each item is the value itself plus a brief gloss. If the research doesn\'t surface explicit values, infer from mission/culture content and label them as inferred."],\n    "products_and_services": ["4-5 bullet points listing the company\'s main products, services, or platforms (extracted from COMPANY RESEARCH). Each is a brief description (1 sentence max)."],\n    "competitors": ["3-4 direct competitors or closest alternatives (extracted from COMPANY RESEARCH). For each, include the company name and a short phrase on how they compete."],\n    "recent_news": ["3-4 recent news items or developments, each 1 sentence"],\n    "role_analysis": "2 paragraphs analyzing the role: key responsibilities, required skills, and how to frame experience to match. If the candidate provided a resume, reference specific experience that maps to the role.",\n    "interviewer_backgrounds": {"interviewer name": "1 paragraph about their background, role, interests, and potential topics they might focus on"},\n    "potential_questions": ["6 likely interview questions based on the role, company, and interview type. Tailored to the interview type (technical / behavioral / etc)."],\n    "questions_to_ask": ["6 thoughtful questions the candidate should ask. Specific to this company/role — not generic."],\n    "key_talking_points": ["4 specific talking points connecting the candidate\'s potential strengths to this role and company. Concrete and memorable."],\n    "sheet_talking_points": ["3 punchy one-liners (max 12 words each) for a quick-glance cheat sheet. Concrete, actionable reminders — not generic platitudes."],\n    "compensation": {\n        "base_range": "estimated base salary range (e.g. \'$150K–$180K\'). Use data from levels.fyi, Glassdoor, or similar sources if available. If no data, give a reasonable market estimate and note it.",\n        "total_comp_range": "estimated total compensation range including equity/bonus. Empty string if insufficient data.",\n        "equity_notes": "brief note on equity structure if known. Empty string if unknown.",\n        "source": "where the comp data came from (e.g. \'levels.fyi\', \'Glassdoor\', \'market estimate\')",\n        "notes": "any caveats — e.g. \'limited data points\', \'comp varies significantly by level\'"\n    },\n    "sources": ["list of URLs used in research"],\n    "interview_type": "string (e.g. \'Technical\', \'Behavioral\', \'Phone Screen\')"\n}\n\nGuidelines:\n- Be specific, not generic. Every talking point and question should reference something about THIS company or role.\n- products_and_services, competitors, and values are all extracted from the same COMPANY RESEARCH block — read it carefully and pull each category out separately.\n- Tailor potential_questions to the interview type (technical = coding/design; behavioral = STAR-format; etc.).\n- sheet_talking_points are NOT a copy of key_talking_points. Ultra-short sticky-note bullets only.\n- compensation: prefer levels.fyi, then Glassdoor, then market estimate. Don\'t fabricate numbers — if data is thin, say so and widen the range.\n- Return ONLY the JSON object, no other text.';

var ROUND_ADDENDUM = '\n\nMULTI-ROUND CONTEXT: This is round {roundNumber} for this candidate at this company. Prior rounds and the candidate\'s debrief notes from them are provided below. Use this context to:\n- Skip ground already covered. Don\'t repeat questions or talking points the candidate has already used.\n- Build on what was discussed. Reference unfinished threads, follow-ups the interviewer requested, or topics the candidate flagged in their notes.\n- Recalibrate for the new interviewer. The person interviewing this round is different from prior rounds. Tailor questions, talking points, and interviewer background analysis specifically to THIS round\'s interviewer and interview type.\n- Keep all standard sections (company overview, products, competitors, etc.) — the candidate may want to re-review them, but make them tighter and only emphasize what\'s most relevant to this round.';

var RESUME_ADDENDUM = '\n\nThe candidate has provided their resume/background for personalization:\n\n{resume}\n\nUse this to create highly specific talking points that connect their actual experience to this role.';

var DEBRIEF_SUMMARY_PROMPT = 'You are condensing a job candidate\'s post-interview debrief notes into a quick-scan summary for use in preparing for the next round.\n\nBelow are debrief notes from {numRounds} prior interview round(s) with the same company. For each round, produce 2-3 short bullets that capture:\n- What was actually discussed (topics, themes, anything notable)\n- Open threads or follow-ups the interviewer asked the candidate to come back on\n- Anything the candidate flagged that should shape the next round\n\nPrior round notes:\n{notes}\n\nReturn a JSON object with this shape:\n{\n    "summary": [\n        "Round 1 (Phone Screen, May 10): bullet about what happened",\n        "Round 2 (Technical, May 15): bullet about what happened"\n    ]\n}\n\nEach bullet should be one short line, prefixed with the round/stage/date label as shown. Return ONLY the JSON, no other text.';

function synthesizePrep(event, research, roundContext) {
  roundContext = roundContext || { roundNumber: 1, summary: [], appendix: [] };
  console.log('Synthesizing prep materials with Claude (round ' + roundContext.roundNumber + ')...');
  var config = getConfig();

  var systemPrompt = SYSTEM_PROMPT;
  if (roundContext.roundNumber > 1) {
    systemPrompt += ROUND_ADDENDUM.replace('{roundNumber}', String(roundContext.roundNumber));
  }
  if (config.resumeText) {
    systemPrompt += RESUME_ADDENDUM.replace('{resume}', config.resumeText);
  }

  var userContent = buildResearchContext_(event, research, roundContext);
  var responseText = callClaudeApi_(systemPrompt, userContent, 2500, { cacheSystem: true });

  var data;
  try {
    var text = responseText.trim();
    if (text.indexOf('```') === 0) {
      text = text.substring(text.indexOf('\n') + 1);
      text = text.substring(0, text.lastIndexOf('```')).trim();
    }
    data = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse Claude response: ' + e);
    data = buildFallbackPrep_(event);
  }

  data.round_number = roundContext.roundNumber;
  data.previous_rounds_summary = roundContext.summary || [];
  data.previous_rounds_appendix = roundContext.appendix || [];
  if ((!data.social_links || isEmptyObject_(data.social_links)) && research.socialLinks) {
    data.social_links = research.socialLinks;
  }
  if (!data.job_description_url && research.jobDescriptionUrl) {
    data.job_description_url = research.jobDescriptionUrl;
    data.job_description_source = research.jobDescriptionSource;
  }
  if (!data.values) data.values = [];

  console.log('Synthesis complete: ' + (data.company_name || 'Unknown') + ' — ' + (data.role_title || 'Unknown') + ' (round ' + roundContext.roundNumber + ')');
  return data;
}

function isEmptyObject_(obj) {
  if (!obj) return true;
  for (var k in obj) { return false; }
  return true;
}

function summarizePriorDebriefs_(priorStages) {
  if (!priorStages || priorStages.length === 0) return { summary: [], appendix: [] };
  var config = getConfig();

  var appendix = [];
  var notesParts = [];
  for (var i = 0; i < priorStages.length; i++) {
    var s = priorStages[i];
    var dateLabel = (s.eventDate || '').substring(0, 10);
    var entry = {
      stage_type: s.stageType || 'Round',
      date: dateLabel,
      notes: s.debrief || '(no debrief notes saved)'
    };
    appendix.push(entry);
    if (s.debrief) {
      notesParts.push('[' + (s.stageType || 'Round') + ' — ' + dateLabel + ']\n' + s.debrief);
    }
  }

  if (notesParts.length === 0) {
    var summary = appendix.map(function (a) {
      return a.stage_type + ' on ' + a.date + ': no debrief notes recorded — add them with the Log Debrief menu item';
    });
    return { summary: summary, appendix: appendix };
  }

  if (notesParts.length === 1) {
    var only = appendix[0];
    return {
      summary: [only.stage_type + ' on ' + only.date + ': see appendix for full notes'],
      appendix: appendix
    };
  }

  var prompt = DEBRIEF_SUMMARY_PROMPT
    .replace('{numRounds}', String(notesParts.length))
    .replace('{notes}', notesParts.join('\n\n---\n\n'));

  try {
    var responseText = callClaudeApi_('', prompt, 600, { model: FAST_MODEL });
    var text = responseText.trim();
    if (text.indexOf('```') === 0) {
      text = text.substring(text.indexOf('\n') + 1);
      text = text.substring(0, text.lastIndexOf('```')).trim();
    }
    var data = JSON.parse(text);
    var summaryArr = (data.summary && data.summary.length) ? data.summary : [];
    console.log('Summarized ' + priorStages.length + ' prior round(s) into ' + summaryArr.length + ' bullets');
    return { summary: summaryArr, appendix: appendix };
  } catch (e) {
    console.warn('Prior-debrief summarization failed: ' + e);
    var fallback = appendix.map(function (a) {
      return a.stage_type + ' on ' + a.date + ': see appendix for full notes';
    });
    return { summary: fallback, appendix: appendix };
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
    values: [],
    products_and_services: [],
    competitors: [],
    recent_news: [],
    role_analysis: 'Could not synthesize role analysis.',
    interviewer_backgrounds: {},
    potential_questions: ['Tell me about yourself.', 'Why this company?', 'Why this role?'],
    questions_to_ask: ['What does a typical day look like?', 'What are the team\'s priorities?'],
    key_talking_points: ['Review raw research and prepare your own talking points.'],
    sheet_talking_points: ['Review prep doc'],
    compensation: {},
    sources: [],
    interview_type: event.interviewType,
    social_links: {},
    job_description_url: '',
    job_description_source: ''
  };
}

function buildResearchContext_(event, research, roundContext) {
  roundContext = roundContext || { roundNumber: 1, summary: [], appendix: [] };
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
    sections.push('\nINTERVIEWERS (this round):');
    for (var i = 0; i < event.interviewers.length; i++) {
      var iv = event.interviewers[i];
      sections.push('  - ' + iv.name + ' (' + (iv.title || 'title unknown') + ') — ' + (iv.email || 'email unknown'));
    }
  }

  if (event.preparationInstructions) {
    sections.push('\nPREPARATION INSTRUCTIONS FROM EMAILS:');
    sections.push('  ' + event.preparationInstructions);
  }

  if (roundContext.summary && roundContext.summary.length > 0) {
    sections.push('\nPRIOR ROUND SUMMARY (this is round ' + roundContext.roundNumber + '):');
    for (var b = 0; b < roundContext.summary.length; b++) {
      sections.push('  - ' + roundContext.summary[b]);
    }
  }

  if (roundContext.appendix && roundContext.appendix.length > 0) {
    sections.push('\nPRIOR ROUND DEBRIEF NOTES (full text):');
    for (var ap = 0; ap < roundContext.appendix.length; ap++) {
      var entry = roundContext.appendix[ap];
      sections.push('  [' + (entry.stage_type || 'Round') + ' — ' + (entry.date || '') + ']:');
      sections.push('  ' + (entry.notes || ''));
    }
  }

  var combined = (research.companyInfo || []).concat(research.productsAndServices || []).concat(research.competitors || []).concat(research.valuesInfo || []);
  if (combined.length > 0) {
    sections.push('\nCOMPANY RESEARCH (use this to extract overview, products, competitors, and values):');
    var seenUrls = {};
    for (var ci = 0; ci < combined.length; ci++) {
      var cr = combined[ci];
      if (cr.url && seenUrls[cr.url]) continue;
      if (cr.url) seenUrls[cr.url] = true;
      sections.push('  [' + cr.title + '](' + cr.url + ')');
      sections.push('  ' + truncateSnippet_(cr.snippet));
    }
  }

  if (research.companyNews && research.companyNews.length > 0) {
    sections.push('\nRECENT NEWS:');
    for (var i = 0; i < research.companyNews.length; i++) {
      var r = research.companyNews[i];
      sections.push('  [' + r.title + '](' + r.url + ')');
      sections.push('  ' + truncateSnippet_(r.snippet));
    }
  }

  if (research.roleInfo && research.roleInfo.length > 0) {
    sections.push('\nROLE RESEARCH:');
    for (var i = 0; i < research.roleInfo.length; i++) {
      var r = research.roleInfo[i];
      sections.push('  [' + r.title + '](' + r.url + ')');
      sections.push('  ' + truncateSnippet_(r.snippet));
    }
  }

  if (research.interviewerInfo) {
    var currentNames = {};
    if (event.interviewers) {
      for (var ci = 0; ci < event.interviewers.length; ci++) {
        if (event.interviewers[ci].name) currentNames[event.interviewers[ci].name] = true;
      }
    }
    var anyCurrent = false;
    for (var n in research.interviewerInfo) {
      if (Object.keys(currentNames).length === 0 || currentNames[n]) { anyCurrent = true; break; }
    }
    if (anyCurrent) {
      sections.push('\nINTERVIEWER RESEARCH (this round only):');
      for (var name in research.interviewerInfo) {
        if (Object.keys(currentNames).length > 0 && !currentNames[name]) continue;
        sections.push('  ' + name + ':');
        var results = research.interviewerInfo[name];
        for (var i = 0; i < results.length; i++) {
          sections.push('    [' + results[i].title + '](' + results[i].url + ')');
          sections.push('    ' + truncateSnippet_(results[i].snippet));
        }
      }
    }
  }

  if (research.glassdoorInfo && research.glassdoorInfo.length > 0) {
    sections.push('\nINTERVIEW TIPS & GLASSDOOR:');
    for (var i = 0; i < research.glassdoorInfo.length; i++) {
      var r = research.glassdoorInfo[i];
      sections.push('  [' + r.title + '](' + r.url + ')');
      sections.push('  ' + truncateSnippet_(r.snippet));
    }
  }

  if (research.compensationInfo && research.compensationInfo.length > 0) {
    sections.push('\nCOMPENSATION RESEARCH:');
    for (var i = 0; i < research.compensationInfo.length; i++) {
      var r = research.compensationInfo[i];
      sections.push('  [' + r.title + '](' + r.url + ')');
      sections.push('  ' + truncateSnippet_(r.snippet));
    }
  }

  if (research.socialLinks) {
    var hasSocial = false;
    for (var sp in research.socialLinks) { hasSocial = true; break; }
    if (hasSocial) {
      sections.push('\nOFFICIAL SOCIAL MEDIA:');
      for (var plat in research.socialLinks) {
        sections.push('  ' + plat + ': ' + research.socialLinks[plat]);
      }
    }
  }

  if (research.jobDescriptionUrl) {
    sections.push('\nJOB DESCRIPTION LINK (' + (research.jobDescriptionSource || 'unknown') + '): ' + research.jobDescriptionUrl);
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

var _runUsage = { inputTokens: 0, outputTokens: 0 };

function resetRunUsage_() {
  _runUsage = { inputTokens: 0, outputTokens: 0 };
}

function getRunCost_() {
  var config = getConfig();
  return calculateCost_(_runUsage.inputTokens, _runUsage.outputTokens, config.claudeModel);
}

function callClaudeApi_(systemPrompt, userMessage, maxTokens, options) {
  var config = getConfig();
  options = options || {};
  maxTokens = maxTokens || 1000;

  var payload = {
    model: options.model || config.claudeModel,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userMessage }]
  };

  if (systemPrompt) {
    if (options.cacheSystem) {
      payload.system = [{
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }
      }];
    } else {
      payload.system = systemPrompt;
    }
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
