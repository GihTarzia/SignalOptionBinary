const express = require("express");
const app = express.Router();
const WebSocket = require("ws");
const path = require('path');

const symbols = ["frxAUDCAD", "frxNZDUSD"];
const symbolData = {};

// Inicializar dados para cada símbolo
symbols.forEach((symbol) => {
  symbolData[symbol] = {
    ticks: [],
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
      console.log(message.echo_req.ticks + ": " + message.error.code);
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
  const requestMessage = {
    ticks: symbol,
    subscribe: 1,
  };
  socket.send(JSON.stringify(requestMessage));
}

function calculateEMA(prices, period) {
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  return prices.slice(period).reduce((acc, price, index) => {
    ema = (price - ema) * multiplier + ema;
    acc.push(ema);
    return acc;
  }, []);
}

function calculateRSI(prices, period = 14) {
  const gains = [];
  const losses = [];
  for (let i = 1; i < prices.length; i++) {
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
  return 100 - (100 / (1 + rs));
}

function calculateBollingerBands(prices, period = 20, multiplier = 2) {
  const sma = prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  const variance = prices.slice(-period).reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: sma + multiplier * stdDev,
    middle: sma,
    lower: sma - multiplier * stdDev,
  };
}

function calculatePredictions(symbol) {
  const now = Date.now();
  const data = symbolData[symbol];

  if (data.ticks.length < 20 || now - data.lastPredictionTime < 60000) return;

  const latestTicks = data.ticks.slice(-20);
  const prices = latestTicks.map((tick) => tick.quote);

  const emaShort = calculateEMA(prices, 12);
  const emaLong = calculateEMA(prices, 26);

  const macd = emaShort.slice(-emaLong.length).map((ema, index) => ema - emaLong[index]);
  const macdSignal = calculateEMA(macd, 9);

  const rsi = calculateRSI(prices);
  const bollingerBands = calculateBollingerBands(prices);

  const lastPrice = prices[prices.length - 1];
  let predictedDirection = "Indefinido";

  if (macd[macd.length - 1] > macdSignal[macdSignal.length - 1] && rsi < 70 && lastPrice < bollingerBands.upper) {
    predictedDirection = "Comprar";
  } else if (macd[macd.length - 1] < macdSignal[macdSignal.length - 1] && rsi > 30 && lastPrice > bollingerBands.lower) {
    predictedDirection = "Vender";
  }

  let expirationSuggestion = "5 minutos";

  data.totalPredictions++;
  if (
    (predictedDirection === "Comprar" && lastPrice > emaShort[emaShort.length - 1]) ||
    (predictedDirection === "Vender" && lastPrice < emaShort[emaShort.length - 1])
  ) {
    data.successfulPredictions++;
  }

  const accuracy = (data.successfulPredictions / data.totalPredictions) * 100;

  const lastTickTime = new Date(latestTicks[latestTicks.length - 1].epoch * 1000);
  const possibleEntryTime = new Date(lastTickTime.getTime() + 30000);

  data.result = {
    symbol: symbol,
    currentPrice: lastPrice,
    lastTickTime: lastTickTime.toLocaleTimeString(),
    possibleEntryTime: possibleEntryTime.toLocaleTimeString(),
    predictedDirection: predictedDirection,
    expirationSuggestion: expirationSuggestion,
    accuracy: accuracy.toFixed(2),
  };

  data.lastPredictionTime = now;
}

app.get("/get", (req, res) => {
  if (socket.readyState === WebSocket.CLOSED) {
    socket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);
  } else {
    const results = Object.values(symbolData)
      .map((data) => data.result)
      .filter((result) => result !== null);
    res.json(results);
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../client", "indexPredictionsForex.html"));
});

module.exports = app;