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

let symbolData = {};

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
      if (symbolData[symbol]) {
        symbolData[symbol].ticks.push({ quote, epoch });
        const oneMinuteAgoEpoch = Math.floor(Date.now() / 1000) - 1 * 60;
        symbolData[symbol].ticks = symbolData[symbol].ticks.filter(
          (tick) => tick.epoch >= oneMinuteAgoEpoch
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

// Função para criar velas a partir de ticks
function createCandles(ticks, interval) {
  const candles = [];
  let currentCandle = null;

  ticks.forEach(tick => {
    const tickTime = new Date(tick.epoch * 1000);
    const tickClose = tick.quote;

    if (!currentCandle || tickTime - currentCandle.startTime >= interval * 60 * 1000) {
      if (currentCandle) {
        candles.push(currentCandle);
      }
      currentCandle = {
        open: tickClose,
        high: tickClose,
        low: tickClose,
        close: tickClose,
        startTime: tickTime,
        endTime: tickTime,
      };
    } else {
      currentCandle.high = Math.max(currentCandle.high, tickClose);
      currentCandle.low = Math.min(currentCandle.low, tickClose);
      currentCandle.close = tickClose;
      currentCandle.endTime = tickTime;
    }
  });

  if (currentCandle) {
    candles.push(currentCandle);
  }

  return candles;
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

  return 100 - (100 / (1 + rs));
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
    middleBand: simpleMovingAverage,
  };
}

// Função para calcular MACD
function calculateMACD(prices) {
  const shortEMA = calculateEMA(prices, 12);
  const longEMA = calculateEMA(prices, 26);
  const macd = shortEMA.slice(longEMA.length - shortEMA.length);
  const signalLine = calculateEMA(macd, 9);
  return { macd, signalLine };
}

// Função para calcular Estocástico
function calculateStochastic(prices, period = 14) {
  if (prices.length < period) return null;

  const highestHigh = Math.max(...prices.slice(-period));
  const lowestLow = Math.min(...prices.slice(-period));
  const currentPrice = prices[prices.length - 1];

  return ((currentPrice - lowestLow) / (highestHigh - lowestLow)) * 100;
}

// Função para calcular previsões
function calculatePredictions(symbol) {
  //console.log(`Calculando previsões para ${symbol}`);
  const data = symbolData[symbol];

  //console.log(`Ticks disponíveis para ${symbol}: ${data.ticks.length}`);

  if (data.ticks.length < 300) {
    console.log(`Dados insuficientes para ${symbol}. Ticks disponíveis: ${data.ticks.length}`);
    return;
  }

  const candles = createCandles(data.ticks, 1); // Criar velas de 1 minuto
  console.log(`Velas criadas para ${symbol}: ${candles.length}`);

  if (candles.length < 20) {
    console.log(`Não há velas suficientes para calcular previsões para ${symbol}.`);
    return; // Verificar se há velas suficientes
  }

  const prices = candles.map(candle => candle.close);
  console.log(`Preços extraídos para ${symbol}:`, prices);

  // Calcular indicadores
  const emaShort = calculateEMA(prices, 9);
  const emaLong = calculateEMA(prices, 21);
  const macdResult = calculateMACD(prices);
  const macd = macdResult.macd;
  const signalLine = macdResult.signalLine;

  console.log(`EMA Curto para ${symbol}:`, emaShort);
  console.log(`EMA Longo para ${symbol}:`, emaLong);
  console.log(`MACD para ${symbol}:`, macd);
  console.log(`MACD Signal para ${symbol}:`, signalLine);

  const rsi = calculateRSI(prices, 14);
  const bollingerBands = calculateBollingerBands(prices);
  const stochastic = calculateStochastic(prices, 14);

  console.log(`RSI para ${symbol}:`, rsi);
  console.log(`Bandas de Bollinger para ${symbol}:`, bollingerBands);
  console.log(`Estocástico para ${symbol}:`, stochastic);

  let predictedDirection = "Neutro";
  let expirationSuggestion = "1 minuto";
  let confidence = 0;

  // Lógica de previsão com múltiplos indicadores
  if (
    emaShort.length > 0 &&
    emaLong.length > 0 &&
    macd.length > 0 &&
    signalLine.length > 0
  ) {
    const lastEmaShort = emaShort[emaShort.length - 1];
    const lastEmaLong = emaLong[emaLong.length - 1];
    const lastMacd = macd[macd.length - 1];
    const lastSignal = signalLine[signalLine.length - 1];

    // Exemplo de regras de previsão
    if (lastEmaShort > lastEmaLong && lastMacd > lastSignal) {
      predictedDirection = "CALL";
      confidence += 0.5; // Exemplo de aumento de confiança
    } else if (lastEmaShort < lastEmaLong && lastMacd < lastSignal) {
      predictedDirection = "PUT";
      confidence += 0.5; // Exemplo de aumento de confiança
    }

    // Adicionar lógica adicional para ajustar a confiança com base em outros indicadores
    if (rsi < 30) {
      predictedDirection = "CALL";
      confidence += 0.3;
    } else if (rsi > 70) {
      predictedDirection = "PUT";
      confidence += 0.3;
    }

    // Avaliar Bandas de Bollinger
    if (bollingerBands) {
      const { upperBand, lowerBand } = bollingerBands;
      const lastPrice = prices[prices.length - 1];
      if (lastPrice <= lowerBand) {
        predictedDirection = "CALL";
        confidence += 0.3;
      } else if (lastPrice >= upperBand) {
        predictedDirection = "PUT";
        confidence += 0.3;
      }
    }

    // Avaliar Estocástico
    if (stochastic) {
      if (stochastic < 20) {
        predictedDirection = "CALL";
        confidence += 0.2;
      } else if (stochastic > 80) {
        predictedDirection = "PUT";
        confidence += 0.2;
      }
    }

    // Calcular a precisão das previsões
    if (data.result !== null) {
      if (
        (predictedDirection === "CALL" && data.result === "up") ||
        (predictedDirection === "PUT" && data.result === "down")
      ) {
        data.successfulPredictions++;
      }
      data.totalPredictions++;
    }

    data.lastPredictionTime = Date.now();
    data.result = predictedDirection;
    console.log(`Previsão para ${symbol}: ${predictedDirection}, Confiança: ${confidence}`);
  } else {
    console.log(`Indicadores insuficientes para ${symbol}.`);
  }
}

// Iniciar a conexão com o WebSocket
connectWebSocket();

// Expor a rota para obter dados de previsão
app.get("/get", (req, res) => {
  res.json(symbolData);
});

// Rota para servir o arquivo HTML
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../../client", "indexPredictionsBinaryByCandle.html")
  );
});

module.exports = app;
