var SOCIAL_PLATFORMS = [
  { name: 'LinkedIn', host: 'linkedin.com', match: ['linkedin.com/company', 'linkedin.com/school'] },
  { name: 'X / Twitter', host: 'twitter.com', match: ['twitter.com', 'x.com'] },
  { name: 'GitHub', host: 'github.com', match: ['github.com'] },
  { name: 'YouTube', host: 'youtube.com', match: ['youtube.com/@', 'youtube.com/c/', 'youtube.com/user/', 'youtube.com/channel/'] },
  { name: 'Instagram', host: 'instagram.com', match: ['instagram.com'] },
  { name: 'Facebook', host: 'facebook.com', match: ['facebook.com'] },
  { name: 'TikTok', host: 'tiktok.com', match: ['tiktok.com/@'] },
  { name: 'Threads', host: 'threads.net', match: ['threads.net/@', 'threads.com/@'] },
  { name: 'Bluesky', host: 'bsky.app', match: ['bsky.app/profile'] }
];

var EXCLUDED_SOCIAL_PATHS = ['linkedin.com/in', 'linkedin.com/pub', 'linkedin.com/posts', 'linkedin.com/feed'];

var GENERIC_ROLE_TITLES = {
  'software engineer': true, 'engineer': true, 'developer': true,
  'manager': true, 'product manager': true, 'data scientist': true,
  'analyst': true, 'designer': true, 'consultant': true
};

function researchInterview(event, cachedCompanyResearch) {
  var config = getConfig();
  var company = event.companyName || 'Unknown Company';
  var role = event.roleTitle || '';

  if (company === 'Unknown Company') {
    var domains = getNonPersonalDomains_(event.attendees);
    if (domains.length > 0) {
      company = domains[0].split('.')[0];
      company = company.charAt(0).toUpperCase() + company.slice(1);
    }
  }

  var results;
  if (cachedCompanyResearch) {
    results = hydrateCachedResearch_(cachedCompanyResearch);
    results.fromCache = true;
    console.log('Researching: ' + company + ' — ' + (role || 'role unknown') + ' (using cached company research)');
  } else {
    results = {
      companyInfo: [], productsAndServices: [], competitors: [],
      companyNews: [], roleInfo: [], interviewerInfo: {},
      glassdoorInfo: [], compensationInfo: [],
      valuesInfo: [], socialLinks: {},
      jobDescriptionUrl: '', jobDescriptionSource: '',
      fromCache: false
    };
    console.log('Researching: ' + company + ' — ' + (role || 'role unknown'));
  }

  if (!config.tavilyApiKey) {
    console.log('No Tavily API key — skipping web search (Claude will use training knowledge)');
    return results;
  }

  if (!cachedCompanyResearch && company !== 'Unknown Company') {
    console.log('  Searching company (overview + products + competitors + values, one call)...');
    results.companyInfo = searchTavily_('"' + company + '" overview products services competitors values culture', config.tavilyApiKey, 5);

    console.log('  Searching recent news (news topic)...');
    results.companyNews = searchTavily_('"' + company + '" recent news', config.tavilyApiKey, 3, 'news');

    console.log('  Searching interview tips...');
    results.glassdoorInfo = searchTavily_('"' + company + '" glassdoor interview experience', config.tavilyApiKey, 3);

    console.log('  Searching social media...');
    results.socialLinks = findSocialLinks_(company, config.tavilyApiKey);
  }

  if (!cachedCompanyResearch && role && company !== 'Unknown Company') {
    console.log('  Searching role details...');
    results.roleInfo = searchTavily_('"' + role + '" "' + company + '" job description responsibilities', config.tavilyApiKey, 3);

    console.log('  Searching compensation data...');
    results.compensationInfo = searchTavily_('"' + company + '" "' + role + '" salary compensation levels.fyi glassdoor', config.tavilyApiKey, 3);
    if (results.compensationInfo.length === 0) {
      results.compensationInfo = searchTavily_('"' + role + '" salary range compensation', config.tavilyApiKey, 3);
    }

    console.log('  Searching job description...');
    var jd = findJobDescription_(company, role, config.tavilyApiKey);
    results.jobDescriptionUrl = jd.url;
    results.jobDescriptionSource = jd.source;
  } else if (!cachedCompanyResearch && company !== 'Unknown Company') {
    console.log('  Searching general compensation data...');
    results.compensationInfo = searchTavily_('"' + company + '" salary compensation levels.fyi glassdoor', config.tavilyApiKey, 3);
  }

  var interviewers = event.interviewers || [];
  for (var i = 0; i < Math.min(interviewers.length, 3); i++) {
    var iv = interviewers[i];
    if (!iv.name) continue;
    if (results.interviewerInfo[iv.name] && results.interviewerInfo[iv.name].length > 0) continue;
    if (!iv.title && !iv.email) {
      console.log('  Skipping interviewer ' + iv.name + ' (no title/email — name alone too generic)');
      continue;
    }
    console.log('  Searching ' + (cachedCompanyResearch ? 'new ' : '') + 'interviewer: ' + iv.name);
    results.interviewerInfo[iv.name] = searchTavily_(
      '"' + iv.name + '" "' + company + '" linkedin', config.tavilyApiKey, 3
    );
  }

  var total = results.companyInfo.length + results.productsAndServices.length +
    results.competitors.length + results.companyNews.length +
    results.roleInfo.length + results.glassdoorInfo.length +
    results.compensationInfo.length + (results.valuesInfo || []).length;
  for (var name in results.interviewerInfo) {
    total += results.interviewerInfo[name].length;
  }
  var socialCount = 0;
  for (var p in (results.socialLinks || {})) socialCount++;
  console.log('Research complete: ' + total + ' results, ' + socialCount + ' social links, JD: ' + (results.jobDescriptionSource || 'none'));

  return results;
}

