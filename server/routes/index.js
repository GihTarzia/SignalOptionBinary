const express = require("express");
const predictionsRoutes = require("./predictionsForex");
const predictionsVolacityRoutes = require("./predictionsVolacity");
const predictionsDigitalBinary = require("./predictionsDigitalBinary");
const predictionsBinaryByCandle = require("./predictionsBinaryByCandle");
const predictionsBinaryAlpha = require("./predictionsBinaryAlpha");
const bestSymbolsForexRoutes = require("./bestSymbolsForex");
const router = express.Router();

// Usando as rotas de sinais e precisão
//router.use("/previsaoVolacity", predictionsVolacityRoutes);
router.use("/previsaoForex", predictionsRoutes);
//router.use("/bestSymbolsForex", bestSymbolsForexRoutes);
router.use("/previsaoDigitalBinary", predictionsDigitalBinary);
router.use("/previsaoBinaryByCandle", predictionsBinaryByCandle);
//router.use("/previsaoBinaryAlpha", predictionsBinaryAlpha);


module.exports = router;
