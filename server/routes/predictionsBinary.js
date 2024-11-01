const express = require("express");
const app = express.Router();
const puppeteer = require("puppeteer-core");
const Database = require("better-sqlite3");
const { RSI, BollingerBands, SMA } = require("technicalindicators");
const path = require("path");

// Configurações
const TICK_HISTORY_SIZE = 200;
const MINIMUM_TICKS = 50;

let browser;
let page;

// Inicializar banco de dados
const db = new Database("predictions.db");
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_predictions_symbol ON predictions(symbol);
  CREATE INDEX IF NOT EXISTS idx_predictions_timestamp ON predictions(timestamp);
`);
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
      has_gaps INTEGER DEFAULT 0,
      gap_duration INTEGER DEFAULT 0
    );
`);

// Mapeamento de símbolos IQ Option
const symbolMapping = {
  1: "EURUSD-OTC",
  2: "EURGBP-OTC",
  3: "GBPJPY-OTC",
  4: "EURJPY-OTC",
  5: "GBPUSD-OTC",
  6: "USDJPY-OTC",
  7: "AUDCAD-OTC",
  8: "NZDUSD-OTC",
  9: "EURJPY-OTC",
  10: "AUDUSD-OTC",
};



const symbolData = {};

// Inicializar dados para cada símbolo
Object.values(symbolMapping).forEach((symbol) => {
  symbolData[symbol] = {
    ticks: [],
    successfulPredictions: 0,
    totalPredictions: 0,
    lastPredictionTime: 0,
    result: null,
    predictions: [],
  };
});

// Função para encontrar o caminho do Edge
function getEdgePath() {
  const defaultPath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const defaultPath2 = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe";
  
  if (require('fs').existsSync(defaultPath)) {
      return defaultPath;
  } else if (require('fs').existsSync(defaultPath2)) {
      return defaultPath2;
  }
  
  throw new Error('Edge não encontrado');
}

async function initializeBrowser() {
  try {
      browser = await puppeteer.launch({
          headless: true,
          executablePath: getEdgePath(),
          args: [
              "--no-sandbox",
              "--disable-setuid-sandbox",
              "--disable-web-security",
              "--disable-features=IsolateOrigins,site-per-process"
          ],
          defaultViewport: { width: 1366, height: 768 }
      });

      page = await browser.newPage();

      // Configurar User Agent específico do Edge
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0');

      // Adicionar tratamento de erro para a página
      page.on("error", (err) => {
          console.error("Erro na página:", err);
          reinitializeBrowser();
      });

      page.on("close", () => {
          console.log("Página fechada, reinicializando...");
          reinitializeBrowser();
      });

      // Login na IQ Option com espera explícita
      console.log("Iniciando processo de login...");
      await page.goto("https://login.iqoption.com/pt/login", {
          waitUntil: "networkidle0",
          timeout: 60000
      });

      // Log para debug
      console.log("Página carregada, procurando elementos de login...");

      // Aguardar e verificar se os elementos existem
      const emailSelector = 'input[type="text"]';
      const passwordSelector = 'input[type="password"]';

      await page.waitForSelector(emailSelector, { timeout: 30000 });
      await page.waitForSelector(passwordSelector, { timeout: 30000 });

      console.log("Elementos de login encontrados, preenchendo dados...");

      // Realizar o login
      await page.type(emailSelector, 'gi.tarzia@hotmail.com');
      await page.type(passwordSelector, 'Tarzia!1!');

      // Encontrar e clicar no botão de login
      const submitButton = await page.waitForSelector('button[type="submit"]');
      await submitButton.click();

      console.log("Dados preenchidos, aguardando navegação...");

      // Aguardar login completo
      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 });

      // Verificar se o login foi bem-sucedido
      const isLoggedIn = await page.evaluate(() => {
          return !document.querySelector('input[type="email"]');
      });

      if (!isLoggedIn) {
          throw new Error("Falha no login");
      }

      console.log("Login realizado com sucesso");

      // Capturar o WebSocket
      const cdpSession = await page.target().createCDPSession();
      await cdpSession.send("Network.enable");

      cdpSession.on("Network.webSocketFrameReceived", (frame) => {
          try {
              const data = JSON.parse(frame.response.payloadData);
              processIQOptionData(data);
          } catch (e) {
              // Ignora frames que não são JSON
          }
      });

      console.log("Browser inicializado e logado com sucesso");
  } catch (error) {
      console.error("Erro ao inicializar browser:", error);
      console.error("Detalhes do erro:", error.message);
      await reinitializeBrowser();
  }
}

