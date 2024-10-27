const express = require('express');
//const signalRoutes = require('./signals');
//const accuracyRoutes = require('./accuracy');
const predictionsRoutes = require('./predictions');
const router = express.Router();

// Usando as rotas de sinais e precisão
//router.use('/signals', signalRoutes);
//router.use('/accuracy', accuracyRoutes);
router.use('/predictions', predictionsRoutes);

module.exports = router;
