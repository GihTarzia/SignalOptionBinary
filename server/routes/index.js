const express = require("express");
const predictionsRoutes = require("./predictionsForex");
const predictionsVolacityRoutes = require("./predictionsVolacity");
const router = express.Router();

// Usando as rotas de sinais e precisão
router.use("/previsaoVolacity", predictionsVolacityRoutes);
router.use("/previsaoForex", predictionsRoutes);

module.exports = router;
