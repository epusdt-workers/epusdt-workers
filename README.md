# Epusdt in Cloudflare Workers

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/epusdt-workers/epusdt-workers)

A serverless implementation of [epusdt](https://github.com/assimon/epusdt) built on Cloudflare Workers, Hono, and D1 Database. This project serves as a USDT (TRC20) payment gateway that monitors blockchain transactions and processes orders automatically.

## Features

- **Serverless Architecture**: Deployed on Cloudflare Workers for high availability and low latency.
- **Database**: Uses Cloudflare D1 (SQLite) for data persistence.
- **USDT Payments**: Supports TRC20 USDT payment monitoring via Tronscan API.
- **Automated Monitoring**: Includes a scheduled cron job to check for new transactions.
- **Telegram Notifications**: Sends payment notifications to a configured Telegram bot.
- **Secure**: Signature verification for API requests.
- **Dual Currency**: Adds `currency` parameter and accepts both `usd` and `cny`. if usd provided, no exchange required.
- **Exchange Rate**: Respects realtime USDT exchange-rate from Binance P2P if parameter `currency` is `cny` or null.

## Project Structure

- `src/index.js`: Main entry point, defines routes and scheduled tasks.
- `src/controllers/`: Request handlers for orders and payments.
- `src/services/`: Business logic, including payment verification with Tronscan API.
- `src/utils/`: Utility functions (cryptography, response formatting, Telegram integration).
- `schema.sql`: Database schema for initializing Cloudflare D1.
- `wrangler.toml.example`: Configuration template for Cloudflare Workers.

## Prerequisites

- [Node.js](https://nodejs.org/) (v16+)
- [Cloudflare Account](https://dash.cloudflare.com/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed globally or locally.

## Installation & Deployment

### 1. Clone the Repository

```bash
git clone git@github.com:xiaohuilam/epusdt-workers.git
cd epusdt-workers
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Cloudflare Login

If you haven't already, login to your Cloudflare account via Wrangler:

```bash
npx wrangler login
```

### 4. Database Initialization

Create a new D1 database:

```bash
npx wrangler d1 create epusdt-workers
```

Copy the `database_id` from the output.

Initialize the database schema:

```bash
npx wrangler d1 execute epusdt-workers --file=./schema.sql
```

execute SQL at your D1 dashboard:
```
INSERT INTO wallet_address (token, status, created_at, updated_at) 
VALUES ('Replace-this-with-your-own-TRON-wallet-address', 1, 1706688000000, 1706688000000);
```

Set your EPUSDT API AUTH Token
```bash
wrangler secret put API_AUTH_TOKEN
```

Set your Telegram Bot token
```bash
wrangler secret put TG_BOT_TOKEN
```

### 5. Configuration

Copy the example configuration file:

```bash
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml` and update the following fields:

- **[[d1_databases]]**:
  - `database_id`: Paste the ID you got from step 4.
- **[vars]**:
  - `APP_URI`: Your worker's URL (e.g., `https://epusdt-worker.your-subdomain.workers.dev`).
  - `TG_BOT_TOKEN`: Your Telegram Bot Token.
  - `TG_MANAGE`: Your Telegram Chat Master-user-ID to receive notifications.
  - `API_AUTH_TOKEN`: Secret token for API authentication.
  - `ORDER_EXPIRATION_TIME`: Order expiration time (in minutes, default: 1440).

### 6. Deployment

Deploy the worker to Cloudflare:

```bash
npx wrangler deploy
```

## API Endpoints

## Authentication

Authentication is performed via signature verification. The `signature` parameter must be included in the request body for protected endpoints (e.g., creating a transaction).

**Signature Generation Algorithm:**

1.  Filter out null, undefined, and empty values, and the `signature` field itself.
2.  Sort the keys alphabetically (ASCII).
3.  Concatenate keys and values in the format `key=value` joined by `&` (e.g., `amount=100&notify_url=...`).
4.  Append the `API_AUTH_TOKEN` (configured in `wrangler.toml`) to the end of the string.
5.  Calculate the MD5 hash of the final string.

## API Endpoints

All API responses follow this standard format:

```json
{
  "status_code": 200,
  "message": "success",
  "data": { ... },
  "request_id": "..."
}
```

### 1. Create Transaction

Create a new payment order.

- **URL**: `/api/v1/order/create-transaction`
- **Method**: `POST`
- **Content-Type**: `application/json`

**Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `order_id` | string | Yes | Unique order ID from your system. |
| `amount` | number | Yes | Payment amount. |
| `notify_url` | string | Yes | Asynchronous callback URL for payment notification. |
| `redirect_url` | string | No | URL to redirect the user after payment. |
| `currency` | string | No | Fiat currency (e.g., `CNY`, `USD`). Default: `CNY`. |
| `signature` | string | Yes | MD5 signature for authentication. |

**Response Data:**

```json
{
  "trade_id": "T170...",
  "order_id": "20240101001",
  "amount": 100,
  "actual_amount": 13.5,
  "token": "TR7...",
  "expiration_time": 1706688000000,
  "payment_url": "https://.../pay/checkout-counter/T170..."
}
```

### 2. Get Checkout Info

Retrieve checkout information for an order (usually for the frontend payment page).

- **URL**: `/pay/checkout-counter/:trade_id`
- **Method**: `GET`

**Response Data:**

```json
{
  "trade_id": "T170...",
  "actual_amount": 13.5,
  "token": "TR7...",
  "expiration_time": 1706688000000,
  "redirect_url": "https://your-site.com/return"
}
```

### 3. Check Order Status

Check the status of an order.

- **URL**: `/pay/check-status/:trade_id`
- **Method**: `GET`

**Response Data:**

```json
{
  "status": 1,
  "trade_id": "T170...",
  "actual_amount": 13.5
}
```

**Status Codes:**
- `1`: Wait for payment
- `2`: Success (Paid)
- `3`: Expired


### 5. Webhook Callback

When a payment is successfully confirmed, the system will send a POST request to the `notify_url` provided when creating the transaction.

- **Method**: `POST`
- **Content-Type**: `application/json`

**Request Body:**

```json
{
  "trade_id": "T170...",
  "order_id": "20240101001",
  "amount": 100,
  "actual_amount": 13.5,
  "token": "TR7...",
  "block_transaction_id": "00000000000000000...",
  "status": 2,
  "signature": "e10adc3949ba59abbe56e057f20f883e"
}
```

**Parameters Description:**

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `trade_id` | string | Unique trade ID generated by epusdt-worker. |
| `order_id` | string | Your original order ID. |
| `amount` | number | The original fiat amount requested. |
| `actual_amount` | number | The actual USDT amount received. |
| `token` | string | The wallet address that received the payment. |
| `block_transaction_id` | string | The blockchain transaction hash (TXID). |
| `status` | number | Order status (`2` indicates success). |
| `signature` | string | Signature for verification (same algorithm as API). |

**Response Requirement:**
Your server should respond with the string `success` or `ok` (case-insensitive) to acknowledge receipt.

## Scheduled Tasks

[wrangler will create a cron trigger automatically](https://developers.cloudflare.com/workers/wrangler/commands/#cron-triggers) The worker includes a cron trigger (`* * * * *`) that runs every minute to check the blockchain for new transactions corresponding to pending orders.

## License

MIT
