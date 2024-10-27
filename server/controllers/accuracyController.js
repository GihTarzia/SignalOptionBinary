// Exemplo no accuracyController.js
const Statistic = require('../models/Statistic');

const getAccuracy = (req, res) => {
    const { signal_id } = req.params; // Supondo que você passe o signal_id como parâmetro
    Statistic.calculateAccuracy(signal_id, (err, accuracy) => {
        if (err) {
            return res.status(500).send('Erro ao calcular precisão.');
        }
        res.json(accuracy);
    });
};
