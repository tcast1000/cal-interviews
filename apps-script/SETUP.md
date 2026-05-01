# Apps Script Setup Guide — Interview Prep Automation

This version runs entirely in Google's cloud. No Python, no local setup, no machine that needs to stay on. It triggers automatically when interview events appear on your calendar.

**Time required:** ~5 minutes (you already have an Anthropic API key)

---

## Step 1: Create a New Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet
2. Name it **"Interview Prep Tracker"** (or anything you like)

This spreadsheet becomes your interview tracker AND the home for the automation script.

## Step 2: Open the Apps Script Editor

1. In your new spreadsheet, go to **Extensions > Apps Script**
2. This opens the Apps Script editor in a new tab
3. You'll see a default file called `Code.gs` with an empty `myFunction` — delete all that content

## Step 3: Create the Script Files

You need to create 10 files. For each one:
1. Click the **+** button next to "Files" in the left sidebar
2. Select **Script**
3. Name it exactly as listed below (without the `.gs` extension — Apps Script adds it)
4. Paste the corresponding code

Create these files and paste the code from the `apps-script/` folder:

| File Name | Paste Code From |
|-----------|----------------|
| `Code` | `Code.gs` (replace the default file) |
| `Config` | `Config.gs` |
| `CalendarMonitor` | `CalendarMonitor.gs` |
| `GmailScanner` | `GmailScanner.gs` |
| `WebResearcher` | `WebResearcher.gs` |
| `LLMSynthesizer` | `LLMSynthesizer.gs` |
| `DocsWriter` | `DocsWriter.gs` |
| `SheetsWriter` | `SheetsWriter.gs` |
| `StateManager` | `StateManager.gs` |
| `Utils` | `Utils.gs` |

**Tip:** You can have this guide and the code files open side by side.

## Step 4: Save and Return to Your Sheet

1. Click the 💾 save icon (or Ctrl+S) in the Apps Script editor
2. Go back to your Google Sheet tab
3. **Reload the page** (F5 or Ctrl+R)
4. Wait a few seconds — you should see a new **"Interview Prep"** menu appear in the menu bar

If the menu doesn't appear, wait 10 seconds and reload again.

## Step 5: Set Up API Keys

1. Click **Interview Prep > Setup API Keys**
2. You'll be prompted for:
   - **Anthropic API Key** (required) — your `sk-ant-...` key
   - **Your Name** (required) — used to detect events like "John Smith and Jane Doe"
   - **Tavily API Key** (optional) — for web search. Get a free key at [tavily.com](https://tavily.com)
   - **Drive Folder ID** (optional) — to organize prep docs in a specific folder

**First time:** Google will ask you to authorize the script. Click through:
1. "Authorization required" → **Continue**
2. Choose your Google account
3. "Google hasn't verified this app" → **Advanced** → **Go to Interview Prep Tracker (unsafe)**
4. **Allow** all permissions

This is safe — you're authorizing your own script to access your own data.

## Step 6: Check Setup

Click **Interview Prep > Check Setup**

You should see all ✓ results (except the calendar trigger, which we'll install next).

## Step 7: Install the Calendar Trigger

Click **Interview Prep > Install Calendar Trigger**

This creates an automatic trigger that fires whenever your Google Calendar changes. When a new interview event is detected, the script will automatically:
1. Search your Gmail for context
2. Research the company and interviewers
3. Create a detailed prep Google Doc
4. Add a row to the tracker sheet

## Step 8: Test It

Option A: Click **Interview Prep > Run Manual Check** to process any existing upcoming interviews.

Option B: Create a test calendar event with "Interview" in the title, wait 1-2 minutes, and check your sheet.

---

## How It Works

- **Calendar trigger** fires on any calendar change (create, update, delete)
- Script scans the next 14 days for events matching interview patterns
- Already-processed events are skipped (tracked in Script Properties)
- New interview events are processed through the pipeline: Gmail → Research → Claude → Doc → Sheet
- If more than 3 interviews are found at once, the rest are queued for the next run

## Sharing With Others

Anyone can use this automation for their own interviews:

1. Create a new Google Sheet
2. Copy all the script files into Extensions > Apps Script
3. Set up their own API keys via the menu
4. Install their own calendar trigger

No credentials are shared. Each person's script runs under their own Google account.

## Troubleshooting

### Menu doesn't appear
Reload the spreadsheet. The `onOpen` function runs when the sheet opens.

### "Authorization required" keeps appearing
Make sure you clicked "Allow" for all permissions. Check Extensions > Apps Script > Triggers to see if the trigger exists.

### Errors in processing
Check the "Errors" tab in your spreadsheet — the script logs failures there.

### View execution logs
Go to Extensions > Apps Script > Executions (left sidebar) to see detailed logs for each run.

### Need to re-authorize
Delete `token.json` equivalent: go to Extensions > Apps Script > Project Settings > Script Properties and clear, then re-run Setup API Keys.
