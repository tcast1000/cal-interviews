# Interview Prep Automation

Automatically detects upcoming interviews from your Google Calendar, researches the company/role/interviewers, and generates comprehensive prep materials.

**Output:**
- **Google Sheet** — Master tracker with snapshot of each interview (date, company, role, talking points, status)
- **Google Doc** — Detailed prep document per interview (company overview, news, role analysis, interviewer backgrounds, practice questions, talking points)

## How It Works

1. Scans your Google Calendar for events with "interview" in the title (or your name, or from recruiting platforms)
2. Searches your Gmail for related emails to extract company/role/interviewer details
3. Researches the company, role, and interviewers via web search
4. Synthesizes everything into actionable prep materials using Claude AI
5. Creates a formatted Google Doc and adds a row to your tracker sheet

## Cost

- **Google APIs**: Free
- **Web search**: Free (DuckDuckGo)
- **Claude AI**: ~$0.02-0.03 per interview (~$1/month for active job searches)

## Quick Start

### Prerequisites
- Python 3.10+
- A Google account
- An [Anthropic API key](https://console.anthropic.com/)

### 1. Clone and install

```bash
git clone <repo-url>
cd cal-interviews
pip install -r requirements.txt
```

### 2. Set up Google Cloud credentials

See [setup_guide.md](setup_guide.md) for the full walkthrough. You'll need to:
1. Create a Google Cloud project
2. Enable Calendar, Gmail, Sheets, Docs, and Drive APIs
3. Create OAuth 2.0 credentials
4. Download `credentials.json` to this directory

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and add your Anthropic API key. Other settings are optional.

### 4. Run

```bash
python main.py
```

On first run, your browser will open for Google authorization. After that, the tool processes any upcoming interviews it finds.

## Usage

```bash
python main.py                  # Process new interviews (14-day lookahead)
python main.py --days 30        # Scan 30 days ahead
python main.py --dry-run        # Preview without creating docs
python main.py --refresh        # Re-process all upcoming interviews
python main.py --watch          # Poll every 30 minutes continuously
python main.py --check-setup    # Verify all API connections work
python main.py --event-id ID    # Process a specific calendar event
python main.py --verbose        # Enable debug logging
```

## What Gets Detected

The tool looks for calendar events that match any of these:
- Title contains "interview" (case-insensitive)
- Title contains your name (set `USER_NAME` in `.env`)
- Description contains "interview" + attendee from a recruiting platform
- Organizer from: Greenhouse, Lever, Ashby, GoodTime, Calendly, and others

## Personalization

Drop a `resume.txt` (or `.md`) in the project directory and set `RESUME_PATH=./resume.txt` in your `.env`. The tool will tailor talking points and question prep to your specific experience.

## Configuration

All settings are in `.env` (see [.env.example](.env.example) for the full list):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `GOOGLE_CREDENTIALS_PATH` | Yes | `./credentials.json` | Path to Google OAuth credentials |
| `USER_NAME` | No | auto-detect | Your name (for calendar matching) |
| `LOOK_AHEAD_DAYS` | No | `14` | Days ahead to scan |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-20250514` | Claude model to use |
| `GOOGLE_SHEET_ID` | No | auto-create | Existing sheet to use as tracker |
| `DRIVE_FOLDER_ID` | No | — | Google Drive folder for docs |
| `RESUME_PATH` | No | — | Path to resume for personalization |
| `TAVILY_API_KEY` | No | — | Tavily key for better search (free tier: 1000/mo) |

## Privacy

All personal data stays in `.env`, `credentials.json`, `token.json`, and `state.json` — all gitignored. The code contains zero hardcoded personal information. Safe to share, fork, and publish.
