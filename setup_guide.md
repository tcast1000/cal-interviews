# Python Setup Guide

Step-by-step walkthrough for setting up the Python CLI version.

**Time required:** ~10 minutes

---

## 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with the Google account that has your calendar and email
3. Click the project dropdown at the top, then **New Project**
4. Name it `interview-prep` (the name doesn't matter), click **Create**
5. Make sure the new project is selected in the dropdown

## 2. Enable APIs

Enable these 5 APIs in [APIs & Services > Library](https://console.cloud.google.com/apis/library):

- [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
- [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
- [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)

Click each link, then click **Enable**.

## 3. Configure the OAuth Consent Screen

1. Go to [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
2. Select **External**, click **Create**
3. Fill in:
   - **App name:** `Interview Prep`
   - **User support email:** your email
   - **Developer contact:** your email
4. Click **Save and Continue**
5. On the Scopes page, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/spreadsheets`
   - `https://www.googleapis.com/auth/documents`
   - `https://www.googleapis.com/auth/drive.file`
6. Click **Update**, then **Save and Continue**
7. On Test Users, click **Add Users**, add your email, then **Save and Continue**

> While the app is in "Testing" mode, only test users can authorize. This is fine for personal use.

## 4. Create OAuth Credentials

1. Go to [Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **+ Create Credentials > OAuth client ID**
3. Application type: **Desktop app**
4. Name: `Interview Prep CLI`
5. Click **Create**, then **Download JSON**
6. Rename the file to `credentials.json` and move it to the project directory

## 5. Get an Anthropic API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create a new API key under **API Keys**
3. Copy the key (starts with `sk-ant-`)

## 6. Configure

```bash
cp .env.example .env
```

Open `.env` and set `ANTHROPIC_API_KEY` to your key. All other settings are optional — see [.env.example](.env.example) for descriptions.

## 7. Verify

```bash
python main.py --check-setup
```

On first run, your browser opens for Google authorization. Approve the permissions, then you should see all `[OK]` results.

## 8. Run

```bash
python main.py
```

If you have upcoming interviews on your calendar, the tool will find and process them.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Access blocked: This app's request is invalid" | Sign in with the same account you added as a test user in step 3 |
| "The caller does not have permission" | Verify all 5 APIs are enabled (step 2) and scopes match (step 3) |
| "credentials.json not found" | Download the JSON from step 4 and place it in the project directory |
| "Token has been expired or revoked" | Delete `token.json` and run again to re-authorize |
| "Error 403: access_denied" | Add your email as a test user in the OAuth consent screen |
| Need to change permissions | Delete `token.json` and run `python main.py --check-setup` |

---

## Sharing With Others

**Option A: Share your Google Cloud project** — Add their email as a test user and share `credentials.json`. They create their own `.env`.

**Option B: Fully independent** — They follow this guide from step 1 with their own Google Cloud project and Anthropic key.
