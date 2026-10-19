# Ostra Runbook

## Deployment

### Database Migration
```bash
npx prisma migrate deploy
```

### Environment Variables
Copy the appropriate environment file:
- Local development: `cp .env.dev .env`
- Production: `cp .env.prod .env` (then fill in actual values)

### Build
```bash
npm run build
```

## Rollback

If a deployment causes issues:
1. Revert the code to the previous commit
2. Redeploy
3. If database schema changed, use `npx prisma migrate resolve --applied <migration-name>` to mark it as applied without running it

## Secret Rotation

### Twilio
1. Generate new auth token in Twilio console
2. Update `TWILIO_AUTH_TOKEN` in environment variables
3. Redeploy

### Anthropic
1. Generate new API key in Anthropic console
2. Update `ANTHROPIC_API_KEY` in environment variables
3. Redeploy

### Auth Secret
1. Generate new secret: `openssl rand -base64 32`
2. Update `AUTH_SECRET` in environment variables
3. Note: This will invalidate all existing sessions; users will need to log in again

## Troubleshooting

### WhatsApp Messages Not Sending

1. Check `WHATSAPP_MODE`:
   - `dry-run`: Messages are logged but not sent (for testing)
   - `sandbox`: Uses Twilio sandbox (for development)
   - `production`: Sends real messages (requires approved templates)

2. Check Twilio console for errors:
   - Look for failed message deliveries
   - Verify the phone number format (E.164: + country code + number)

3. Check scheduled message status in the booking detail page

### Calendar Sync Failing

1. Check the iCal URL is accessible
2. Check the last sync time and error message in the apartment page
3. Manually trigger sync from the apartment page

### AI Assistant Not Responding

1. Check `ANTHROPIC_API_KEY` is set
2. Check rate limits in booking detail page
3. Test with the "Test assistant" page

## Twilio Configuration

### WhatsApp Webhook Setup

1. In the Twilio console, go to Messaging > Settings > WhatsApp sandbox settings (or your WhatsApp sender number)
2. Set "When a message comes in" to: `${APP_URL}/api/webhooks/twilio`
3. Method: `POST`
4. Important: The URL must match exactly with `APP_URL` in your environment variables (no trailing slash)
5. The webhook validates the `X-Twilio-Signature` header using `TWILIO_AUTH_TOKEN`

### WhatsApp Sender Number

For production:
1. Apply for a WhatsApp Business Profile through Twilio
2. Get your sender number approved
3. Set `TWILIO_WHATSAPP_FROM` to your number (e.g., `whatsapp:+1234567890`)
4. Submit message templates for approval (pre-arrival, check-in, check-out, review request)

For development:
- Use the Twilio WhatsApp Sandbox
- Set `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886` (sandbox number)
- Set `WHATSAPP_MODE=sandbox`

### Status Callback

The delivery status webhook is at `${APP_URL}/api/webhooks/twilio-status`
- This is automatically configured in `sendWhatsApp` function
- Updates message delivery status in the database

## Email Notifications

To enable email notifications for escalations:
1. Sign up for Resend (https://resend.com)
2. Get your API key
3. Set `RESEND_API_KEY` in environment variables
4. Set `NOTIFY_FROM` to your sender email (e.g., `noreply@yourdomain.com`)
5. Without these, notifications run in dry-run mode and only log that one would be sent
