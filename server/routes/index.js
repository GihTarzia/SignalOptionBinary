const express = require('express');
const signalRoutes = require('./signal');
const accuracyRoutes = require('./accuracy');

const router = express.Router();

// Usando as rotas de sinais e precisão
router.use('/signals', signalRoutes);
router.use('/accuracy', accuracyRoutes);

module.exports = router;
