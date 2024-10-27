const express = require('express');
const router = express.Router();
const { getAccuracy } = require('../controllers/accuracyController');

// Rota para obter a precisão dos sinais
router.get('/', getAccuracy);

module.exports = router;
