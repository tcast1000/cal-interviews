function researchInterview(event) {
  var config = getConfig();
  var results = {
    companyInfo: [],
    companyNews: [],
    roleInfo: [],
    interviewerInfo: {},
    glassdoorInfo: []
  };

  var company = event.companyName || 'Unknown Company';
  var role = event.roleTitle || '';

  if (company === 'Unknown Company') {
    var domains = getNonPersonalDomains_(event.attendees);
    if (domains.length > 0) {
      company = domains[0].split('.')[0];
      company = company.charAt(0).toUpperCase() + company.slice(1);
    }
  }

  console.log('Researching: ' + company + ' — ' + (role || 'role unknown'));

  if (!config.tavilyApiKey) {
    console.log('No Tavily API key — skipping web search (Claude will use training knowledge)');
    return results;
  }

  if (company !== 'Unknown Company') {
    console.log('  Searching company overview...');
    results.companyInfo = searchTavily_('"' + company + '" company overview about', config.tavilyApiKey, 5);

    console.log('  Searching recent news...');
    results.companyNews = searchTavily_('"' + company + '" recent news 2026', config.tavilyApiKey, 3);

    console.log('  Searching interview tips...');
    results.glassdoorInfo = searchTavily_('"' + company + '" glassdoor interview experience', config.tavilyApiKey, 3);
  }

  if (role && company !== 'Unknown Company') {
    console.log('  Searching role details...');
    results.roleInfo = searchTavily_('"' + role + '" "' + company + '" job description responsibilities', config.tavilyApiKey, 5);
  }

  var interviewers = event.interviewers || [];
  for (var i = 0; i < Math.min(interviewers.length, 3); i++) {
    if (interviewers[i].name) {
      console.log('  Searching interviewer: ' + interviewers[i].name);
      results.interviewerInfo[interviewers[i].name] = searchTavily_(
        '"' + interviewers[i].name + '" "' + company + '" linkedin', config.tavilyApiKey, 3
      );
    }
  }

  var total = results.companyInfo.length + results.companyNews.length +
    results.roleInfo.length + results.glassdoorInfo.length;
  for (var name in results.interviewerInfo) {
    total += results.interviewerInfo[name].length;
  }
  console.log('Research complete: ' + total + ' total results gathered');

  return results;
}

function searchTavily_(query, apiKey, maxResults) {
  try {
    var response = UrlFetchApp.fetch('https://api.tavily.com/search', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        api_key: apiKey,
        query: query,
        max_results: maxResults || 5,
        search_depth: 'basic'
      }),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      console.warn('Tavily search failed (' + response.getResponseCode() + ') for: ' + query);
      return [];
    }

    var data = JSON.parse(response.getContentText());
    return (data.results || []).map(function (r) {
      return {
        title: r.title || '',
        snippet: r.content || '',
        url: r.url || ''
      };
    });
  } catch (e) {
    console.warn('Tavily search error for "' + query + '": ' + e);
    return [];
  }
}
