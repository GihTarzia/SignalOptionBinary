  const express = require("express");
  const app = express.Router();
  const WebSocket = require("ws");
  const path = require("path");
  const Database = require("better-sqlite3");
  const { RSI, BollingerBands, SMA } = require("technicalindicators");

  const OFFLINE_RECOVERY_PERIOD = 15 * 60; // 15 minutos em segundos
  const MIN_TICKS_FOR_CALCULATION = 20;
  let lastConnectionTime = Date.now();
  // Configurações
  const TICK_HISTORY_SIZE = 200;
  const MINIMUM_TICKS = 50;
  const MAX_GAP = 5; // segundos
  const CACHE_DURATION = 5000; // 5 segundos

  // Inicializar banco de dados
  const db = new Database("predictions.db");
  db.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      symbol TEXT,
      current_price REAL,
      predicted_direction TEXT,
      expiration_time TEXT,
      signal_score INTEGER,
      indicators TEXT,
      has_gaps INTEGER DEFAULT 0,    /* 0 = false, 1 = true */
      gap_duration INTEGER DEFAULT 0
    );
  `);

  const symbols = [
    "frxAUDCAD",
    "frxAUDCHF",
    "frxAUDJPY",
    "frxAUDNZD",
    "frxAUDUSD",
    "frxEURAUD",
    "frxEURCAD",
    "frxEURCHF",
    "frxEURGBP",
    "frxEURJPY",
    "frxEURNZD",
    "frxEURUSD",
    "frxGBPAUD",
    "frxGBPCAD",
    "frxGBPCHF",
    "frxGBPJPY",
    "frxGBPNZD",
    "frxGBPUSD",
    "frxNZDJPY",
    "frxUSDSEK",
    "frxUSDCAD",
    "frxUSDJPY",
    "frxUSDMXN",
    "frxUSDNOK",
    "frxUSDPLN",
  ];

  const symbolData = {};
  const calculationCache = new Map();

  // Inicializar dados para cada símbolo
  symbols.forEach((symbol) => {
    symbolData[symbol] = {
      ticks: [],
      successfulPredictions: 0,
      totalPredictions: 0,
      lastPredictionTime: 0,
      result: null,
      predictions: [],
    };
  });

  // Solicitar ticks
  function requestTicks(symbol, socket) {
    const requestMessage = {
      ticks: symbol,
      subscribe: 1,
    };
    socket.send(JSON.stringify(requestMessage));
  }

  // Funções auxiliares
  function calculateVolatility(prices) {
    const returns = prices
      .slice(1)
      .map((price, i) => Math.log(price / prices[i]));
    return Math.sqrt(
      returns.reduce((sum, ret) => sum + ret * ret, 0) / returns.length
    );
  }

  function calculateExpirationTime(prices) {
    const volatility = calculateVolatility(prices);
    if (volatility > 0.5) return "1 minuto";
    if (volatility > 0.3) return "3 minutos";
    return "5 minutos";
  }

  function isDataValid(ticks) {
    if (ticks.length < MINIMUM_TICKS) return false;

    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i].epoch - ticks[i - 1].epoch > MAX_GAP) return false;
    }

    return true;
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
    const inputRSI = {
      values: prices,
      period: period,
    };
    return RSI.calculate(inputRSI);
  }

  function calculateBollingerBands(prices, period = 20) {
    const input = {
      period: period,
      values: prices,
      stdDev: 2,
    };
    return BollingerBands.calculate(input);
  }

  function analyzeTrend(prices) {
    const sma20 = SMA.calculate({ period: 20, values: prices });
    const sma50 = SMA.calculate({ period: 50, values: prices });

    const lastSMA20 = sma20[sma20.length - 1];
    const lastSMA50 = sma50[sma50.length - 1];

    return {
      isTrendStrong: Math.abs(lastSMA20 - lastSMA50) > lastSMA50 * 0.001,
      trendDirection: lastSMA20 > lastSMA50 ? "UP" : "DOWN",
    };
  }

  function getCachedCalculation(symbol, type) {
    const key = `${symbol}_${type}`;
    if (calculationCache.has(key)) {
      const cached = calculationCache.get(key);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.value;
      }
    }
    return null;
  }

  function setCachedCalculation(symbol, type, value) {
    const key = `${symbol}_${type}`;
    calculationCache.set(key, {
      timestamp: Date.now(),
      value: value,
    });
  }

  // Adicione try/catch nas operações do banco
  function logPrediction(symbol, prediction, hasGaps = false, gapDuration = 0) {
    try {
      const stmt = db.prepare(`
        INSERT INTO predictions (
          symbol, current_price, predicted_direction, 
          expiration_time, signal_score, indicators,
          has_gaps, gap_duration
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        symbol,
        prediction.currentPrice,
        prediction.predictedDirection,
        prediction.expirationSuggestion,
        prediction.signalScore,
        JSON.stringify(prediction.indicators),
        hasGaps ? 1 : 0, // Converte boolean para INTEGER
        gapDuration
      );
    } catch (error) {
      console.error("Erro ao salvar predição:", error);
      console.error("Dados da predição:", {
        symbol,
        prediction,
        hasGaps,
        gapDuration,
      });
    }
  }

  function validatePrediction(prediction) {
    return (
      prediction &&
      typeof prediction.currentPrice === "number" &&
      typeof prediction.predictedDirection === "string" &&
      typeof prediction.signalScore === "number" &&
      prediction.signalScore >= 0 &&
      prediction.accuracy >= 0 &&
      prediction.accuracy <= 100
    );
  }

  // Função para calcular previsões
  function calculatePredictions(symbol) {
    const now = Date.now();
    const data = symbolData[symbol];

    // Verifica se há ticks suficientes
    if (data.ticks.length < MIN_TICKS_FOR_CALCULATION) {
      console.log(
        `${symbol}: Ticks insuficientes para cálculo (${data.ticks.length}/${MIN_TICKS_FOR_CALCULATION})`
      );
      return;
    }

    // Verifica gaps nos dados
    const gaps = findDataGaps(data.ticks);
    if (gaps.length > 0) {
      console.log(`${symbol}: Gaps encontrados nos dados:`, gaps);
      // Decide se deve prosseguir com base no tamanho dos gaps
      if (gaps.some((gap) => gap > 60)) {
        // gaps maiores que 60 segundos
        console.log(`${symbol}: Gaps muito grandes, aguardando mais dados`);
        return;
      }
    }

    if (!isDataValid(data.ticks)) return;

    const latestTicks = data.ticks.slice(-TICK_HISTORY_SIZE);
    const prices = latestTicks.map((tick) => tick.quote);

    // Verificar cache
    const cachedResult = getCachedCalculation(symbol, "prediction");
    if (cachedResult) return cachedResult;

    // Cálculos técnicos
    const emaShort = calculateEMA(prices, 12);
    const emaLong = calculateEMA(prices, 26);
    const macd = emaShort
      .slice(-emaLong.length)
      .map((ema, index) => ema - emaLong[index]);
    const macdSignal = calculateEMA(macd, 9);
    const rsi = calculateRSI(prices);
    const trend = analyzeTrend(prices);

    const lastPrice = prices[prices.length - 1];
    const predictedDirection =
      macd[macd.length - 1] > macdSignal[macdSignal.length - 1]
        ? "Comprar"
        : "Vender";

    const signalScore = calculateSignalScore(
      prices,
      macd[macd.length - 1],
      rsi[rsi.length - 1],
      trend
    );
    const expirationSuggestion = calculateExpirationTime(prices);

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

    const prediction = {
      symbol: symbol,
      currentPrice: lastPrice,
      lastTickTime: lastTickTime.toLocaleTimeString(),
      possibleEntryTime: possibleEntryTime.toLocaleTimeString(),
      predictedDirection: predictedDirection,
      expirationSuggestion: expirationSuggestion,
      accuracy: accuracy.toFixed(2),
      signalScore: signalScore,
      indicators: {
        macd: macd[macd.length - 1],
        rsi: rsi[rsi.length - 1],
        trend: trend.trendDirection,
        isTrendStrong: trend.isTrendStrong,
      },
    };

    if (!validatePrediction(prediction)) {
      console.error(`Predição inválida para ${symbol}:`, prediction);
      return;
    }

    // Salvar no cache
    setCachedCalculation(symbol, "prediction", prediction);

    // Logar previsão
    if (signalScore >= 2) {
      logPrediction(symbol, prediction);
    }

    data.result = prediction;
    data.lastPredictionTime = now;
  }

  function calculateSignalScore(prices, macd, rsi, trend) {
    let score = 0;

    // MACD
    if (macd > 0) score += 1;

    // RSI
    if (rsi < 30 || rsi > 70) score += 1;

    // Tendência
    if (trend.isTrendStrong) score += 1;

    // Bollinger Bands
    const bb = calculateBollingerBands(prices);
    const lastBB = bb[bb.length - 1];
    const lastPrice = prices[prices.length - 1];

    if (lastPrice < lastBB.lower || lastPrice > lastBB.upper) score += 1;

    return score;
  }

  function connectWebSocket() {
    const app_id = process.env.APP_ID || 1089;
    let socket = new WebSocket(
      `wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`
    );

    socket.onopen = () => {
      console.log("Conectado ao WebSocket da Deriv");
      const offlinePeriod = (Date.now() - lastConnectionTime) / 1000;

      // Se ficou offline por mais de 15 minutos, solicita histórico mais antigo
      const historyPeriod = Math.min(
        Math.max(offlinePeriod, OFFLINE_RECOVERY_PERIOD),
        24 * 60 * 60 // máximo de 24 horas
      );

      symbols.forEach((symbol) => {
        requestHistory(symbol, socket, historyPeriod);
        requestTicks(symbol, socket);
      });

      lastConnectionTime = Date.now();
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
          symbolData[symbol].ticks = symbolData[symbol].ticks.slice(
            -TICK_HISTORY_SIZE
          );
          calculatePredictions(symbol);
        }
      } else if (message.history) {
        const { symbol, history } = message;
        if (symbolData[symbol]) {
          const fifteenMinutesAgoEpoch = Math.floor(Date.now() / 1000) - 15 * 60;
          symbolData[symbol].ticks = history
            .filter((tick) => tick.epoch >= fifteenMinutesAgoEpoch)
            .slice(-TICK_HISTORY_SIZE);
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
  function requestHistory(symbol, socket, period) {
    const requestMessage = {
      ticks_history: symbol,
      end: "latest",
      start: Math.floor(Date.now() / 1000 - period),
      style: "ticks",
      adjust_start_time: 1,
    };
    socket.send(JSON.stringify(requestMessage));
  }

  function requestTicks(symbol, socket) {
    const requestMessage = {
      ticks: symbol,
      subscribe: 1,
    };
    socket.send(JSON.stringify(requestMessage));
  }
  function findDataGaps(ticks) {
    const gaps = [];
    for (let i = 1; i < ticks.length; i++) {
      const timeDiff = ticks[i].epoch - ticks[i - 1].epoch;
      if (timeDiff > 5) {
        // gap maior que 5 segundos
        gaps.push(timeDiff);
      }
    }
    return gaps;
  }

  function clearOldCache() {
    const now = Date.now();
    for (const [key, value] of calculationCache.entries()) {
      if (now - value.timestamp > CACHE_DURATION) {
        calculationCache.delete(key);
      }
    }
  }

  // Adicione limpeza periódica do cache
  setInterval(clearOldCache, CACHE_DURATION);

  // Rotas
  app.get("/get", (req, res) => {
    const results = Object.values(symbolData)
      .map((data) => data.result)
      .filter((result) => result !== null && result.signalScore >= 2);

    if (results.length > 0) {
      res.json(results);
    } else {
      res.json([]);
    }
  });

  // Adicione esta rota para verificação de conexão
  app.get("/ping", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.get("/statistics", (req, res) => {
    const stmt = db.prepare(`
        SELECT 
            symbol,
            COUNT(*) as total_predictions,
            AVG(signal_score) as avg_score
        FROM predictions
        WHERE timestamp > datetime('now', '-24 hour')
        GROUP BY symbol
    `);

    const statistics = stmt.all();
    res.json(statistics);
  });

  app.get("/", (req, res) => {
    res.sendFile(
      path.join(__dirname, "../../client", "indexPredictionsBinary.html")
    );
  });

  app.get("/sound2.mp3", (req, res) => {
    res.sendFile(path.join(__dirname, "../../client", "sound2.mp3"));
  });

  // Adicione uma rota para verificar o status do sistema
  app.get("/status", (req, res) => {
    const status = {
      uptime: process.uptime(),
      lastConnectionTime,
      symbolsStatus: {},
    };

    symbols.forEach((symbol) => {
      const data = symbolData[symbol];
      status.symbolsStatus[symbol] = {
        tickCount: data.ticks.length,
        lastTickTime:
          data.ticks.length > 0 ? data.ticks[data.ticks.length - 1].epoch : null,
        hasGaps: findDataGaps(data.ticks).length > 0,
      };
    });

    res.json(status);
  });

  // Iniciar a conexão do WebSocket
  //connectWebSocket();

  module.exports = app;
