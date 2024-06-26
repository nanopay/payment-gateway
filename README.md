# Nano Payment Gateway

Fast and scalable payment gateway for Nano cryptocurrency

## Summary:
- Create and read invoices through REST API
- Detect payment transactions through Nano node websocket
- Receive payment amount and send to merchant account through Nano node RPC
- Notify customers through websocket
- Notify merchants through webhook

## Technologies

- [Nano](https://nano.org): Instant, descentralized, zero fee cryptocurrency.
- [Cloudflare Workers](https://workers.cloudflare.com/): Fast, cheap and scalable serverless functions on the EDGE
- [Cloudflare Queues](https://developers.cloudflare.com/queues/): Send and receive messages with guaranteed delivery inside Cloudflare Workers.
- [Supabase](https://supabase.com/): Open source Firebase alternative with a Postgres database accessible through REST API

## Requirements

- Requires a [Cloudflare Workers](https://workers.cloudflare.com/) account with queue support
- Requires a Supabase account with a `transactions` table [TODO: Add table model]
- Requires npm installed, wrangler logged and curl for testing

## Configure

1. Install packages dependencies:
```bash
npm install
```

2. Create the queue
```bash
wrangler queues create payment-queue
```

3. Publish to Cloudflare. It will generate an url for your gateway:
```bash
wangler publish
```

4. Add environments:
```bash
# A secure authentication token
wrangler secret put AUTH_TOKEN

# Your supabase credentials
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SECRET_KEY

# A Nano node websocket url
wrangler secret put NANO_WEBSOCKET_URL

# Your Pusher crendentials
wrangler secret put PUSHER_APP_ID
wrangler secret put PUSHER_KEY
wrangler secret put PUSHER_SECRET
```

## Running locally
```bash
npm start
```

## Deploy

```bash
wrangler deploy
```

### Using

5. Add an account to the queue:
- Replace the Bearer with your token
- Replace the account
- expiresAt can be an ISO date or an unix timestamp (in ms)
```bash
curl --request POST \
  --url https://payment-gateway.example.workers.dev/ \
  --header 'Authorization: Bearer my-secure-auth-token-here' \
  --header 'Content-Type: application/json' \
  --data '{
        "invoiceId": 3443,
        "to": "nano_1ejctmay4x59368tnbgzsrj7tmzru8ghe6af4rewxtddejsu6d78esb9aar",
        "expiresAt": "2023-02-27T03:46:53.374Z"
    }'
```

Success response [200]:
```js
{
	"message": "Sent to queue"
}
```

6. Send a small amount of nano (at least 0.000001 XNO) to the address before expiring and check your supabase table "transactions".


Important! Even if the initial request succeeds, the gateway may fail if you don't configure your websocket node or subbase correctly. So check your Cloudflare Workers logs.