const express = require("express");
const app = express.Router();
const WebSocket = require("ws");

const symbols = [
  'frxAUDCAD', 'frxAUDCHF', 'frxAUDJPY',
  'frxAUDNZD', 'frxAUDUSD', 'frxEURAUD',
  'frxEURCAD', 'frxEURCHF', 'frxEURGBP',
  'frxEURJPY', 'frxEURNZD', 'frxEURUSD',
  'frxGBPAUD', 'frxGBPCAD', 'frxGBPCHF',
  'frxGBPJPY', 'frxGBPNOK', 'frxGBPNZD',
  'frxGBPUSD', 'frxNZDJPY', 'frxNZDUSD',
  'frxUSDCAD', 'frxUSDCHF', 'frxUSDJPY',
  'frxUSDMXN', 'frxUSDNOK', 'frxUSDPLN',
  'frxUSDSEK'
];

const symbolData = {};

// Inicializar dados para cada símbolo
symbols.forEach((symbol) => {
  symbolData[symbol] = {
    ticks: [],
    symbol: symbol,
    successfulPredictions: 0,
    totalPredictions: 0,
    lastPredictionTime: 0,
    result: null,
  };
});

const app_id = process.env.APP_ID || 1089;
let socket;

function connectWebSocket() {
  socket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

  socket.onopen = () => {
    console.log("Conectado ao WebSocket da Deriv");
    symbols.forEach((symbol) => requestTicks(symbol));
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.error) {
      console.error("Erro na resposta da API:", message.error);
      return;
    }

    if (message.tick) {
      const { symbol, quote, epoch } = message.tick;
      if (symbolData[symbol]) {
        symbolData[symbol].ticks.push({ quote, epoch });
        calculatePredictions(symbol);
      }
    }
  };

  socket.onerror = (error) => {
    console.error("Erro no WebSocket:", error);
  };

  socket.onclose = () => {
    console.log("Conexão ao WebSocket encerrada");
  };
}

function requestTicks(symbol) {
  if (socket.readyState === WebSocket.OPEN) {
    const requestMessage = {
      ticks: symbol,
      subscribe: 1,
    };
    socket.send(JSON.stringify(requestMessage));
  }
}

function calculatePredictions(symbol) {
  const now = Date.now();
  const data = symbolData[symbol];

  if (data.ticks.length < 20 || now - data.lastPredictionTime < 60000) return;

  const latestTicks = data.ticks.slice(-20);
  const prices = latestTicks.map((tick) => tick.quote);

  const lastPrice = prices[prices.length - 1];
  const predictedDirection = Math.random() > 0.5 ? "Comprar" : "Vender";

  data.totalPredictions++;
  if ((predictedDirection === "Comprar" && Math.random() > 0.5) ||
      (predictedDirection === "Vender" && Math.random() <= 0.5)) {
    data.successfulPredictions++;
  }

  const accuracy = (data.successfulPredictions / data.totalPredictions) * 100;

  data.result = {
    symbol: symbol,
    currentPrice: lastPrice,
    predictedDirection: predictedDirection,
    accuracy: accuracy.toFixed(2),
  };

  data.lastPredictionTime = now;
}

app.get("/get", (req, res) => {
  const results = Object.values(symbolData)
    .map((data) => data.result)
    .filter((result) => result !== null);
  res.json(results);
});

app.get("/", (req, res) => {
  const results = Object.values(symbolData)
    .map((data) => ({
      symbol: data.result ? data.result.symbol : null,
      accuracy: data.result ? data.result.accuracy : null
    }))
    .filter((result) => result.accuracy !== null)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 5);
  res.json(results);
});

//connectWebSocket();

module.exports = app;