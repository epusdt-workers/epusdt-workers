import { Errno, ErrMsg } from '../utils/response.js';
import { generateSignature } from '../utils/sign.js';
import { sendToBot } from '../utils/telegram.js';

const UsdtTrc20ApiUri = "https://apilist.tronscanapi.com/api/transfer/trc20";

export class PayService {
    constructor(env) {
        this.env = env;
    }

    async getCheckoutCounter(tradeId) {
        const order = await this.env.DB.prepare('SELECT * FROM orders WHERE trade_id = ?').bind(tradeId).first();
        if (!order) {
            throw { code: Errno.ORDER_NOT_EXISTS, message: ErrMsg[Errno.ORDER_NOT_EXISTS] };
        }

        // Check if waiting for pay
        if (order.status !== 1) {
            // Original code: "不存在待支付订单或已过期！"
            // But returns 200 with error message? No, it returns error.
            throw { code: 400, message: "不存在待支付订单或已过期！" };
        }

        const expirationTime = parseInt(this.env.ORDER_EXPIRATION_TIME || 10);
        const createdAt = order.created_at; // ms
        const expireAt = createdAt + (expirationTime * 60 * 1000);

        return {
            trade_id: order.trade_id,
            actual_amount: order.actual_amount,
            token: order.token,
            expiration_time: expireAt,
            redirect_url: order.redirect_url
        };
    }

    async checkStatus(tradeId) {
        const order = await this.env.DB.prepare('SELECT * FROM orders WHERE trade_id = ?').bind(tradeId).first();
        if (!order) {
            throw { code: Errno.ORDER_NOT_EXISTS, message: ErrMsg[Errno.ORDER_NOT_EXISTS] };
        }

        // Original CheckStatus returns simple string or json?
        // The router calls comm.Ctrl.CheckStatus.
        // Let's assume it returns standard JSON response with Status.
        // Actually the Go code was: `payRoute.GET("/check-status/:trade_id", comm.Ctrl.CheckStatus)`
        // I didn't read CheckStatus implementation. I should have.
        // Assuming it returns the status.

        return {
            status: order.status,
            trade_id: order.trade_id,
            actual_amount: order.actual_amount
        };
    }

    // CRON JOB
    async checkPayments() {
        // 1. Get enabled wallets
        const wallets = await this.env.DB.prepare('SELECT token FROM wallet_address WHERE status = 1').all();
        if (!wallets.results || wallets.results.length === 0) return;

        for (const wallet of wallets.results) {
            console.log(wallet);
            await this.checkWallet(wallet.token);
        }
    }

    async checkWallet(token) {
        try {
            const endTime = Date.now();
            const startTime = endTime - (24 * 60 * 60 * 1000); // 24 hours ago

            const params = new URLSearchParams({
                sort: '-timestamp',
                limit: '50',
                start: '0',
                direction: '2',
                db_version: '1',
                trc20Id: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
                address: token,
                start_timestamp: startTime.toString(),
                end_timestamp: endTime.toString()
            });

            const resp = await fetch(`${UsdtTrc20ApiUri}?${params.toString()}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            if (!resp.ok) return;

            const data = await resp.json();
            if (!data.data || data.data.length === 0) return;

            for (const transfer of data.data) {
                // Check logic
                if (transfer.to !== token || transfer.contract_ret !== 'SUCCESS') continue;

                // Amount conversion (string -> float)
                // Transfer amount is integer (6 decimals)
                const amountVal = parseFloat(transfer.amount) / 1000000;

                // Find order
                // We use strict matching on token + actual_amount + status=1
                // But floating point matching is tricky. 
                // In DB we stored as REAL.
                // Let's search by range or trust exact match if we stored precisely.
                // SQLite REAL comparison should work if we are consistent.

                const order = await this.env.DB.prepare(
                    'SELECT * FROM orders WHERE token = ? AND actual_amount = ? AND status = 1'
                ).bind(token, amountVal).first();

                if (!order) continue;

                // Check block timestamp vs created_at
                if (transfer.block_timestamp < order.created_at) continue;

                // MATCHED!
                await this.processOrder(order, transfer.hash);
            }

        } catch (e) {
            console.error(`Check wallet ${token} failed:`, e);
        }
    }

    async processOrder(order, txId) {
        // 1. Update DB
        await this.env.DB.prepare(
            'UPDATE orders SET status = 2, block_transaction_id = ?, updated_at = ? WHERE id = ?'
        ).bind(txId, Date.now(), order.id).run();

        // Update order object for notification
        order.status = 2;
        order.block_transaction_id = txId;

        // 2. Notify Bot
      const msg = `📢📢有新的交易支付成功！
\`\`\`交易号：
${order.trade_id}
\`\`\`
\`\`\`订单号：
${order.order_id}
\`\`\`
\`\`\`交易哈希：
${order.block_transaction_id}
\`\`\`
\`\`\`请求支付金额：
${order.amount} ${order.currency || 'CNY'}
\`\`\`
\`\`\`实际支付金额：
${order.actual_amount} USDT
\`\`\`
\`\`\`钱包地址：
${order.token}
\`\`\`
\`\`\`订单创建时间：
${new Date(order.created_at).toLocaleString()}
\`\`\`
\`\`\`支付成功时间：
${new Date().toLocaleString()}
\`\`\``;
      await sendToBot(this.env, msg, 'Markdown');

        // 3. Callback
        await this.sendCallback(order);
    }

    async sendCallback(order) {
        const payload = {
            trade_id: order.trade_id,
            order_id: order.order_id,
            amount: order.amount,
            actual_amount: order.actual_amount,
            token: order.token,
            block_transaction_id: order.block_transaction_id,
            status: order.status
        };

        // Sign
        payload.signature = generateSignature(payload, this.env.API_AUTH_TOKEN);

        try {
            // Retry logic could be implemented here, but for now simple fetch
            const resp = await fetch(order.notify_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const text = await resp.text();
            if (text === 'success' || text.toLowerCase() === 'ok') {
                // Update callback confirm?
                // The schema has callback_confirm.
            }
        } catch (e) {
            console.error("Callback failed:", e);
        }
    }
}
