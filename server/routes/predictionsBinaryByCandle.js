const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express.Router();
const db = new sqlite3.Database("predictions.db", (err) => {
  if (err) {
    console.error("Erro ao abrir o banco de dados:", err.message);
  } else {
    console.log("Conectado ao banco de dados SQLite.");
    db.run(`CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      predictedDirection TEXT,
      confidence REAL,
      successful INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

const symbols = [
  // Lista de símbolos
];

const symbolData = {};

// Inicializar dados para cada símbolo
symbols.forEach(symbol => {
  symbolData[symbol] = {
    ticks: [],
    candles: [],
    successfulPredictions: 0,
    totalPredictions: 0,
    lastPredictionTime: 0,
    result: null,
  };
});

// Função para conectar ao WebSocket
function connectWebSocket() {
  const app_id = process.env.APP_ID || 1089;
  const socket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

  socket.onopen = () => {
    console.log("Conectado ao WebSocket da Deriv");
    symbols.forEach(symbol => requestTicks(symbol, socket));
  };

  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.error) {
      console.log(message.echo_req.ticks + ": " + message.error.code);
    }
    if (message.tick) {
      const { symbol, quote, epoch } = message.tick;
      if (symbolData[symbol]) {
        symbolData[symbol].ticks.push({ quote, epoch });
        processTicks(symbol);
      }
    }
  };

  socket.onerror = error => {
    console.error("Erro no WebSocket:", error);
  };

  socket.onclose = () => {
    console.log("Conexão ao WebSocket encerrada, tentando reconectar...");
    setTimeout(connectWebSocket, 5000);
  };
}

// Solicitar ticks
function requestTicks(symbol, socket) {
  const requestMessage = { ticks: symbol, subscribe: 1 };
  socket.send(JSON.stringify(requestMessage));
}

function processTicks(symbol) {
  const data = symbolData[symbol];
  console.log(`Recebendo ticks para ${symbol}:`, data.ticks.length);

  const oneMinuteAgoEpoch = Math.floor(Date.now() / 1000) - 60;
  data.ticks = data.ticks.filter(tick => tick.epoch >= oneMinuteAgoEpoch);

  if (data.ticks.length >= 60) {
    const candle = createCandle(data.ticks);
    console.log(`Candle criado para ${symbol}`, candle);
    data.candles.push(candle);
    if (data.candles.length > 3) {
      data.candles.shift();
    }
    calculatePredictions(symbol);
  }
}

function createCandle(ticks) {
  const open = ticks[0].quote;
  const close = ticks[ticks.length - 1].quote;
  const high = Math.max(...ticks.map(t => t.quote));
  const low = Math.min(...ticks.map(t => t.quote));
  return { open, high, low, close };
}

function calculateEMA(prices, period) {
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  return prices.slice(period).reduce((acc, price) => {
    ema = (price - ema) * multiplier + ema;
    acc.push(ema);
    return acc;
  }, []);
}

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

  return 100 - 100 / (1 + rs);
}

function calculateBollingerBands(prices, period = 20) {
  if (prices.length < period) return null;

  const sma = prices.slice(-period).reduce((a, b) => a + b, 0) / period;
  const variance = prices.slice(-period).reduce((acc, price) => acc + Math.pow(price - sma, 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);

  return {
    upperBand: sma + 2 * standardDeviation,
    lowerBand: sma - 2 * standardDeviation,
    middleBand: sma,
  };
}

function calculateStochastic(prices, period = 14) {
  if (prices.length < period) return null;

  const highestHigh = Math.max(...prices.slice(-period));
  const lowestLow = Math.min(...prices.slice(-period));
  const currentPrice = prices[prices.length - 1];

  return ((currentPrice - lowestLow) / (highestHigh - lowestLow)) * 100;
}

function calculatePredictions(symbol) {
  const data = symbolData[symbol];

  if (data.candles.length < 3) return;

  const prices = data.candles.map(candle => candle.close);

  const emaShort = calculateEMA(prices, 12);
  const emaLong = calculateEMA(prices, 26);
  const rsi = calculateRSI(prices, 14);
  const bollingerBands = calculateBollingerBands(prices);
  const stochastic = calculateStochastic(prices, 14);

  const macd = emaShort
    .slice(-emaLong.length)
    .map((ema, index) => ema - emaLong[index]);
  const macdSignal = calculateEMA(macd, 9);

  const lastPrice = prices[prices.length - 1];
  let predictedDirection;
  let confidence = 0;

  if (macd[macd.length - 1] > macdSignal[macdSignal.length - 1]) {
    predictedDirection = "ACIMA";
    confidence += 0.3;
  } else {
    predictedDirection = "ABAIXO";
    confidence += 0.3;
  }

  if (rsi < 30) {
    predictedDirection = "ACIMA";
    confidence += 0.2;
  } else if (rsi > 70) {
    predictedDirection = "ABAIXO";
    confidence += 0.2;
  }

  if (bollingerBands) {
    const { upperBand, lowerBand } = bollingerBands;
    if (lastPrice <= lowerBand) {
      predictedDirection = "ACIMA";
      confidence += 0.2;
    } else if (lastPrice >= upperBand) {
      predictedDirection = "ABAIXO";
      confidence += 0.2;
    }
  }

  if (stochastic < 20) {
    predictedDirection = "ACIMA";
    confidence += 0.1;
  } else if (stochastic > 80) {
    predictedDirection = "ABAIXO";
    confidence += 0.1;
  }

  const patternSignal = detectCandlePattern(data.candles);
  if (patternSignal) {
    predictedDirection = patternSignal;
    confidence += 0.2;
  }

  let expirationSuggestion = "5 minutos";

  data.totalPredictions++;
  if (
    (predictedDirection === "ACIMA" &&
      lastPrice > emaShort[emaShort.length - 1]) ||
    (predictedDirection === "ABAIXO" &&
      lastPrice < emaShort[emaShort.length - 1])
  ) {
    data.successfulPredictions++;
  }

  const accuracy = (data.successfulPredictions / data.totalPredictions) * 100;

  const lastTickTime = new Date(
    data.ticks[data.ticks.length - 1].epoch * 1000
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
    confidence: confidence.toFixed(2)
  };

  storePrediction(symbol, predictedDirection, confidence);

  console.log('##################');
  console.log(`Ativo: ${symbol}`);
  console.log(`Preço Atual: ${lastPrice}`);
  console.log(`Horário do Último Tick: ${lastTickTime.toLocaleTimeString()}`);
  console.log(`Horário de Entrada Possível: ${possibleEntryTime.toLocaleTimeString()}`);
  console.log(`Previsão: ${predictedDirection}`);
  console.log(`Tempo de Expiração Sugerido: ${expirationSuggestion}`);
  console.log(`Porcentagem de Acerto: ${accuracy.toFixed(2)}%`);
  console.log(`Confiança: ${confidence.toFixed(2)}`);
  console.log('##################');

  data.result = {
    symbol: symbol,
    currentPrice: lastPrice,
    lastTickTime: lastTickTime.toLocaleTimeString(),
    possibleEntryTime: possibleEntryTime.toLocaleTimeString(),
    predictedDirection: predictedDirection,
    expirationSuggestion: expirationSuggestion,
    accuracy: accuracy.toFixed(2),
  };

  data.lastPredictionTime = Date.now();
}

function detectCandlePattern(candles) {
  // Implementação simplificada de detecção de padrões de velas
  const lastCandle = candles[candles.length - 1];
  const secondLastCandle = candles[candles.length - 2];

  if (lastCandle.close > lastCandle.open && secondLastCandle.close < secondLastCandle.open) {
    return "ACIMA"; // Exemplo de padrão de reversão
  } else if (lastCandle.close < lastCandle.open && secondLastCandle.close > secondLastCandle.open) {
    return "ABAIXO"; // Exemplo de padrão de reversão
  }

  return null;
}

function storePrediction(symbol, direction, confidence) {
  const sql = `INSERT INTO predictions (symbol, predictedDirection, confidence, successful) VALUES (?, ?, ?, NULL)`;
  db.run(sql, [symbol, direction, confidence], function(err) {
    if (err) {
      console.error("Erro ao armazenar previsão:", err.message);
    } else {
      console.log(`Previsão armazenada para ${symbol}: ${direction}, Confiança: ${confidence}`);

      setTimeout(() => verifyPredictionOutcome(symbol, this.lastID, direction), 5 * 60 * 1000);
    }
  });
}

function verifyPredictionOutcome(symbol, predictionId, predictedDirection) {
  const data = symbolData[symbol];
  const lastPrice = data.ticks[data.ticks.length - 1].quote;
  const actualDirection = getActualDirection(symbol, lastPrice);

  const successful = (predictedDirection === actualDirection) ? 1 : 0;
  const sql = `UPDATE predictions SET successful = ? WHERE id = ?`;
  db.run(sql, [successful, predictionId], (err) => {
    if (err) {
      console.error("Erro ao atualizar previsão:", err.message);
    } else {
      console.log(`Previsão ${predictionId} atualizada como ${successful ? "WIN" : "LOSS"}.`);
    }
  });
}

function getActualDirection(symbol, lastPrice) {
  const data = symbolData[symbol];
  const predictionPrice = data.candles[data.candles.length - 1].close;

  if (lastPrice > predictionPrice) {
    return "ACIMA";
  } else if (lastPrice < predictionPrice) {
    return "ABAIXO";
  } else {
    return "Neutro";
  }
}

app.get("/get", (req, res) => {
  const results = Object.values(symbolData)
    .map(data => data.result)
    .filter(result => result !== null);
  if (results.length > 0) {
    res.json(results);
  } else {
    res.status(404).send("No predictions available");
  }
});

//connectWebSocket();

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../../client", "indexPredictionsBinaryByCandle.html")
  );
});

module.exports = app;