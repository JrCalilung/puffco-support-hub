# Puffco Support Hub — Zendesk App

Private Zendesk sidebar app for the Puffco Customer Support team.

## Modules

| Tab | Owner | Description |
|---|---|---|
| Inquiries | IT (JR) | Create, edit, close, and delete inquiry custom object records linked to the ticket |
| Registrations | Brent | Look up and manually register products via Supabase |
| Return Label | IT (JR) | Generate USPS Priority Mail POUR return labels via Stamps.com SERA API |
| Media Upload | IT (JR) | Generate secure S3 upload links for customer photos/videos |

## Repository Structure

```
puffco-support-hub/
├── zendesk-app/          ← App source (this is what gets zipped for Zendesk)
│   ├── manifest.json
│   ├── translations/
│   └── assets/
│       ├── iframe.html   ← App shell + tab layout
│       ├── main.js       ← Tab router + Inquiries module
│       ├── main.css      ← All styles
│       ├── modules/
│       │   ├── inquiries.js       ← Inquiry tracker logic
│       │   ├── registrations.js   ← Product registration (Brent)
│       │   ├── returnlabel.js     ← Return label generation
│       │   └── mediaupload.js     ← Media upload link generation
│       └── *.png / *.svg         ← App icons
├── docs/
│   └── runbook.docx      ← Operations runbook
└── README.md
```

## Building the Zendesk ZIP

From the repo root:

```bash
cd zendesk-app
zip -r ../Puffco_Support_Hub_v1.x.zip . -x "*.DS_Store"
```

Upload the ZIP to Zendesk Admin Center → Apps → Upload private app.

## Required App Parameters (set in Zendesk on install)

| Parameter | Description |
|---|---|
| `AWS_API_BASE_URL` | `https://pna3okela3.execute-api.us-west-2.amazonaws.com` |
| `APP_SHARED_SECRET` | From AWS Secrets Manager: `zendesk_app_shared_secret` |
| `productRegistrationApiToken` | Supabase API token for registrations module |

## After Reinstalling — Update CORS

The API Gateway CORS allowlist must include the new app's zdusercontent.com origin.
Get the new origin from the installed app URL, then run:

```bash
aws apigatewayv2 update-api \
  --api-id pna3okela3 \
  --region us-west-2 \
  --cors-configuration AllowOrigins="https://<NEW_ORIGIN>.apps.zdusercontent.com,https://puffco.zendesk.com,https://uploads.cssupport.puffco.com"
```

## Secrets

All secrets live in **AWS Secrets Manager**. Never commit credentials to this repo.

| Secret Name | Used By |
|---|---|
| `stamps_credentials` | Return label Lambda (OAuth tokens) |
| `zendesk_app_shared_secret` | App shell HMAC |
| `formstack_hmac_secret` | Formstack webhook auth |
| `zendesk_api_token` | Zendesk API calls |

## Contacts

| Area | Owner |
|---|---|
| IT / Infrastructure / Return Label / Media Upload | JR Calilung |
| Registrations module / Supabase | Brent |
| Stamps.com SERA support | Vin (Technical Escalations) |
