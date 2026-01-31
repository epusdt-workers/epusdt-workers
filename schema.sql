DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL UNIQUE,
    block_transaction_id TEXT,
    actual_amount REAL NOT NULL,
    amount REAL NOT NULL,
    token TEXT NOT NULL,
    currency TEXT DEFAULT 'CNY',
    status INTEGER DEFAULT 1 NOT NULL, -- 1: Wait, 2: Success, 3: Expired
    notify_url TEXT NOT NULL,
    redirect_url TEXT,
    callback_num INTEGER DEFAULT 0,
    callback_confirm INTEGER DEFAULT 2, -- 1: Yes, 2: No
    created_at INTEGER, -- Timestamp
    updated_at INTEGER,
    deleted_at INTEGER
);

CREATE INDEX idx_orders_block_transaction_id ON orders(block_transaction_id);
CREATE INDEX idx_orders_trade_id ON orders(trade_id);

DROP TABLE IF EXISTS wallet_address;
CREATE TABLE wallet_address (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    status INTEGER DEFAULT 1 NOT NULL, -- 1: Enable, 2: Disable
    created_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
);

CREATE INDEX idx_wallet_address_token ON wallet_address(token);

-- INSERT INTO wallet_address (token, status, created_at, updated_at) 
-- VALUES ('xxx', 1, 1706688000000, 1706688000000);
