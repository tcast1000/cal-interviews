# Apps Script Setup Guide

This version runs entirely in Google's cloud. No Python, no local machine, no server. It triggers automatically when calendar events are created or updated.

**Time required:** ~5 minutes

---

## 1. Create a Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new blank spreadsheet
2. Name it **"Interview Prep Tracker"** (or anything you like)

This spreadsheet becomes your tracker and the home for the automation script.

## 2. Open the Script Editor

1. Go to **Extensions > Apps Script**
2. Delete the default `myFunction` content in `Code.gs`

## 3. Create the Script Files

For each file below, click **+** next to "Files" in the sidebar, select **Script**, and paste the corresponding code from the `apps-script/` folder in this repo.

| File | Description |
|------|-------------|
| `Code` | Entry points, menu, triggers (replace the default file) |
| `Config` | Script properties and setup prompts |
| `CalendarMonitor` | Calendar scanning and event detection |
| `GmailScanner` | Gmail search and Claude extraction |
| `WebResearcher` | Tavily web search |
| `LLMSynthesizer` | Claude prompt, synthesis, API calls |
| `DocsWriter` | Google Doc creation |
| `SheetsWriter` | Tracker sheet + pipeline overview tab |
| `StateManager` | Processed events + pipeline state |
| `Utils` | Shared helpers and constants |

Save all files (Ctrl+S).

## 4. Authorize and Configure

1. Go back to your spreadsheet and **reload the page**
2. A new **Interview Prep** menu appears in the menu bar
3. Click **Interview Prep > Setup API Keys**
4. You'll be prompted for:
   - **Anthropic API Key** (required) — your `sk-ant-...` key
   - **Your Name** (required) — used to match events with your name in the title
   - **Name Aliases** (optional) — alternate names, comma-separated (e.g. `Theodore Castro,Theodore`)
   - **Tavily API Key** (optional) — for web search ([free at tavily.com](https://tavily.com))
   - **Drive Folder ID** (optional) — to organize docs in a folder

On first run, Google asks you to authorize the script:
1. "Authorization required" > **Continue**
2. Choose your Google account
3. "Google hasn't verified this app" > **Advanced** > **Go to Interview Prep Tracker (unsafe)**
4. **Allow** all permissions

This is safe — you're authorizing your own script to access your own data.

## 5. Verify

Click **Interview Prep > Check Setup**. You should see all checks pass.

## 6. Install the Calendar Trigger

Click **Interview Prep > Install Calendar Trigger**

This creates an automatic trigger that fires whenever your Google Calendar changes. New interviews are detected and processed automatically.

## 7. Test

**Option A:** Click **Interview Prep > Run Manual Check** to process any existing upcoming interviews.

**Option B:** Create a test event with "Interview" in the title, wait 1–2 minutes, then check your sheet.

---

## What Happens Automatically

When the calendar trigger fires:

1. Scans next 14 days for interview events (skips cancelled/declined and already-processed)
2. Searches Gmail for related emails, extracts company/role/interviewers via Claude
3. Researches company, products, competitors, news, compensation, and interviewers via Tavily
4. Synthesizes prep materials with Claude into structured JSON
5. Creates a formatted Google Doc with all sections
6. Adds a row to the Interview Tracker tab with quick-glance talking points and comp range
7. Registers the interview in the Pipeline Overview tab

If more than 3 interviews are found at once, the rest are queued and processed in a follow-up run.

## Additional Features

- **View Pipeline** — Click **Interview Prep > View Pipeline** to see all active interview pipelines with stage counts and follow-up status
- **Refresh All** — Re-process all upcoming interviews (creates new docs)
- **Pipeline Overview tab** — Auto-synced company-level view with color-coded status

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Menu doesn't appear | Reload the spreadsheet (F5) |
| "Authorization required" keeps appearing | Make sure you clicked **Allow** for all permissions |
| Errors in processing | Check the **Errors** tab in the spreadsheet |
| View execution logs | Apps Script editor > **Executions** in the left sidebar |
| Need to reset config | Apps Script editor > **Project Settings** > **Script Properties** |

---

## Sharing

Anyone can use this for their own interviews:

1. Create a new Google Sheet
2. Copy all script files into Extensions > Apps Script
3. Run Setup API Keys with their own Anthropic key
4. Install their own calendar trigger

No credentials are shared. Each person's script runs under their own Google account.
