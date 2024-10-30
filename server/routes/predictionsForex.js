const express = require("express");
const app = express.Router();
const WebSocket = require("ws");
const path = require("path");

const symbols = [
  "frxAUDCAD", "frxAUDCHF", "frxAUDJPY", "frxAUDNZD", "frxAUDUSD",
  "frxEURAUD", "frxEURCAD", "frxEURCHF", "frxEURGBP", "frxEURJPY",
  "frxEURNZD", "frxEURUSD", "frxGBPAUD", "frxGBPCAD", "frxGBPCHF",
  "frxGBPJPY", "frxGBPNOK", "frxGBPNZD", "frxGBPUSD", "frxNZDJPY",
  "frxNZDUSD", "frxUSDCAD", "frxUSDCHF", "frxUSDJPY", "frxUSDMXN",
  "frxUSDNOK", "frxUSDPLN", "frxUSDSEK",
];

let symbolData = {};

// Inicializar dados para cada símbolo
symbols.forEach((symbol) => {
  symbolData[symbol] = {
    ticks: [],
    successfulPredictions: 0,
    totalPredictions: 0,
    lastPredictionTime: 0,
    result: null,
    lastPrice: 0
  };
});

// Função para conectar ao WebSocket
function connectWebSocket() {
  const app_id = process.env.APP_ID || 1089;
  let socket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

  socket.onopen = () => {
    console.log("Conectado ao WebSocket da Deriv");
    symbols.forEach((symbol) => requestTicks(symbol, socket));
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.error) {
      console.log(message.echo_req.ticks + ": " + message.error.code);
    }
    if (message.tick) {
      const { symbol, quote, epoch } = message.tick;
      console.log(`Recebido tick para ${symbol}: ${quote} em ${new Date(epoch * 1000).toLocaleTimeString()}`);
      if (symbolData[symbol]) {
        symbolData[symbol].ticks.push({ quote, epoch });
        symbolData[symbol].lastPrice = quote;
        console.log(`Total de ticks para ${symbol}: ${symbolData[symbol].ticks.length}`);
        const fifteenMinutesAgoEpoch = Math.floor(Date.now() / 1000) - 15 * 60;
        symbolData[symbol].ticks = symbolData[symbol].ticks.filter(
          (tick) => tick.epoch >= fifteenMinutesAgoEpoch
        );
        calculatePredictions(symbol);
      }
    }
  };

  socket.onerror = (error) => {
    console.error("Erro no WebSocket:", error);
  };

  socket.onclose = () => {
    console.log("Conexão ao WebSocket encerrada, tentando reconectar...");
    setTimeout(connectWebSocket, 5000);
  };
}

// Solicitar ticks
function requestTicks(symbol, socket) {
  const requestMessage = {
    ticks: symbol,
    subscribe: 1,
  };
  console.log(`Solicitando ticks para ${symbol}`);
  socket.send(JSON.stringify(requestMessage));
}

// Função para calcular a EMA
function calculateEMA(prices, period) {
  if (prices.length < period) return [];
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  return prices.slice(period).reduce((acc, price) => {
    ema = (price - ema) * multiplier + ema;
    acc.push(ema);
    return acc;
  }, []);
}

// Função para calcular o RSI
function calculateRSI(prices, period = 14) {
  if (prices.length < period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i < period; i++) {
    const difference = prices[i] - prices[i - 1];
    if (difference >= 0) {
      gains += difference;
    } else {
      losses -= difference;
    }
  }

  if (losses === 0) return 100;

  const averageGain = gains / period;
  const averageLoss = losses / period;
  const rs = averageGain / averageLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
}

