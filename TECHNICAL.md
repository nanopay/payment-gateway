# Technical Documentation — Nano Payment Gateway

## Overview

A Cloudflare Workers payment gateway for the [Nano](https://nano.org) cryptocurrency. It creates invoices with unique payment addresses, detects incoming transactions in real-time via WebSocket, receives funds, forwards them to the merchant's address, persists records, and delivers webhook notifications — all at the edge.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Worker                            │
│                                                                     │
│  ┌──────────┐     ┌─────────────────────────────────────────────┐  │
│  │  Router   │────▶│ Invoice API (REST)                         │  │
│  │ (fetch)   │     │  POST /invoices      — Create invoice      │  │
│  └──────────┘     │  GET  /invoices/:id   — Read invoice        │  │
│                    │  GET  /invoices/:id/payments — WS stream    │  │
│                    └───────────┬─────────────────────────────────┘  │
│                                │                                    │
│  ┌─────────────────────────────▼────────────────────────────────┐  │
│  │                     Queue System                              │  │
│  │  payment-listener → payment-write → webhook-delivery          │  │
│  │                   → payment-receiver → payment-sender         │  │
│  │                                    → webhook-delivery-write   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐               │
│  │  PaymentListener DO  │  │  PaymentNotifier DO  │               │
│  │  (state + WS conn)   │  │  (WS broadcast)      │               │
│  └──────────────────────┘  └──────────────────────┘               │
└─────────────────────────────────────────────────────────────────────┘
           │              │               │
           ▼              ▼               ▼
     Nano Network      Supabase       KV Store
     (WS + RPC)        (Postgres)     (Wallet state)
```

### Stack

| Layer                 | Technology                                      |
| --------------------- | ----------------------------------------------- |
| Compute               | Cloudflare Workers (edge serverless)            |
| Async messaging       | Cloudflare Queues (guaranteed delivery)         |
| Stateful coordination | Cloudflare Durable Objects                      |
| Key-value cache       | Cloudflare KV (`WALLET` namespace)              |
| Database              | Supabase (Postgres via REST)                    |
| Blockchain            | Nano (WebSocket for events, RPC for operations) |

## Data Model (Supabase)

```
services        1──N  invoices       1──N  payments
   │                     │
   └──N  webhooks        └──N  webhooks_deliveries
```

**Key tables:**

| Table                 | Purpose                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| `services`            | Merchant accounts (name, slug, contact, counters)                                 |
| `invoices`            | Payment requests (price, pay_address, status, expiry, metadata)                   |
| `payments`            | Individual Nano transactions received for an invoice                              |
| `webhooks`            | Registered callback URLs per service, with event filters and optional HMAC secret |
| `webhooks_deliveries` | Audit log of every webhook delivery attempt (request/response captured)           |
| `api_keys`            | Service authentication keys                                                       |

**Invoice statuses:** `pending` → `paid` | `expired` | `error`

## Core Flow

### 1. Invoice Creation

```
Client ──POST /invoices──▶ AuthMiddleware ──▶ InvoiceService.create()
```

1. Request validated with Zod schema (title, price, recipient_address, service_id, etc.)
2. A random HD wallet index (1000–4294967295) is chosen and a unique Nano address is derived from `HOT_WALLET_SEED` using the `nanocurrency` library
3. Invoice stored in Supabase with 10-minute default expiration
4. A message is enqueued to `payment-listener-queue` containing the invoice, service, and webhooks
5. Response returns `{ id, pay_address, expires_at }` for the client to display

### 2. Payment Listening (PaymentListener Durable Object)

The `PaymentListener` is a singleton Durable Object that holds all active invoice subscriptions.

On receiving a queue message:

1. Stores invoice in an in-memory `pendingInvoices` map
2. Opens a WebSocket connection to the Nano node (if not already connected)
3. Subscribes to the invoice's `pay_address` for `confirmation` events (send blocks only)
4. Starts the `PaymentNotifier` Durable Object for the invoice
5. Sets a Durable Object alarm for the nearest invoice expiration

**Alarm handling:** Periodically fires to expire invoices that passed their `expires_at`. Expired invoices are removed and their `PaymentNotifier` is stopped with close code `4001 EXPIRED`. When no invoices remain, the WebSocket is closed.

### 3. Payment Detection & Processing

When a Nano send block targeting a subscribed address is confirmed:

```
Nano Node ──WS confirmation──▶ PaymentListener.onPayment()
```

1. Payment amount validated (minimum 0.00001 XNO)
2. Payment stored in the invoice's local payment list
3. Three parallel actions triggered:

| Action                        | Queue                    | Worker                     |
| ----------------------------- | ------------------------ | -------------------------- |
| Persist payment to DB         | `payment-write-queue`    | `paymentWrite()`           |
| Notify WebSocket clients      | _(direct DO call)_       | `PaymentNotifier.notify()` |
| Receive funds (if fully paid) | `payment-receiver-queue` | `paymentReceiver()`        |

**Overpayment protection:** If an invoice accumulates >10 payments, it is rejected and the `PaymentNotifier` closes with code `4002 TOO_MANY_PAYMENTS`.

### 4. Fund Reception & Forwarding

When total received ≥ invoice price:

```
payment-receiver-queue ──▶ paymentReceiver() ──▶ payment-sender-queue ──▶ paymentSender()
```

**Receive step (`paymentReceiver`):**

- Derives the private key for the invoice's HD index
- Initializes `NanoWallet` (loads frontier & balance from KV)
- Creates and publishes a Nano receive block for each payment (with PoW at difficulty `fffffe0000000000`)

**Send step (`paymentSender`):**

- Same wallet initialization
- Calls `sendAll(recipient_address)` — creates a send block transferring the entire balance to the merchant (PoW difficulty `fffffff800000000`)

Wallet state (frontier hash, balance) is persisted in the `WALLET` KV namespace between operations.

### 5. Webhook Delivery

After payment is written to the database:

```
payment-write-queue ──▶ paymentWrite()
    for each webhook with "invoice.paid" event:
        ──▶ webhook-delivery-queue ──▶ webhookDelivery()
            ──▶ webhook-delivery-write-queue ──▶ webhookDeliveryWrite()
```

**Webhook request format:**

```json
POST <webhook.url>
Content-Type: application/json
X-Signature: <HMAC-SHA256 hex if secret configured>

{
  "type": "invoice.paid",
  "invoice": { ... },
  "service": { ... },
  "payment": { ... }
}
```

- 15-second timeout per delivery
- Full request/response captured and stored in `webhooks_deliveries` for auditing
- Retry support is implemented but currently disabled (`WEBHOOK_RETRY = false`)

### 6. Real-Time Client Notifications (PaymentNotifier Durable Object)

```
Client ──GET /invoices/:id/payments (Upgrade: websocket)──▶ PaymentNotifier
```

One `PaymentNotifier` instance per invoice. It:

1. Accepts WebSocket upgrade requests (max 10 concurrent sessions)
2. Waits for a `start()` signal from the `PaymentListener` (10s timeout)
3. Sends the last 10 stored payments as initial history
4. Broadcasts new `PaymentNotification` events in real-time as they arrive
5. Responds to `ping` with `pong` for keep-alive
6. Closes with semantic codes: `1000` (PAID), `4001` (EXPIRED), `4002` (TOO_MANY_PAYMENTS)

## Queue Configuration

| Queue                          | Worker                   | Max Retries | Dead Letter Queue |
| ------------------------------ | ------------------------ | ----------- | ----------------- |
| `payment-listener-queue`       | PaymentListener DO       | 3           | Yes               |
| `payment-write-queue`          | `paymentWrite()`         | 3           | Yes               |
| `payment-receiver-queue`       | `paymentReceiver()`      | 0           | Yes               |
| `payment-sender-queue`         | `paymentSender()`        | 0           | Yes               |
| `webhook-delivery-queue`       | `webhookDelivery()`      | 3           | Yes               |
| `webhook-delivery-write-queue` | `webhookDeliveryWrite()` | 3           | Yes               |

All queues: `max_batch_size = 1`, `max_batch_timeout = 5s`.

Receiver and sender have 0 retries to prevent duplicate Nano block publishing.

## Authentication

Protected routes use Bearer token authentication:

```
Authorization: Bearer <AUTH_TOKEN>
```

Validated by `authMiddleware` against the `AUTH_TOKEN` environment secret. Returns `401 Unauthorized` on mismatch.

## Nano Wallet Mechanics

### Address Derivation

Each invoice gets a unique Nano address derived deterministically:

```
HOT_WALLET_SEED (64 hex) + index (random uint32) → private key → public key → nano_ address
```

This allows the gateway to reconstruct any invoice's private key on demand without storing it.

### NanoWallet State

Persisted in KV under keys `frontier` and `balance` (scoped by wallet address):

- **frontier**: Hash of the last block on the account chain — needed to build the next block
- **balance**: Current account balance in raw units

### Block Types

| Operation             | Block Type | PoW Difficulty     |
| --------------------- | ---------- | ------------------ |
| Accept incoming funds | Receive    | `fffffe0000000000` |
| Forward to merchant   | Send       | `fffffff800000000` |

### RPC Failover

`NanoRPC` accepts comma-separated URL lists for both standard RPC and PoW worker nodes. On failure, it automatically retries against the next URL in the list.

## Environment Variables

| Variable              | Description                                       |
| --------------------- | ------------------------------------------------- |
| `AUTH_TOKEN`          | Bearer token for API authentication               |
| `SUPABASE_URL`        | Supabase project REST API URL                     |
| `SUPABASE_SECRET_KEY` | Supabase service role key                         |
| `HOT_WALLET_SEED`     | 64-character hex seed for HD wallet derivation    |
| `NANO_WEBSOCKET_URL`  | Nano node WebSocket URL for payment confirmations |
| `REPRESENTATIVE`      | Nano representative account for block signing     |
| `RPC_URLS`            | Comma-separated Nano node RPC endpoints           |
| `WORKER_URLS`         | Comma-separated PoW-capable RPC endpoints         |

## Key Constants

| Constant                                      | Value            |
| --------------------------------------------- | ---------------- |
| `INVOICE_EXPIRATION`                          | 10 minutes       |
| `INVOICE_MIN_AMOUNT`                          | 0.00001 XNO      |
| `WEBHOOK_DELIVERY_TIMEOUT`                    | 15 seconds       |
| `MAX_WEBSOCKET_SESSIONS_PER_PAYMENT_NOTIFIER` | 10               |
| `MAX_PAYMENTS_PER_INVOICE`                    | 10               |
| `WEBHOOK_RETRY`                               | false (disabled) |

## Validation Rules (Invoice Creation)

| Field               | Constraint                        |
| ------------------- | --------------------------------- |
| `title`             | string, 2–40 characters           |
| `description`       | optional, ≤512 characters         |
| `price`             | number, 0.00001–1,000,000 XNO     |
| `recipient_address` | must match `nano_` address format |
| `metadata`          | optional JSON object              |
| `redirect_url`      | optional valid URL                |
| `service_id`        | required string                   |

## Error Handling

- Queue workers catch errors and log them; `PaymentTimeout` errors are handled as a special case
- Nano RPC calls use configurable timeouts (default 30s) and URL failover
- WebSocket connections include 15-second keep-alive pings
- Durable Object alarms handle invoice expiration cleanup
- HTTP responses use structured error classes: `BadRequestException`, `NotFoundException`, `UnauthorizedException`, `ServerException`
