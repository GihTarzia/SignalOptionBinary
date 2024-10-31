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

    // Log para verificar os ticks
    console.log(
      `Processando dados para ${symbol}. Ticks acumulados: ${data.ticks.length}`
    );

    if (data.ticks.length > 100) {
      data.ticks.shift();
    }

    if (data.ticks.length >= 30) {
      const prices = data.ticks.map((t) => t.quote);
      console.log(
        `Analisando ${symbol} - Último preço: ${prices[prices.length - 1]}`
      );

      const analysis = await MarketAnalyzer.analyzeTrend(prices);
      //console.log(`Análise para ${symbol}:`, analysis);

      // Reduzir o limite de confiança para 0.75 (75%)
      if (analysis && analysis.confidence > 0.75) {
        console.log(
          `Sinal forte detectado para ${symbol} com confiança ${analysis.confidence}`
        );

        // Adicionar verificações adicionais
        const isGoodSignal = verifySignalQuality(analysis.details);

        if (isGoodSignal) {
          const prediction = await MarketAnalyzer.predictNextMove(prices);

          if (prediction) {
            // Adicionar informações adicionais ao sinal
            const currentTime = moment();
            const entryTime = moment(currentTime).add(30, "seconds");
            const expirationMinutes = determineExpirationTime(
              prediction.confidence
            );
            const expirationTime = moment(entryTime).add(
              expirationMinutes,
              "minutes"
            );

            const signal = {
              symbol,
              direction: prediction.direction === "up" ? "ACIMA" : "ABAIXO",
              entryPrice: prediction.suggestedEntry,
              currentTime: currentTime.format("HH:mm:ss"),
              entryTime: entryTime.format("HH:mm:ss"),
              expirationTime: expirationTime.format("HH:mm:ss"),
              expirationMinutes: expirationMinutes,
              timeToEntry: "30 segundos",
              timeFrame: `${expirationMinutes} minutos`,
              confidence: prediction.confidence,
              stopLoss: prediction.stopLoss,
              takeProfit: prediction.takeProfit,
              indicators: prediction.indicators,
            };

            // Log detalhado do sinal
            console.log("Sinal gerado:", JSON.stringify(signal, null, 2));

            const position = riskManager.calculatePositionSize(
              signal.confidence
            );

            if (position.amount > 0) {
              signal.amount = position.amount;
              await saveSignal(signal);
              await NotificationService.sendSignal(signal);
              symbolData[symbol].signals.push(signal);

              // Log de confirmação
              console.log(`Sinal enviado com sucesso para ${symbol}`);
            }
          } else {
            console.log(`Sem previsão válida para ${symbol}`);
          }
        }
      } else {
        console.log(
          `Confiança insuficiente para ${symbol}: ${analysis?.confidence || 0}`
        );
      }
    } else {
      console.log(
        `Aguardando mais dados para ${symbol}. Necessário: 30, Atual: ${data.ticks.length}`
      );
    }
  } catch (error) {
    console.error(`Erro ao processar dados do mercado para ${symbol}:`, error);
  }
}
// Função para verificar a qualidade do sinal
function verifySignalQuality(details) {
  const { rsi, macd, bollinger } = details;

  // Para sinais de compra (ACIMA)
  if (rsi < 30) {
    // Sobrevendido
    return true;
  }

  // Para sinais de venda (ABAIXO)
  if (rsi > 70) {
    // Sobrecomprado
    return true;
  }

  // Verificar cruzamento MACD
  if (Math.abs(macd.MACD - macd.signal) < 0.00001) {
    return true;
  }

  // Verificar Bollinger Bands
  const price = bollinger.price;
  if (price <= bollinger.lower || price >= bollinger.upper) {
    return true;
  }

  return false;
}

// Função para determinar o tempo de expiração baseado na confiança
function determineExpirationTime(confidence) {
  if (confidence > 0.95) return 1; // 1 minuto para sinais muito fortes
  if (confidence > 0.9) return 2; // 2 minutos para sinais fortes
  if (confidence > 0.85) return 3; // 3 minutos para sinais bons
  return 5; // 5 minutos para outros sinais
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
function monitorSignals() {
  setInterval(() => {
    console.log("\n=== Status do Sistema ===");
    Object.keys(symbolData).forEach((symbol) => {
      const data = symbolData[symbol];
      console.log(`
              Símbolo: ${symbol}
              Ticks: ${data.ticks.length}
              Sinais Ativos: ${data.signals.length}
              Último Preço: ${data.ticks[data.ticks.length - 1]?.quote || "N/A"}
          `);
    });
  }, 60000); // Log a cada minuto
}

// Adicione na inicialização
async function initialize() {
  await MarketAnalyzer.initialize();
  connectWebSocket();
  monitorSignals();
}

initialize().catch(console.error);

module.exports = app;