// Função para calcular Bandas de Bollinger
function calculateBollingerBands(prices, period = 20) {
  if (prices.length < period) return null;

  const simpleMovingAverage = prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  const variance = prices.slice(-period).reduce((acc, price) => acc + Math.pow(price - simpleMovingAverage, 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);

  return {
    upperBand: simpleMovingAverage + (2 * standardDeviation),
    lowerBand: simpleMovingAverage - (2 * standardDeviation),
    middleBand: simpleMovingAverage
  };
}

// Função para calcular previsões
function calculatePredictions(symbol) {
  console.log(`Calculando previsões para ${symbol}`);
  const data = symbolData[symbol];

  if (data.ticks.length < 300) {
    console.log(`Dados insuficientes para ${symbol}. Ticks disponíveis: ${data.ticks.length}`);
    return;
  }

  const latestTicks = data.ticks.slice(-300);
  const prices = latestTicks.map((tick) => tick.quote);

  const emaShort1 = calculateEMA(prices, 9);
  const emaLong1 = calculateEMA(prices, 21);

  const emaShort5 = calculateEMA(prices.slice(-5 * 60), 9);
  const emaLong5 = calculateEMA(prices.slice(-5 * 60), 21);

  const emaShort15 = calculateEMA(prices.slice(-15 * 60), 9);
  const emaLong15 = calculateEMA(prices.slice(-15 * 60), 21);

  const macd1 = emaShort1.slice(-emaLong1.length).map((ema, index) => ema - emaLong1[index]);
  const macdSignal1 = calculateEMA(macd1, 9);

  const macd5 = emaShort5.slice(-emaLong5.length).map((ema, index) => ema - emaLong5[index]);
  const macdSignal5 = calculateEMA(macd5, 9);

  const macd15 = emaShort15.slice(-emaLong15.length).map((ema, index) => ema - emaLong15[index]);
  const macdSignal15 = calculateEMA(macd15, 9);

  const rsi = calculateRSI(prices, 14);
  const bollingerBands = calculateBollingerBands(prices);

  let predictedDirection = "Neutro";
  let expirationSuggestion = "1 minuto";

  if (
    macd1[macd1.length - 1] > macdSignal1[macdSignal1.length - 1] &&
    macd5[macd5.length - 1] > macdSignal5[macdSignal5.length - 1] &&
    macd15[macd15.length - 1] > macdSignal15[macdSignal15.length - 1] &&
    rsi < 70
  ) {
    predictedDirection = "Comprar";
    expirationSuggestion = "5 minutos";
  } else if (
    macd1[macd1.length - 1] < macdSignal1[macdSignal1.length - 1] &&
    macd5[macd5.length - 1] < macdSignal5[macdSignal5.length - 1] &&
    macd15[macd15.length - 1] < macdSignal15[macdSignal15.length - 1] &&
    rsi > 30
  ) {
    predictedDirection = "Vender";
    expirationSuggestion = "5 minutos";
  }

  if (bollingerBands && prices[prices.length - 1] > bollingerBands.upperBand) {
    predictedDirection = "Vender";
    expirationSuggestion = "3 minutos";
  } else if (bollingerBands && prices[prices.length - 1] < bollingerBands.lowerBand) {
    predictedDirection = "Comprar";
    expirationSuggestion = "3 minutos";
  }

  // Validação da previsão
  const previousPrice = prices[prices.length - 2];
  let success = false;
  if (
    (predictedDirection === "Comprar" && prices[prices.length - 1] > previousPrice) ||
    (predictedDirection === "Vender" && prices[prices.length - 1] < previousPrice)
  ) {
    success = true;
    data.successfulPredictions++;
  }
  data.totalPredictions++;

  const overallAccuracy = data.totalPredictions > 0 ? 
    (data.successfulPredictions / data.totalPredictions) * 100 : 0;

  const individualAccuracy = success ? 100 : 0;

  const lastTick = latestTicks[latestTicks.length - 1];
  const lastTickTime = new Date(lastTick.epoch * 1000);
  const possibleEntryTime = new Date(lastTickTime.getTime() + 30000);

  data.result = {
    symbol: symbol,
    currentPrice: prices[prices.length - 1],
    lastTickTime: lastTickTime.toLocaleTimeString(),
    possibleEntryTime: possibleEntryTime.toLocaleTimeString(),
    predictedDirection: predictedDirection,
    expirationSuggestion: expirationSuggestion,
    overallAccuracy: overallAccuracy.toFixed(2),
    individualAccuracy: individualAccuracy,
    lastPredictionSuccess: success
  };

  data.lastPredictionTime = Date.now();

  console.log(`Previsão para ${symbol}: ${JSON.stringify(data.result)}`);
}
// Rota para iniciar previsões
app.get("/get", (req, res) => {
  console.log("Requisição recebida na rota /get");
  const results = Object.values(symbolData)
    .map((data) => data.result)
    .filter((result) => result !== null);
  if (results.length > 0) {
    res.json(results);
  } else {
    console.log("Nenhuma previsão disponível no momento.");
    res.status(204).send();
  }
});

// Iniciar a conexão do WebSocket
connectWebSocket();

// Rota para servir o arquivo HTML
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../../client", "indexPredictionsForex.html")
  );
});

module.exports = app;