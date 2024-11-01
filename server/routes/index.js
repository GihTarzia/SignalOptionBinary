const express = require("express");
const predictionsRoutes = require("./predictionsForex");
const predictionsBinaryRoutes = require("./predictionsBinary");
//const predictionsDigitalBinary = require("./predictionsDigitalBinary");
//const predictionsBinaryByCandle = require("./predictionsBinaryByCandle");
const router = express.Router();

// Usando as rotas de sinais e precisão
//router.use("/previsaoForex", predictionsRoutes);
router.use("/previsaoBinary", predictionsBinaryRoutes);
//router.use("/previsaoDigitalBinary", predictionsDigitalBinary);
//router.use("/previsaoBinaryByCandle", predictionsBinaryByCandle);


module.exports = router;
