# Setup Guide — Google Cloud Project from Scratch

This guide walks you through creating a Google Cloud project and getting the credentials needed to run the Interview Prep Automation.

**Time required:** ~10-15 minutes

---

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with the Google account you want to use (the one with your calendar/email)
3. Click the project dropdown at the top of the page (it might say "Select a project" or show an existing project name)
4. Click **New Project**
5. Name it something like `interview-prep` (the name doesn't matter)
6. Click **Create**
7. Make sure your new project is selected in the dropdown

## Step 2: Enable the Required APIs

You need to enable 5 APIs. The fastest way:

1. Go to [APIs & Services > Library](https://console.cloud.google.com/apis/library)
2. Search for and enable each of these (click on each, then click **Enable**):
   - **Google Calendar API**
   - **Gmail API**
   - **Google Sheets API**
   - **Google Docs API**
   - **Google Drive API**

Or use these direct links (make sure your project is selected):
- https://console.cloud.google.com/apis/library/calendar-json.googleapis.com
- https://console.cloud.google.com/apis/library/gmail.googleapis.com
- https://console.cloud.google.com/apis/library/sheets.googleapis.com
- https://console.cloud.google.com/apis/library/docs.googleapis.com
- https://console.cloud.google.com/apis/library/drive.googleapis.com

## Step 3: Configure the OAuth Consent Screen

1. Go to [APIs & Services > OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. Select **External** user type (unless you have a Google Workspace org and want Internal)
3. Click **Create**
4. Fill in the required fields:
   - **App name**: `Interview Prep` (or anything you like)
   - **User support email**: Select your email
   - **Developer contact information**: Your email
5. Click **Save and Continue**
6. On the **Scopes** page, click **Add or Remove Scopes** and add these:
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive.file`
7. Click **Update**, then **Save and Continue**
8. On the **Test users** page, click **Add Users** and add your own email address
9. Click **Save and Continue**, then **Back to Dashboard**

**Important:** While the app is in "Testing" mode, only the test users you added can authorize it. This is fine for personal use. If you want others to use your specific credentials, add their emails as test users, or publish the app (requires Google review).

## Step 4: Create OAuth 2.0 Credentials

1. Go to [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **+ Create Credentials** at the top
3. Select **OAuth client ID**
4. For **Application type**, select **Desktop app**
5. Name it `Interview Prep CLI` (or anything)
6. Click **Create**
7. A dialog will show your Client ID and Client Secret — click **Download JSON**
8. **Rename the downloaded file** to `credentials.json`
9. **Move it** to the `cal-interviews/` project directory (same folder as `main.py`)

## Step 5: Get an Anthropic API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Sign up or log in
3. Go to **API Keys** and create a new key
4. Copy the key (starts with `sk-ant-`)

## Step 6: Configure Your .env File

```bash
cp .env.example .env
```

Open `.env` in a text editor and set:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

The other settings are optional — see `.env.example` for descriptions.

## Step 7: Verify Setup

```bash
python main.py --check-setup
```

This will:
1. Test Google authentication (opens your browser on first run — authorize the app)
2. Verify each Google API is accessible
3. Verify the Anthropic API key works

You should see all `[OK]` results.

## Step 8: First Real Run

```bash
python main.py
```

If you have upcoming interviews on your calendar, the tool will find and process them.

---

## Troubleshooting

### "Access blocked: This app's request is invalid"
- Make sure you're signing in with the same Google account you added as a test user in Step 3

### "The caller does not have permission"
- Double-check that all 5 APIs are enabled in Step 2
- Make sure the scopes in Step 3 match exactly

### "credentials.json not found"
- Make sure you downloaded the JSON file in Step 4 and renamed it to `credentials.json`
- Make sure it's in the same directory as `main.py`, or update `GOOGLE_CREDENTIALS_PATH` in `.env`

### "Token has been expired or revoked"
- Delete `token.json` from the project directory and run again — it will re-authorize

### "Error 403: access_denied"
- Your app is in testing mode and your email isn't listed as a test user
- Go back to the OAuth consent screen and add your email under Test Users

### Need to re-authorize with different permissions?
- Delete `token.json` and run `python main.py --check-setup` again

---

## For Other Users

If you're sharing this tool with others, each person needs to either:

**Option A: Use your Google Cloud project** (simplest for a small group)
1. Add their email as a test user in your OAuth consent screen
2. Share your `credentials.json` with them (this is the OAuth client config, not your personal token)
3. They create their own `.env` with their own Anthropic key

**Option B: Create their own Google Cloud project** (fully independent)
1. Follow this entire guide from Step 1
2. They get their own `credentials.json` and Anthropic key
