// server/controllers/signalController.js
const db = require('../config/db'); // Importando a conexão do banco de dados

const createSignal = (req, res) => {
    const { asset, entry_time, direction } = req.body;
    const query = 'INSERT INTO signals (asset, entry_time, direction) VALUES (?, ?, ?)';
    
    db.query(query, [asset, entry_time, direction], (err, results) => {
        if (err) {
            console.error('Erro ao inserir sinal:', err);
            return res.status(500).send('Erro ao inserir sinal.');
        }
        res.status(201).json({ id: results.insertId, asset, entry_time, direction });
    });
};


const getSignals = (req, res) => {
    Signal.getAll((err, signals) => {
        if (err) {
            return res.status(500).send('Erro ao obter sinais.');
        }
        res.json(signals);
    });
};
