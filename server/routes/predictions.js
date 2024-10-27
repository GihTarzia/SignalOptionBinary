const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const DerivAPI = require('@deriv/deriv-api/dist/DerivAPI');
let ticks = [];
const symbol = 'R_100'; // Exemplo de ativo
const predictionInterval = 60; // 60 segundos

// Configurar a conexão WebSocket
const app_id = process.env.DerivAPI || 1089; // Use seu app_id aqui
const socket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

socket.onopen = () => {
  console.log('Conectado ao WebSocket da Deriv');
  requestTicks(symbol);
};

socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.tick) {
    ticks.push(message.tick);
    calculatePredictions();
  } else if (message.history) {
    console.log('Histórico de ticks:', message.history);
    ticks = [...message.history];
    calculatePredictions();
  }
};

socket.onerror = (error) => {
  console.error('Erro no WebSocket:', error);
};

socket.onclose = () => {
  console.log('Conexão ao WebSocket encerrada');
};

// Solicitar ticks
function requestTicks(symbol) {
  const requestMessage = {
    ticks: symbol,
    subscribe: 1,
  };
  socket.send(JSON.stringify(requestMessage));
}

// Função para calcular previsões
function calculatePredictions() {
  if (ticks.length < 20) return; // Esperar coletar ticks suficientes

  const latestTicks = ticks.slice(-20); // Últimos 20 ticks
  const prices = latestTicks.map(tick => tick.quote);

  // Cálculo da média móvel simples (SMA)
  const sma = prices.reduce((a, b) => a + b, 0) / prices.length;

  // Cálculo do RSI
  const gains = [];
  const losses = [];
  for (let i = 1; i < latestTicks.length; i++) {
    const difference = prices[i] - prices[i - 1];
    if (difference > 0) {
      gains.push(difference);
    } else {
      losses.push(Math.abs(difference));
    }
  }

  const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length || 0;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length || 0;

  const rs = avgGain / avgLoss || 0;
  const rsi = 100 - (100 / (1 + rs));

  // Lógica de previsão
  const lastPrice = prices[prices.length - 1];
  const predictedDirection = (lastPrice > sma && rsi < 70) ? 'Comprar' : 'Vender';

  console.log(`Previsão: ${predictedDirection}`);
  console.log(`Média Móvel: ${sma}`);
  console.log(`RSI: ${rsi.toFixed(2)}`);
}

// Rota para iniciar previsões
router.get('/', (req, res) => {
  if (socket.readyState === WebSocket.CLOSED) {
    socket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
  }
  res.send('Conexão ao WebSocket iniciada. Veja o console para previsões.');
});

module.exports = router;