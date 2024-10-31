const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('trading.db');

db.serialize(() => {
    // Tabela de sinais
    db.run(`CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT,
        entry_time INTEGER,
        direction TEXT,
        entry_price REAL,
        expiration_time INTEGER,
        result TEXT,
        confidence REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Tabela de performance
    db.run(`CREATE TABLE IF NOT EXISTS performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT,
        date DATE,
        trades INTEGER,
        wins INTEGER,
        losses INTEGER,
        profit_factor REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = db;