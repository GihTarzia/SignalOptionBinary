const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const db = require("../config/database");
const MarketAnalyzer = require("../services/MarketAnalyzer");
const NotificationService = require("../services/NotificationService");
const RiskManager = require("../models/RiskManager");
const moment = require("moment");
const app = express.Router();
const riskManager = new RiskManager(1000); // Saldo inicial de 1000

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

symbols.forEach((symbol) => {
  symbolData[symbol] = {
    ticks: [],
    signals: [],
    analysis: {},
    performance: {
      wins: 0,
      losses: 0,
      totalTrades: 0,
    },
  };
});

async function processMarketData(symbol, tick) {
  try {
      const data = symbolData[symbol];
      data.ticks.push(tick);

      if (data.ticks.length > 100) {
          data.ticks.shift();
      }

      if (data.ticks.length >= 30) {
          const prices = data.ticks.map(t => t.quote);
          const analysis = await MarketAnalyzer.analyzeTrend(prices);

          if (analysis.confidence > 0.8) {
              // Usar generateSignal para criar o sinal base
              const baseSignal = generateSignal(symbol, analysis);
              
              // Adicionar informações adicionais ao sinal
              const currentTime = moment();
              const entryTime = moment(currentTime).add(30, 'seconds');
              const expirationMinutes = determineExpirationTime(analysis.confidence);
              const expirationTime = moment(entryTime).add(expirationMinutes, 'minutes');

              // Combinar o sinal base com as informações adicionais
              const signal = {
                  ...baseSignal,
                  currentTime: currentTime.format('HH:mm:ss'),
                  entryTime: entryTime.format('HH:mm:ss'),
                  expirationTime: expirationTime.format('HH:mm:ss'),
                  expirationMinutes: expirationMinutes,
                  timeToEntry: '30 segundos',
                  timeFrame: `${expirationMinutes} minutos`,
                  stopLoss: baseSignal.direction === 'CALL' ? 
                      baseSignal.entryPrice * 0.997 : baseSignal.entryPrice * 1.003,
                  takeProfit: baseSignal.direction === 'CALL' ? 
                      baseSignal.entryPrice * 1.005 : baseSignal.entryPrice * 0.995
              };

              const position = riskManager.calculatePositionSize(signal.confidence);
              
              if (position.amount > 0) {
                  signal.amount = position.amount;
                  await saveSignal(signal);
                  await NotificationService.sendSignal(signal);
                  symbolData[symbol].signals.push(signal);

                  console.log(`Novo sinal gerado para ${symbol}:`, {
                      direction: signal.direction,
                      confidence: signal.confidence,
                      currentTime: signal.currentTime,
                      entryTime: signal.entryTime,
                      expirationTime: signal.expirationTime,
                      timeFrame: signal.timeFrame,
                      price: signal.entryPrice.toFixed(5)
                  });
              }
          }
      }
  } catch (error) {
      console.error(`Erro ao processar dados do mercado para ${symbol}:`, error);
  }
}

// Função para determinar o tempo de expiração baseado na confiança
function determineExpirationTime(confidence) {
  if (confidence > 0.95) return 1; // 1 minuto para sinais muito fortes
  if (confidence > 0.9) return 2; // 2 minutos para sinais fortes
  if (confidence > 0.85) return 3; // 3 minutos para sinais bons
  return 5; // 5 minutos para outros sinais
}

function generateSignal(symbol, trend) {
  const currentPrice = symbolData[symbol].ticks[symbolData[symbol].ticks.length - 1].quote;
  
  return {
      symbol,
      direction: trend.direction === 'up' ? 'CALL' : 'PUT',
      entryPrice: currentPrice,
      confidence: trend.confidence,
      strength: trend.strength || 0,
      timestamp: Date.now()
  };
}

async function saveSignal(signal) {
  return new Promise((resolve, reject) => {
    db.run(
      `
            INSERT INTO signals (
                symbol, entry_time, direction, entry_price, 
                expiration_time, confidence
            ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      [
        signal.symbol,
        moment(signal.entryTime, "HH:mm:ss").unix(),
        signal.direction,
        signal.entryPrice,
        moment(signal.expirationTime, "HH:mm:ss").unix(),
        signal.confidence,
      ],
      function (err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

function connectWebSocket() {
  const app_id = process.env.APP_ID || 1089;
  const socket = new WebSocket(
    `wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`
  );

  socket.onopen = () => {
    console.log("Conectado ao WebSocket da Deriv");
    symbols.forEach((symbol) => {
      socket.send(
        JSON.stringify({
          ticks: symbol,
          subscribe: 1,
        })
      );
    });
  };

  socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);

    if (message.tick) {
      const { symbol, quote, epoch } = message.tick;
      await processMarketData(symbol, { quote, epoch });
    }
  };

  socket.onerror = (error) => {
    console.error("Erro no WebSocket:", error);
  };

  socket.onclose = () => {
    console.log("Conexão WebSocket fechada, reconectando...");
    setTimeout(connectWebSocket, 5000);
  };
}

// Rotas da API
app.get("/signals", (req, res) => {
  const activeSignals = Object.values(symbolData)
    .flatMap((data) => data.signals)
    .filter((signal) =>
      moment(signal.expirationTime, "HH:mm:ss").isAfter(moment())
    );
  res.json(activeSignals);
});

app.get("/performance", (req, res) => {
  db.all(
    `
        SELECT 
            symbol,
            COUNT(*) as total_trades,
            SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
            ROUND(AVG(confidence) * 100, 2) as avg_confidence
        FROM signals
        GROUP BY symbol
    `,
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../client", "index.html"));
});

// Inicialização
async function initialize() {
  await MarketAnalyzer.initialize();
  connectWebSocket();
}

initialize().catch(console.error);

module.exports = app;
