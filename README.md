# Nano Payment Worker

This project is responsible for detecting payment transactions for merchants using Cloudflare Workers with Queues

### Summary:
1. Poducer receives an http request to listen to a given Nano address via HTTP and sends it to the workers.
2. Worker connects with the websocket of a Nano node and waits for a confirmation of sending to the account until the payment expires.
3. Worker saves the payment in the database (Supabase)

- Retries: If the connection to the websocket or the writing to the database fails, up to 3 retries are performed before forwarding to the dead queue.

### Running

- Requires a [Cloudflare Workers](https://workers.cloudflare.com/) account with queue support

- Requires a Supabase account with a `transactions` table [TODO: Add table model]
  
- Requires npm installed, wrangler logged and curl for testing

1. Install packages dependencies:
```bash
npm i
```

2. Create the queue
```bash
wrangler queues create payment-queue
```

3. Publish to Cloudflare. It will generate an url for your worker:
```bash
wangler publish
```

4. Add environments:
```bash
# A secure authentication token
wrangler secret put AUTH_TOKEN

# Your supabase credentials
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_KEY

# A Nano node websocket url
wrangler secret put NANO_WEBSOCKET_URL

# Your Pusher crendentials
wrangler secret put PUSHER_APP_ID
wrangler secret put PUSHER_KEY
wrangler secret put PUSHER_SECRET
```

5. Add an account to the queue:
- Replace the Bearer with your token
- Replace the account
- expiresAt can be an ISO date or an unix timestamp (in ms)
```bash
curl --request POST \
  --url https://payment-worker.example.workers.dev/ \
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


Important! Even if the initial request succeeds, the worker may fail if you don't configure your websocket node or subbase correctly. So check your Cloudflare Workers logs.