# Interview Prep Automation

Automatically detects upcoming interviews from your Google Calendar, researches the company, role, interviewers, and compensation, then generates a detailed prep doc and tracks everything in a master spreadsheet.

Two deployment options:
- **Google Apps Script** — Runs in the cloud, triggers automatically on calendar changes. Zero infrastructure.
- **Python CLI** — Runs locally or on a server with more control and DuckDuckGo fallback for free web search.

## What It Does

```
Calendar Event Detected
        |
        v
  Gmail Enrichment ──> extracts company, role, interviewers, prep instructions
        |
        v
   Web Research ──> company overview, products, competitors, news, comp data, Glassdoor
        |
        v
  Claude Synthesis ──> structured prep materials with tailored talking points
        |
        v
  Google Doc Created ──> formatted prep document with all sections
        |
        v
  Tracker Sheet Updated ──> quick-glance row with status, comp range, key reminders
        |
        v
  Pipeline Registered ──> company-level stage tracking, follow-up reminders
```

## Output

**Google Doc** — One per interview, containing:
- Company overview, products & services, competitors
- Recent news and role analysis
- Interviewer backgrounds
- Tailored interview questions and questions to ask
- Compensation context (base range, total comp, equity, source)
- Key talking points matched to your experience

**Google Sheet** — Master tracker with:
- Interview Tracker tab — date, company, role, type, quick-glance talking points, comp range, status, doc link
- Pipeline Overview tab — company-level view of all active pipelines with stage count, days since last activity, and next action
- Summary tab — total API cost and interview count

## Detection

Events are flagged as interviews when any of these match:
- Title contains "interview"
- Title contains your name or configured aliases
- Title contains a configured extra keyword
- Description mentions "interview" + attendee from a recruiting platform or soft keyword in title
- Attendee from a recruiting platform + soft keyword in title (screen, chat, call, intro, etc.)

Recognized recruiting platforms: Greenhouse, Lever, Ashby, GoodTime, Calendly, iCIMS, Workday, SmartRecruiters, Rippling, BambooHR, Jobvite, and more. Additional domains can be added via config.

Cancelled events and events you've declined are automatically skipped.

## Cost

| Component | Cost |
|-----------|------|
| Google APIs | Free |
| Web search (DuckDuckGo) | Free |
| Web search (Tavily) | Free tier: 1,000 searches/month |
| Claude AI | ~$0.02–0.04 per interview |

A typical active job search costs under $1/month in API usage.

## Quick Start

### Option A: Google Apps Script (recommended)

No Python, no local machine required. See **[Apps Script Setup Guide](apps-script/SETUP.md)**.

### Option B: Python CLI

#### Prerequisites
- Python 3.10+
- A Google account
- An [Anthropic API key](https://console.anthropic.com/)

#### Install

```bash
git clone https://github.com/tcast1000/cal-interviews.git
cd cal-interviews
pip install -r requirements.txt
cp .env.example .env
```

Edit `.env` and add your Anthropic API key. See **[Python Setup Guide](setup_guide.md)** for Google Cloud credentials walkthrough.

#### Run

```bash
python main.py                  # Process new interviews
python main.py --days 30        # Scan 30 days ahead
python main.py --dry-run        # Preview without creating docs
python main.py --refresh        # Re-process all upcoming interviews
python main.py --watch          # Poll every 30 minutes
python main.py --check-setup    # Verify API connections
python main.py --pipeline       # View all active pipelines
python main.py --follow-ups     # Generate follow-up email drafts
python main.py --debrief --company "Acme" --notes "Went well"
python main.py --verbose        # Debug logging
```

## Configuration

All settings are in `.env` (see [.env.example](.env.example)):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `GOOGLE_CREDENTIALS_PATH` | Yes | `./credentials.json` | Google OAuth credentials |
| `USER_NAME` | No | auto-detect | Your name (for calendar matching) |
| `USER_ALIASES` | No | — | Alternate names, comma-separated |
| `USER_EMAIL` | No | auto-detect | Your email |
| `LOOK_AHEAD_DAYS` | No | `14` | Days ahead to scan |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | Claude model |
| `GOOGLE_SHEET_ID` | No | auto-create | Existing tracker sheet ID |
| `DRIVE_FOLDER_ID` | No | — | Drive folder for docs |
| `RESUME_PATH` | No | — | Path to resume for personalized prep |
| `TAVILY_API_KEY` | No | — | Tavily key for web search |
| `CALENDAR_IDS` | No | `primary` | Calendar IDs to scan, comma-separated |
| `EXTRA_RECRUITING_DOMAINS` | No | — | Additional ATS domains to recognize |
| `EXTRA_MATCH_KEYWORDS` | No | — | Extra keywords that flag events as interviews |

## Personalization

Set `RESUME_PATH=./resume.txt` in `.env` (supports `.txt` or `.md`). Claude will reference your specific experience to generate tailored talking points, role-fit analysis, and questions to ask.

## Project Structure

```
cal-interviews/
├── main.py                  # CLI entry point
├── config.py                # Configuration from .env
├── auth.py                  # Google OAuth + service wrappers
├── calendar_monitor.py      # Calendar scanning and event detection
├── gmail_scanner.py         # Gmail search and Claude extraction
├── web_researcher.py        # Tavily / DuckDuckGo search
├── llm_synthesizer.py       # Claude prompt and response parsing
├── docs_writer.py           # Google Docs creation
├── sheets_writer.py         # Google Sheets tracker + pipeline tab
├── pipeline_tracker.py      # Company-level pipeline state
├── post_interview.py        # Thank-you and follow-up email drafts
├── state_manager.py         # Persistent state (processed events, pipelines)
├── models.py                # Data models
├── utils.py                 # Shared utilities
├── requirements.txt
├── .env.example
├── setup_guide.md           # Python setup walkthrough
└── apps-script/             # Google Apps Script version
    ├── SETUP.md             # Apps Script setup walkthrough
    ├── Code.gs              # Entry points, triggers, menu
    ├── Config.gs            # Script properties config
    ├── CalendarMonitor.gs   # Event detection
    ├── GmailScanner.gs      # Gmail enrichment
    ├── WebResearcher.gs     # Tavily search
    ├── LLMSynthesizer.gs   # Claude synthesis
    ├── DocsWriter.gs        # Google Doc creation
    ├── SheetsWriter.gs      # Sheet + pipeline tab
    ├── StateManager.gs      # State persistence
    └── Utils.gs             # Shared helpers
```

## Privacy

All credentials and personal data stay in files that are gitignored:
- `.env` — API keys and config
- `credentials.json` — Google OAuth client config
- `token.json` — Google OAuth refresh token
- `state.json` — local processing state

The repository contains zero hardcoded secrets or personal information.

## License

MIT
