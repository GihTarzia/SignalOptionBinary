const express = require('express');
const router = express.Router();
const { getSignals, createSignal } = require('../controllers/signalController');

// Rota para obter todos os sinais
router.get('/', getSignals);

// Rota para adicionar um novo sinal
router.post('/', createSignal);

// Rota para registrar o resultado de um sinal
router.post('/results', (req, res) => {
    // Aqui, você implementará a lógica para registrar o resultado
});

module.exports = router;
