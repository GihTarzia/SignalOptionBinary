// server/models/Statistic.js
const mysql = require('mysql2');
const db = require('../db'); // Importa a configuração do banco de dados

class Statistic {
    constructor(signal_id) {
        this.signal_id = signal_id;
    }

    // Método para calcular a precisão do sinal
    static calculateAccuracy(signalId, callback) {
        const query = `
            SELECT 
                COUNT(sr.result) AS total_results, 
                SUM(sr.result) AS successful_results,
                (SUM(sr.result) / COUNT(sr.result)) * 100 AS accuracy_percentage
            FROM 
                signal_results sr
            WHERE 
                sr.signal_id = ?
        `;
        
        db.query(query, [signalId], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0]);
        });
    }
}

module.exports = Statistic;
