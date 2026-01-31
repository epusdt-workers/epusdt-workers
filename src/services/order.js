import { Errno, ErrMsg } from '../utils/response.js';

const UsdtAmountPerIncrement = 0.0001;
const IncrementalMaximumNumber = 100;

export class OrderService {
  constructor(env) {
    this.env = env;
  }

  async getUsdtRate() {
    if (this.env.FORCED_USDT_RATE) {
      return parseFloat(this.env.FORCED_USDT_RATE);
    }

    try {
      const url = "https://binance-p2p-api.trustserver.cn/bapi/c2c/v2/friendly/c2c/adv/search";
      const payload = {
        "fiat": "CNY",
        "page": 1,
        "rows": 10,
        "transAmount": 0, // Request didn't specify amount, using 0 or generic
        "tradeType": "SELL",
        "asset": "USDT",
        "countries": [],
        "proMerchantAds": false,
        "shieldMerchantAds": false,
        "filterType": "all",
        "periods": [],
        "additionalKycVerifyFilter": 0,
        "publisherType": null,
        "payTypes": [],
        "classifies": ["mass", "profession"]
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (data && data.data && data.data.length > 0) {
        // Use the first ad's price
        return parseFloat(data.data[0].adv.price);
      }
    } catch (e) {
      console.error("Failed to fetch Binance rate:", e);
    }

    // Fallback or error? The original code assumes success or returns error.
    throw new Error("Failed to fetch USDT rate");
  }

  async createTransaction(req) {
    // 1. Check if order_id exists
    const existing = await this.env.DB.prepare('SELECT id FROM orders WHERE order_id = ?').bind(req.order_id).first();
    if (existing) {
      throw { code: Errno.ORDER_ALREADY_EXISTS, message: ErrMsg[Errno.ORDER_ALREADY_EXISTS] };
    }

    // 2. Get Rate & Calculate Base Amount
    let baseAmount;
    const currency = (req.currency || 'CNY').toUpperCase();

    if (currency === 'USD') {
      baseAmount = parseFloat(req.amount);
    } else {
      // CNY logic
      let rate;
      try {
        rate = await this.getUsdtRate();
      } catch (e) {
        throw { code: Errno.RATE_AMOUNT_ERR, message: ErrMsg[Errno.RATE_AMOUNT_ERR] };
      }
      // actual_amount = amount / rate
      // We keep 4 decimals for USDT
      baseAmount = Math.floor((req.amount / rate) * 10000) / 10000;
    }

    if (baseAmount < 0.01) { // Min amount check (assuming 0.01 USDT min)
      throw { code: Errno.PAY_AMOUNT_ERR, message: ErrMsg[Errno.PAY_AMOUNT_ERR] };
    }

    // 4. Find available wallet
    const wallets = await this.env.DB.prepare('SELECT token FROM wallet_address WHERE status = 1').all();
    if (!wallets.results || wallets.results.length === 0) {
      throw { code: Errno.NOT_AVAILABLE_WALLET_ADDRESS, message: ErrMsg[Errno.NOT_AVAILABLE_WALLET_ADDRESS] };
    }

    // 5. Find available slot (Token + Amount)
    // We need to find a (token, amount) pair that is NOT currently in a "Wait Pay" (1) status.
    // Logic:
    // Iterate increments (0 to 100)
    //   For each increment:
    //     Calculate candidateAmount = baseAmount + (i * 0.0001)
    //     For each wallet:
    //       Check if order exists with (token, candidateAmount, status=1)
    //       If NOT exists, USE THIS!

    let selectedToken = null;
    let finalAmount = 0;

    for (let i = 0; i < IncrementalMaximumNumber; i++) {
      const candidateAmount = parseFloat((baseAmount + (i * UsdtAmountPerIncrement)).toFixed(4));

      for (const wallet of wallets.results) {
        // Check availability
        // We use a simplified check here. In high concurrency, this might conflict.
        const pending = await this.env.DB.prepare(
          'SELECT id FROM orders WHERE token = ? AND actual_amount = ? AND status = 1'
        ).bind(wallet.token, candidateAmount).first();

        if (!pending) {
          selectedToken = wallet.token;
          finalAmount = candidateAmount;
          break;
        }
      }
      if (selectedToken) break;
    }

    if (!selectedToken) {
      throw { code: Errno.NOT_AVAILABLE_AMOUNT_ERR, message: ErrMsg[Errno.NOT_AVAILABLE_AMOUNT_ERR] };
    }

    // 6. Create Order
    const tradeId = this.generateTradeId();
    const now = Date.now();

    // We assume expiration time is in minutes
    const expirationTime = parseInt(this.env.ORDER_EXPIRATION_TIME || 10);
    const expirationTimestamp = now + (expirationTime * 60 * 1000);

    await this.env.DB.prepare(
      `INSERT INTO orders (
        trade_id, order_id, actual_amount, amount, token, currency, status, notify_url, redirect_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).bind(
      tradeId, req.order_id, finalAmount, req.amount, selectedToken, currency, req.notify_url, req.redirect_url, now, now
    ).run();

    return {
      trade_id: tradeId,
      order_id: req.order_id,
      amount: req.amount,
      actual_amount: finalAmount,
      token: selectedToken,
      expiration_time: expirationTimestamp, // Return Milliseconds as per Go implementation
      payment_url: `${this.env.APP_URI}/pay/checkout-counter/${tradeId}`
    };
  }

  generateTradeId() {
    // Simple unique ID generation
    return 'T' + Date.now() + Math.random().toString(36).substr(2, 6).toUpperCase();
  }
}
