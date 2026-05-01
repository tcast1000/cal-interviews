function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}

  return {
    anthropicApiKey: props.getProperty('ANTHROPIC_API_KEY') || '',
    userName: props.getProperty('USER_NAME') || '',
    userEmail: props.getProperty('USER_EMAIL') || email,
    lookAheadDays: parseInt(props.getProperty('LOOK_AHEAD_DAYS') || '14', 10),
    tavilyApiKey: props.getProperty('TAVILY_API_KEY') || '',
    claudeModel: props.getProperty('CLAUDE_MODEL') || 'claude-sonnet-4-6',
    driveFolderId: props.getProperty('DRIVE_FOLDER_ID') || '',
    resumeText: props.getProperty('RESUME_TEXT') || ''
  };
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

  ui.alert('Setup complete! Use "Check Setup" to verify everything works.');
}
