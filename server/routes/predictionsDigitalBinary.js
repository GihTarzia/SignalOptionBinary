const express = require("express");
const app = express.Router();
const WebSocket = require("ws");
const path = require("path");


const symbols = [
    "frxAUDCAD", "frxAUDCHF", "frxAUDJPY", "frxAUDNZD", "frxAUDUSD",
    "frxEURAUD", "frxEURCAD", "frxEURCHF", "frxEURGBP", "frxEURJPY",
    "frxEURNZD", "frxEURUSD", "frxGBPAUD", "frxGBPCAD", "frxGBPCHF",
    "frxGBPJPY", "frxGBPNZD", "frxGBPUSD", "frxNZDJPY", "frxUSDSEK",
    "frxUSDCAD", "frxUSDJPY", "frxUSDMXN", "frxUSDNOK", "frxUSDPLN",
  ];
  
const symbolData = {};

// Inicializar dados para cada símbolo
symbols.forEach((symbol) => {
  symbolData[symbol] = {
    ticks: [],
    successfulPredictions: 0,
    totalPredictions: 0,
    lastPredictionTime: 0,
  };
});
// Função para conectar ao WebSocket
function connectWebSocket() {
  const app_id = process.env.APP_ID || 1089;
  let socket = new WebSocket(
    `wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`
  );

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
      if (symbolData[symbol]) {
        symbolData[symbol].ticks.push({ quote, epoch });
        calculatePredictions(symbol);
      }
    } else if (message.history) {
      const { symbol, history } = message;
      if (symbolData[symbol]) {
        //symbolData[symbol].ticks = history;
        const fifteenMinutesAgoEpoch = Math.floor(Date.now() / 1000) - 1 * 60;
        symbolData[symbol].ticks = history.filter(
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
  socket.send(JSON.stringify(requestMessage));
}

// Função para calcular a EMA
function calculateEMA(prices, period) {
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  return prices.slice(period).reduce((acc, price, index) => {
    ema = (price - ema) * multiplier + ema;
    acc.push(ema);
    return acc;
  }, []);
}

// Função para calcular previsões
function calculatePredictions(symbol) {
  const now = Date.now();
  const data = symbolData[symbol];

  if (data.ticks.length < 20) return;

  const latestTicks = data.ticks.slice(-20);
  const prices = latestTicks.map((tick) => tick.quote);

  // Cálculo da EMA
  const emaShort = calculateEMA(prices, 12);
  const emaLong = calculateEMA(prices, 26);

  // Cálculo do MACD
  const macd = emaShort
    .slice(-emaLong.length)
    .map((ema, index) => ema - emaLong[index]);
  const macdSignal = calculateEMA(macd, 9);

  const lastPrice = prices[prices.length - 1];
  const predictedDirection =
    macd[macd.length - 1] > macdSignal[macdSignal.length - 1]
      ? "Comprar"
      : "Vender";

  let expirationSuggestion = "5 minutos";

  data.totalPredictions++;
  if (
    (predictedDirection === "Comprar" &&
      lastPrice > emaShort[emaShort.length - 1]) ||
    (predictedDirection === "Vender" &&
      lastPrice < emaShort[emaShort.length - 1])
  ) {
    data.successfulPredictions++;
  }

  const accuracy = (data.successfulPredictions / data.totalPredictions) * 100;

  const lastTickTime = new Date(
    latestTicks[latestTicks.length - 1].epoch * 1000
  );
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

  //console.log('##################');
  //console.log(`Ativo: ${symbol}`);
  //console.log(`Preço Atual: ${lastPrice}`);
  //console.log(`Horário do Último Tick: ${lastTickTime.toLocaleTimeString()}`);
  //console.log(`Horário de Entrada Possível: ${possibleEntryTime.toLocaleTimeString()}`);
  //console.log(`Previsão: ${predictedDirection}`);
  //console.log(`Tempo de Expiração Sugerido: ${expirationSuggestion}`);
  //console.log(`Porcentagem de Acerto: ${accuracy.toFixed(2)}%`);
  //console.log('##################');

  data.lastPredictionTime = now;
}

// Rota para iniciar previsões

app.get("/get", (req, res) => {
  const results = Object.values(symbolData)
    .map((data) => data.result)
    .filter((result) => result !== null);
  if (results.length > 0) {
    isResponseSent = true;
    res.json(results);
  }
});

// Iniciar a conexão do WebSocket
//connectWebSocket();

// Rota para servir o arquivo HTML
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../../client", "indexPredictionsDigitalBinary.html")
  );
});

module.exports = app;