async function reinitializeBrowser() {
  try {
      console.log("Iniciando processo de reinicialização...");
      
      if (page) {
          console.log("Fechando página existente...");
          await page.removeAllListeners();
          await page.close().catch(e => console.log("Erro ao fechar página:", e.message));
      }
      
      if (browser) {
          console.log("Fechando browser existente...");
          await browser.close().catch(e => console.log("Erro ao fechar browser:", e.message));
      }

      console.log("Browser e página fechados, aguardando para reiniciar...");
      setTimeout(initialize, 5000);
  } catch (e) {
      console.error("Erro durante reinicialização:", e);
      setTimeout(initialize, 5000);
  }
}

function processIQOptionData(data) {
  if (!data || !data.name || !data.msg) return;

  if (data.name === "candle-generated") {
    const { active_id, close, time } = data.msg;

    if (!active_id || !close || !time) {
      console.error("Dados inválidos recebidos:", data);
      return;
    }

    const symbol = getSymbolById(active_id);
    if (!symbol) return;

    if (symbolData[symbol]) {
      const tick = {
        quote: parseFloat(close),
        epoch: Math.floor(time / 1000),
      };

      // Validar se o tick é recente
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime - tick.epoch > 60) return; // ignorar dados muito antigos

      symbolData[symbol].ticks.push(tick);
      symbolData[symbol].ticks = symbolData[symbol].ticks.slice(
        -TICK_HISTORY_SIZE
      );

      const prediction = calculatePredictions(symbol);
      if (prediction) {
        symbolData[symbol].result = prediction;
      }
    }
  }
}
function getSymbolById(id) {
  return symbolMapping[id] || null;
}

// Funções de cálculo
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

function calculatePredictions(symbol) {
  const data = symbolData[symbol];

  if (data.ticks.length < MINIMUM_TICKS) {
    return null;
  }

  const prices = data.ticks
    .map((tick) => tick.quote)
    .filter((price) => !isNaN(price) && price > 0);

  if (prices.length < MINIMUM_TICKS) {
    console.log(`${symbol}: Preços inválidos encontrados`);
    return null;
  }
  // Cálculos técnicos
  const rsi = calculateRSI(prices);
  const bb = calculateBollingerBands(prices);
  const trend = analyzeTrend(prices);

  const lastPrice = prices[prices.length - 1];
  const lastBB = bb[bb.length - 1];
  const lastRSI = rsi[rsi.length - 1];

  let predictedDirection;
  let signalStrength = 0;

  // Lógica de previsão
  if (lastPrice < lastBB.lower && lastRSI < 30) {
    predictedDirection = "CALL";
    signalStrength++;
  } else if (lastPrice > lastBB.upper && lastRSI > 70) {
    predictedDirection = "PUT";
    signalStrength++;
  }

  if (trend.isTrendStrong) {
    signalStrength++;
    if (trend.trendDirection === "UP" && predictedDirection === "CALL")
      signalStrength++;
    if (trend.trendDirection === "DOWN" && predictedDirection === "PUT")
      signalStrength++;
  }

  const now = new Date();
  const prediction = {
    symbol: symbol,
    currentPrice: lastPrice,
    lastTickTime: now.toLocaleTimeString(),
    possibleEntryTime: new Date(now.getTime() + 30000).toLocaleTimeString(),
    predictedDirection: predictedDirection,
    expirationTime: calculateExpirationTime(prices),
    signalScore: signalStrength,
    indicators: {
      rsi: lastRSI,
      bb: lastBB,
      trend: trend.trendDirection,
      isTrendStrong: trend.isTrendStrong,
    },
  };

  // Calcular accuracy baseado em previsões anteriores
  const stmt = db.prepare(`
      SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN predicted_direction = ? THEN 1 ELSE 0 END) as same_direction
      FROM predictions 
      WHERE symbol = ? 
      AND timestamp > datetime('now', '-1 hour')
  `);

  const stats = stmt.get(predictedDirection, symbol);
  prediction.accuracy =
    stats.total > 0
      ? ((stats.same_direction / stats.total) * 100).toFixed(2)
      : "N/A";

  if (signalStrength >= 2) {
    logPrediction(symbol, prediction);
  }

  data.result = prediction;
  data.lastPredictionTime = now.getTime();

  return prediction;
}