function searchTavily_(query, apiKey, maxResults, topic) {
  try {
    var payload = {
      api_key: apiKey,
      query: query,
      max_results: maxResults || 5,
      search_depth: 'basic'
    };
    if (topic) {
      payload.topic = topic;
      if (topic === 'news') payload.days = 30;
    }
    var response = UrlFetchApp.fetch('https://api.tavily.com/search', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.warn('Tavily search failed (' + response.getResponseCode() + ') for: ' + query);
      return [];
    }

    var data = JSON.parse(response.getContentText());
    return (data.results || []).map(function (r) {
      return { title: r.title || '', snippet: r.content || '', url: r.url || '' };
    });
  } catch (e) {
    console.warn('Tavily search error for "' + query + '": ' + e);
    return [];
  }
}

function pickFirstMatchingUrl_(results, substrings) {
  for (var i = 0; i < results.length; i++) {
    var url = (results[i].url || '').toLowerCase();
    if (!url) continue;
    var excluded = false;
    for (var e = 0; e < EXCLUDED_SOCIAL_PATHS.length; e++) {
      if (url.indexOf(EXCLUDED_SOCIAL_PATHS[e]) !== -1) { excluded = true; break; }
    }
    if (excluded) continue;
    for (var s = 0; s < substrings.length; s++) {
      if (url.indexOf(substrings[s]) !== -1) return results[i].url;
    }
  }
  return '';
}

function findSocialLinks_(company, apiKey) {
  var found = {};
  if (!company || company === 'Unknown Company') return found;

  var broad = searchTavily_('"' + company + '" official social media linkedin twitter github', apiKey, 5);
  for (var i = 0; i < SOCIAL_PLATFORMS.length; i++) {
    var p = SOCIAL_PLATFORMS[i];
    var url = pickFirstMatchingUrl_(broad, p.match);
    if (url) {
      found[p.name] = url;
      console.log('  Social (broad): ' + p.name + ' -> ' + url);
    }
  }

  for (var j = 0; j < SOCIAL_PLATFORMS.length; j++) {
    var plat = SOCIAL_PLATFORMS[j];
    if (found[plat.name]) continue;
    var results = searchTavily_('"' + company + '" site:' + plat.host, apiKey, 3);
    var u = pickFirstMatchingUrl_(results, plat.match);
    if (u) {
      found[plat.name] = u;
      console.log('  Social (targeted): ' + plat.name + ' -> ' + u);
    }
  }
  return found;
}

