/// server/models/Signal.js
const db = require('../config/db'); // Importando a conexão do banco de dados

class Signal {
    constructor(asset, entry_time, direction) {
        this.asset = asset;
        this.entry_time = entry_time;
        this.direction = direction;
    }

    save(callback) {
        const query = 'INSERT INTO signals (asset, entry_time, direction) VALUES (?, ?, ?)';
        db.query(query, [this.asset, this.entry_time, this.direction], callback);
    }

    static getAll(callback) {
        const query = 'SELECT * FROM signals';
        db.query(query, callback);
    }
}


module.exports = Signal;