function logPrediction(symbol, prediction) {
  try {
    console.log(`Nova previsão para ${symbol}:`, {
      direction: prediction.predictedDirection,
      score: prediction.signalScore,
      expiration: prediction.expirationTime,
    });

    const stmt = db.prepare(`
          INSERT INTO predictions (
              symbol,
              current_price,
              predicted_direction,
              expiration_time,
              signal_score,
              indicators,
              timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);

    stmt.run(
      symbol,
      prediction.currentPrice,
      prediction.predictedDirection,
      prediction.expirationTime,
      prediction.signalScore,
      JSON.stringify(prediction.indicators)
    );
  } catch (error) {
    console.error("Erro ao salvar predição:", error);
    console.error("Dados da predição:", prediction);
  }
}

// Rotas
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../../client", "indexPredictionsBinary.html")
  );
});
app.get("/sound2.mp3", (req, res) => {
  res.sendFile(path.join(__dirname, "../../client", "sound2.mp3"));
});
app.get("/predictions", (req, res) => {
  const predictions = Object.values(symbolData)
    .map((data) => data.result)
    .filter((result) => result && result.signalScore >= 2);

  res.json(predictions);
});
app.get("/statistics", (req, res) => {
  const stmt = db.prepare(`
      SELECT 
          symbol,
          COUNT(*) as total_predictions,
          AVG(signal_score) as avg_score,
          SUM(CASE WHEN predicted_direction = 'CALL' THEN 1 ELSE 0 END) as total_calls,
          SUM(CASE WHEN predicted_direction = 'PUT' THEN 1 ELSE 0 END) as total_puts
      FROM predictions
      WHERE timestamp > datetime('now', '-24 hour')
      GROUP BY symbol
  `);

  const statistics = stmt.all();
  res.json(statistics);
});
app.get("/status", (req, res) => {
  res.json({
    connected: browser && page,
    symbols: Object.keys(symbolData).map((symbol) => ({
      symbol,
      tickCount: symbolData[symbol].ticks.length,
      lastUpdate:
        symbolData[symbol].ticks[symbolData[symbol].ticks.length - 1]?.epoch,
      lastPrediction: symbolData[symbol].lastPredictionTime,
    })),
  });
});
app.get("/health", (req, res) => {
  const isHealthy =
    browser &&
    page &&
    Object.values(symbolData).some((data) => data.ticks.length > 0);

  if (isHealthy) {
    res.status(200).json({ status: "healthy" });
  } else {
    res.status(503).json({
      status: "unhealthy",
      browser: !!browser,
      page: !!page,
      hasData: Object.values(symbolData).some((data) => data.ticks.length > 0),
    });
  }
});

// Inicialização
async function initialize() {
  await initializeBrowser();
  console.log("Sistema inicializado");
}

function cleanOldData() {
  try {
    const stmt = db.prepare(`
          DELETE FROM predictions 
          WHERE timestamp < datetime('now', '-24 hour')
      `);
    stmt.run();
  } catch (error) {
    console.error("Erro ao limpar dados antigos:", error);
  }
}

// Adicione ao final do arquivo
setInterval(cleanOldData, 60 * 60 * 1000); // Limpa dados a cada hora

function cleanupMemory() {
  // Limitar o tamanho do histórico para cada símbolo
  Object.values(symbolData).forEach((data) => {
    if (data.predictions.length > 1000) {
      data.predictions = data.predictions.slice(-500);
    }
  });
}

setInterval(cleanupMemory, 5 * 60 * 1000); // Limpa a cada 5 minutos

// Iniciar o sistema
initialize();

module.exports = app;