function findJobDescription_(company, role, apiKey) {
  if (!company || company === 'Unknown Company' || !role) return { url: '', source: '' };
  if (GENERIC_ROLE_TITLES[role.trim().toLowerCase()]) {
    console.log('  Skipping JD search — role "' + role + '" is too generic to match LinkedIn jobs reliably');
    return { url: '', source: '' };
  }

  var linkedinResults = searchTavily_('site:linkedin.com/jobs "' + company + '" "' + role + '"', apiKey, 3);
  for (var i = 0; i < linkedinResults.length; i++) {
    if ((linkedinResults[i].url || '').toLowerCase().indexOf('linkedin.com/jobs') !== -1) {
      return { url: linkedinResults[i].url, source: 'LinkedIn' };
    }
  }

  var atsResults = searchTavily_(
    '(site:greenhouse.io OR site:lever.co OR site:ashbyhq.com OR site:jobs.ashbyhq.com) "' + company + '" "' + role + '"',
    apiKey, 3
  );
  for (var j = 0; j < atsResults.length; j++) {
    var url = (atsResults[j].url || '').toLowerCase();
    if (url.indexOf('greenhouse.io') !== -1) return { url: atsResults[j].url, source: 'Greenhouse' };
    if (url.indexOf('lever.co') !== -1) return { url: atsResults[j].url, source: 'Lever' };
    if (url.indexOf('ashbyhq.com') !== -1) return { url: atsResults[j].url, source: 'Ashby' };
  }

  var careersResults = searchTavily_('"' + company + '" careers "' + role + '"', apiKey, 3);
  for (var k = 0; k < careersResults.length; k++) {
    var cUrl = (careersResults[k].url || '').toLowerCase();
    if (cUrl.indexOf('careers') !== -1 || cUrl.indexOf('/jobs/') !== -1) {
      return { url: careersResults[k].url, source: 'Company careers page' };
    }
  }
  if (careersResults.length > 0) {
    return { url: careersResults[0].url, source: 'Company careers page' };
  }

  return { url: '', source: '' };
}

function hydrateCachedResearch_(cached) {
  var data = (cached && cached.data) ? cached.data : cached;
  data = data || {};
  return {
    companyInfo: data.companyInfo || [],
    productsAndServices: data.productsAndServices || [],
    competitors: data.competitors || [],
    companyNews: data.companyNews || [],
    roleInfo: data.roleInfo || [],
    interviewerInfo: data.interviewerInfo || {},
    glassdoorInfo: data.glassdoorInfo || [],
    compensationInfo: data.compensationInfo || [],
    valuesInfo: data.valuesInfo || [],
    socialLinks: data.socialLinks || {},
    jobDescriptionUrl: data.jobDescriptionUrl || '',
    jobDescriptionSource: data.jobDescriptionSource || '',
    fromCache: true
  };
}

function researchToCacheDict_(research) {
  return {
    companyInfo: research.companyInfo || [],
    productsAndServices: research.productsAndServices || [],
    competitors: research.competitors || [],
    companyNews: research.companyNews || [],
    roleInfo: research.roleInfo || [],
    interviewerInfo: research.interviewerInfo || {},
    glassdoorInfo: research.glassdoorInfo || [],
    compensationInfo: research.compensationInfo || [],
    valuesInfo: research.valuesInfo || [],
    socialLinks: research.socialLinks || {},
    jobDescriptionUrl: research.jobDescriptionUrl || '',
    jobDescriptionSource: research.jobDescriptionSource || ''
  };
}
