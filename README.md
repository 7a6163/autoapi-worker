# AutoApi E5 - Cloudflare Worker Edition

E5 auto-renewal application ported to Cloudflare Workers platform.

## Features

- ✅ Generate Excel files in memory using ExcelJS npm package
- ✅ Store tokens using KV Storage (replaces .env file)
- ✅ Support for Cron Triggers for scheduled execution
- ✅ All API functionalities fully ported

## Installation

### 1. Install Dependencies

```bash
cd worker
npm install
```

### 2. Setup KV Namespace

```bash
# Create KV namespace
wrangler kv:namespace create "E5_CONFIG"

# Update the returned ID in wrangler.toml's id field
```

### 3. Set Environment Variables

Set in Cloudflare Dashboard:
- `CLIENT_ID`: Azure Application ID
- `CLIENT_SECRET`: Azure Application Secret
- `TELEGRAM_BOT_TOKEN`: Telegram bot token (optional)
- `CHAT_ID`: Telegram chat ID (optional)

### 4. Initialize Token

```bash
# Write initial refresh_token to KV
wrangler kv:key put --namespace-id=YOUR_NAMESPACE_ID "MS_TOKEN" "YOUR_REFRESH_TOKEN"
```

### 5. Deploy

```bash
npm run deploy
```

## Test Endpoints

After deployment, manually trigger via these endpoints:
- `/update-token` - Update token
- `/run-read` - Execute read APIs
- `/run-write` - Execute write APIs

## Cron Schedule

Configured schedule (UTC time):
- Token update: Monday, Thursday, Saturday at 10:10
- Read APIs: Every 6 hours on weekdays
- Write APIs: Daily at 23:12

## Technical Differences

### Original (Python + Docker)
- Uses xlsxwriter to generate Excel
- Stores token in .env file
- Uses crontab for scheduling

### Worker Edition (JavaScript)
- Uses ExcelJS npm package
- Stores token in KV Storage
- Uses Cron Triggers

## Limitations

- Workers have 30-second execution time limit
- Cannot use time.sleep() delays
- All file operations performed in memory

## Monitoring

View logs using Wrangler:
```bash
npm run tail
```