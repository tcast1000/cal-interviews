var _configCache = null;

function getConfig() {
  if (_configCache !== null) return _configCache;

  var props = PropertiesService.getScriptProperties();
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}

  var aliasRaw = props.getProperty('USER_ALIASES') || '';
  var aliases = aliasRaw ? aliasRaw.split(',').map(function (a) { return a.trim(); }).filter(Boolean) : [];

  var extraDomainsRaw = props.getProperty('EXTRA_RECRUITING_DOMAINS') || '';
  var extraDomains = extraDomainsRaw ? extraDomainsRaw.split(',').map(function (d) { return d.trim().toLowerCase(); }).filter(Boolean) : [];

  var extraKeywordsRaw = props.getProperty('EXTRA_MATCH_KEYWORDS') || '';
  var extraKeywords = extraKeywordsRaw ? extraKeywordsRaw.split(',').map(function (k) { return k.trim().toLowerCase(); }).filter(Boolean) : [];

  _configCache = {
    anthropicApiKey: props.getProperty('ANTHROPIC_API_KEY') || '',
    userName: props.getProperty('USER_NAME') || '',
    userAliases: aliases,
    userEmail: props.getProperty('USER_EMAIL') || email,
    lookAheadDays: parseInt(props.getProperty('LOOK_AHEAD_DAYS') || '14', 10),
    tavilyApiKey: props.getProperty('TAVILY_API_KEY') || '',
    claudeModel: props.getProperty('CLAUDE_MODEL') || 'claude-sonnet-4-6',
    driveFolderId: props.getProperty('DRIVE_FOLDER_ID') || '',
    resumeText: props.getProperty('RESUME_TEXT') || '',
    extraRecruitingDomains: extraDomains,
    extraMatchKeywords: extraKeywords
  };
  return _configCache;
}

function invalidateConfigCache_() {
  _configCache = null;
}

function validateConfig() {
  var config = getConfig();
  var errors = [];

  if (!config.anthropicApiKey) {
    errors.push('ANTHROPIC_API_KEY is not set. Use "Setup API Keys" from the menu.');
  } else if (config.anthropicApiKey.indexOf('sk-ant-') !== 0) {
    errors.push('ANTHROPIC_API_KEY doesn\'t look right — should start with "sk-ant-".');
  }

  if (!config.userName) {
    errors.push('USER_NAME is not set. Use "Setup API Keys" from the menu.');
  }

  return { valid: errors.length === 0, errors: errors };
}

function setupApiKeys() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var currentKey = props.getProperty('ANTHROPIC_API_KEY') || '';
  var keyHint = currentKey ? ' (currently set: ***' + currentKey.slice(-4) + ')' : '';
  var keyResult = ui.prompt(
    'Anthropic API Key',
    'Enter your Claude API key' + keyHint + '.\nGet one at https://console.anthropic.com/\n\nLeave blank to keep current value.',
    ui.ButtonSet.OK_CANCEL
  );
  if (keyResult.getSelectedButton() === ui.Button.CANCEL) return;
  var newKey = keyResult.getResponseText().trim();
  if (newKey) props.setProperty('ANTHROPIC_API_KEY', newKey);

  var currentName = props.getProperty('USER_NAME') || '';
  var nameResult = ui.prompt(
    'Your Name',
    'Enter your full name (used to detect interview events with your name in the title).\nCurrent: ' + (currentName || '(not set)'),
    ui.ButtonSet.OK_CANCEL
  );
  if (nameResult.getSelectedButton() === ui.Button.CANCEL) return;
  var newName = nameResult.getResponseText().trim();
  if (newName) props.setProperty('USER_NAME', newName);

  var currentAliases = props.getProperty('USER_ALIASES') || '';
  var aliasResult = ui.prompt(
    'Name Aliases (Optional)',
    'Enter alternate names/aliases, comma-separated (e.g. "Theodore Castro,Theodore").\nUsed to detect events with your name in the title.\nCurrent: ' + (currentAliases || '(not set)'),
    ui.ButtonSet.OK_CANCEL
  );
  if (aliasResult.getSelectedButton() !== ui.Button.CANCEL) {
    var newAliases = aliasResult.getResponseText().trim();
    if (newAliases) props.setProperty('USER_ALIASES', newAliases);
  }

  var tavilyResult = ui.prompt(
    'Tavily API Key (Optional)',
    'Enter your Tavily API key for web search (free: 1000 searches/mo at tavily.com).\nLeave blank to skip — Claude will use its training knowledge instead.',
    ui.ButtonSet.OK_CANCEL
  );
  if (tavilyResult.getSelectedButton() !== ui.Button.CANCEL) {
    var tavilyKey = tavilyResult.getResponseText().trim();
    if (tavilyKey) props.setProperty('TAVILY_API_KEY', tavilyKey);
  }

  var folderResult = ui.prompt(
    'Google Drive Folder ID (Optional)',
    'Enter a Drive folder ID to store prep docs in.\nLeave blank to create docs in your Drive root.',
    ui.ButtonSet.OK_CANCEL
  );
  if (folderResult.getSelectedButton() !== ui.Button.CANCEL) {
    var folderId = folderResult.getResponseText().trim();
    if (folderId) props.setProperty('DRIVE_FOLDER_ID', folderId);
  }

  try {
    var email = Session.getActiveUser().getEmail();
    if (email) props.setProperty('USER_EMAIL', email);
  } catch (e) {}

  invalidateConfigCache_();
  ui.alert('Setup complete! Use "Check Setup" to verify everything works.');
}
