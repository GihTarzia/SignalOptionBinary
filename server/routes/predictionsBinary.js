const express = require("express");
const app = express.Router();
const puppeteer = require("puppeteer-core");
const Database = require("better-sqlite3");
const {
  RSI,
  BollingerBands,
  SMA,
  MACD,
  WilliamsR,
  ADX,
} = require("technicalindicators");
const path = require("path");

// Configurações
const TICK_HISTORY_SIZE = 300;
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
  // Forex OTC (Binary Options)
  76: "EURUSD-OTC",
  2133: "EURGBP",
  4: "EURJPY",
  84: "GBPJPY-OTC",
  5: "GBPUSD",
  85: "USDJPY-OTC",
  7: "AUDCAD",
  8: "NZDUSD",
  9: "USDCHF-OTC", //Não existe
  2111: "AUDUSD-OTC",
  2112: "USDCAD-OTC",
  2120: "EURAUD-OTC",
  2116: "GBPAUD-OTC",
  2114: "GBPCAD-OTC",
  2115: "GBPCHF-OTC",
  2129: "AUDCHF-OTC",
  2113: "AUDJPY-OTC",
  2130: "AUDNZD-OTC",
  2118: "CHFJPY-OTC",
  2117: "EURCAD-OTC",
  2131: "EURCHF-OTC",
  2122: "EURNZD-OTC",
  2137: "NZDCAD-OTC",
  2202: "NZDCHF-OTC",
  2138: "NZDJPY-OTC",
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
  const defaultPath =
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const defaultPath2 =
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe";

  if (require("fs").existsSync(defaultPath)) {
    return defaultPath;
  } else if (require("fs").existsSync(defaultPath2)) {
    return defaultPath2;
  }

  throw new Error("Edge não encontrado");
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
        "--disable-features=IsolateOrigins,site-per-process",
      ],
      defaultViewport: { width: 1366, height: 768 },
    });

    page = await browser.newPage();

    // Configurar User Agent específico do Edge
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
    );

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
      timeout: 60000,
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
    await page.type(emailSelector, "gi.tarzia@hotmail.com");
    await page.type(passwordSelector, "Tarzia!1!");

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

    // Capturar o WebSocket com mais logs
    const cdpSession = await page.target().createCDPSession();
    await cdpSession.send("Network.enable");

    console.log("WebSocket habilitado, configurando listeners...");

    // Adicionar listener para conexões WebSocket
    cdpSession.on("Network.webSocketCreated", ({ requestId, url }) => {
      console.log("WebSocket criado:", url);
    });

    // Listener para frames recebidos
    cdpSession.on("Network.webSocketFrameReceived", (params) => {
      try {
        console.log("Frame WebSocket recebido");
        const data = JSON.parse(params.response.payloadData);

        // Ignorar mensagens de timeSync
        if (data.name === "timeSync") return;
        console.log("Dados recebidos:", JSON.stringify(data).slice(0, 200)); // Log parcial dos dados
        processIQOptionData(data);
      } catch (e) {
        console.log("Erro ao processar frame:", e.message);
      }
    });

    // Listener para erros
    cdpSession.on("Network.webSocketFrameError", (params) => {
      console.error("Erro no WebSocket:", params);
    });

    // Listener para frames enviados
    cdpSession.on("Network.webSocketFrameSent", (params) => {
      console.log("Frame WebSocket enviado");
    });

    // Após login bem-sucedido, navegar para a página de trading
    await page.goto("https://iqoption.com/traderoom", {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    // Subscrever aos candles
    for (const symbolId of Object.keys(symbolMapping)) {
      const subscribeMessage = {
        name: "subscribeMessage",
        msg: {
          name: "candle-generated",
          params: {
            routingFilters: {
              active_id: parseInt(symbolId),
              size: 1,
            },
          },
        },
      };

      // Injetar o script para enviar a mensagem de subscrição
      await page.evaluate((msg) => {
        if (window.ws) {
          window.ws.send(JSON.stringify(msg));
        }
      }, subscribeMessage);

      console.log(`Subscrito ao símbolo ${symbolMapping[symbolId]}`);
    }

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
      await page
        .close()
        .catch((e) => console.log("Erro ao fechar página:", e.message));
    }

    if (browser) {
      console.log("Fechando browser existente...");
      await browser
        .close()
        .catch((e) => console.log("Erro ao fechar browser:", e.message));
    }

    console.log("Browser e página fechados, aguardando para reiniciar...");
    setTimeout(initialize, 5000);
  } catch (e) {
    console.error("Erro durante reinicialização:", e);
    setTimeout(initialize, 5000);
  }
}

function processIQOptionData(data) {
  if (!data || !data.name) {
    console.log("Dados inválidos ou incompletos");
    return;
  }

  if (data.name === "candle-generated" && data.msg) {
    const { active_id, close, open, from, to, min, max, ask, bid } = data.msg;

    if (!active_id || !close) {
      console.log("Dados incompletos no candle");
      return;
    }

    const symbol = getSymbolById(active_id);
    if (!symbol) {
      console.log(
        `Símbolo não encontrado para ID ${active_id}, Simbolo: ${symbolE}`
      );
      return;
    }

    console.log(`Processando candle para ${symbol}`);

    if (symbolData[symbol]) {
      const tick = {
        quote: close,
        epoch: Math.floor(from),
        open: open,
        high: max,
        low: min,
        ask: ask,
        bid: bid,
      };

      // Verificar spread antes de processar o tick
      if (!isSpreadAcceptable(tick)) {
        console.log(`${symbol}: Spread muito alto, ignorando tick`);
        return;
      }
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime - tick.epoch > 60) {
        console.log(`Dados muito antigos para ${symbol}, ignorando`);
        return;
      }

      symbolData[symbol].ticks.push(tick);
      symbolData[symbol].ticks = symbolData[symbol].ticks.slice(
        -TICK_HISTORY_SIZE
      );

      console.log(
        `${symbol}: ${symbolData[symbol].ticks.length}/${MINIMUM_TICKS} ticks coletados`
      );

      // Se tiver dados suficientes, calcular previsão
      if (symbolData[symbol].ticks.length >= MINIMUM_TICKS) {
        const prediction = calculatePredictions(symbol);
        if (prediction) {
          console.log(`Nova previsão calculada para ${symbol}:`, {
            direction: prediction.predictedDirection,
            score: prediction.signalScore,
            price: prediction.currentPrice,
          });
          symbolData[symbol].result = prediction;
        }
      }
    }
  }
}

function getSymbolById(id) {
  return symbolMapping[id] || null;
}

// Funções de cálculo
function calculateVolatility(prices) {
  const meanPrice =
    prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const variance =
    prices.reduce((sum, price) => sum + Math.pow(price - meanPrice, 2), 0) /
    prices.length;
  return Math.sqrt(variance); // Retorna a volatilidade baseada no desvio padrão
}
function calculateExpirationTime(prices) {
  const volatility = calculateVolatility(prices);
  const vol = volatility * 100;

  if (vol > 0.005) return "1 minuto";
  if (vol > 0.003) return "2 minutos";
  if (vol > 0.002) return "3 minutos";
  return "5 minutos";
}
function isTrendFavorable(prices, direction) {
  const sma20 = SMA.calculate({ period: 20, values: prices });
  const sma50 = SMA.calculate({ period: 50, values: prices });
  const sma200 = SMA.calculate({ period: 200, values: prices });
  const ema9 = calculateEMA(prices, 9);

  const lastSMA20 = sma20[sma20.length - 1];
  const lastSMA50 = sma50[sma50.length - 1];
  const lastSMA200 = sma200[sma200.length - 1];
  const lastEMA9 = ema9[ema9.length - 1];

  if (direction === "CALL") {
    return (
      lastEMA9 > lastSMA20 && lastSMA20 > lastSMA50 && lastSMA50 > lastSMA200
    );
  } else {
    return (
      lastEMA9 < lastSMA20 && lastSMA20 < lastSMA50 && lastSMA50 < lastSMA200
    );
  }
}
function findSupportResistance(prices, period = 50) {
  const highs = Math.max(...prices.slice(-period));
  const lows = Math.min(...prices.slice(-period));
  const lastPrice = prices[prices.length - 1];

  const distanceToHigh = (highs - lastPrice) / lastPrice;
  const distanceToLow = (lastPrice - lows) / lastPrice;

  return { distanceToHigh, distanceToLow };
}

function calculateMACD(prices) {
  const macdInput = {
    values: prices,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  };
  const macd = MACD.calculate(macdInput);
  const lastMacd = macd[macd.length - 1];
  return lastMacd;
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
  const sma200 = SMA.calculate({ period: 200, values: prices }); // Adicionando SMA de 200 períodos
  const ema9 = calculateEMA(prices, 9);

  const lastSMA20 = sma20[sma20.length - 1];
  const lastSMA50 = sma50[sma50.length - 1];
  const lastSMA200 = sma200[sma200.length - 1];
  const lastEMA9 = ema9[ema9.length - 1];

  const trendStrength = Math.abs(lastSMA20 - lastSMA50) / lastSMA50;

  return {
    isTrendStrong: trendStrength > 0.0002,
    trendDirection: lastEMA9 > lastSMA20 ? "UP" : "DOWN",
    strength: trendStrength,
    longTermTrend: lastSMA50 > lastSMA200 ? "UP" : "DOWN",
  };
}
function hasSignificantGaps(prices) {
  for (let i = 1; i < prices.length; i++) {
    const gap = Math.abs(prices[i] - prices[i - 1]) / prices[i - 1];
    if (gap > 0.001) {
      // 0.1% gap
      return true;
    }
  }
  return false;
}

function analyzeSpread(ask, bid) {
  const spread = ask - bid;
  const spreadPercent = spread / bid;
  return spreadPercent < 0.0003; // 0.03% spread máximo
}
function isVolatilityAcceptable(prices) {
  const volatility = calculateVolatility(prices);
  // Ajustando para valores mais adequados para Forex OTC
  const minVolatility = 0.00005; // 0.0003% (mais realista)
  const maxVolatility = 0.025; // 1% (mais restritivo)

  const isAcceptable = volatility > minVolatility && volatility < maxVolatility;

  if (!isAcceptable) {
    console.log(
      `Volatilidade: ${(volatility * 100).toFixed(6)}% (min: ${(
        minVolatility * 100
      ).toFixed(6)}%, max: ${(maxVolatility * 100).toFixed(6)}%)`
    );
  }

  return isAcceptable;
}

function isSpreadAcceptable(tick) {
  if (!tick.ask || !tick.bid) return true; // Se não tiver spread, ignora o filtro

  const spread = (tick.ask - tick.bid) / tick.bid;
  const maxSpread = 0.002; // 0.1%

  const isAcceptable = spread <= maxSpread;
  if (!isAcceptable) {
    console.log(`Spread muito alto: ${(spread * 100).toFixed(4)}%`);
  }
  return isAcceptable;
}
function calculateFibonacciLevels(high, low) {
  return {
    level1: high - (high - low) * 0.236,
    level2: high - (high - low) * 0.382,
    level3: high - (high - low) * 0.618,
  };
}

function calculateWilliamsR(prices) {
  const williamsRInput = {
    high: symbolData[symbol].ticks.map((t) => t.high),
    low: symbolData[symbol].ticks.map((t) => t.low),
    close: symbolData[symbol].ticks.map((t) => t.quote),
    period: 14,
  };
  const williamsR = WilliamsR.calculate(williamsRInput);
  return williamsR[williamsR.length - 1];
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
  // Verificar gaps
  if (hasSignificantGaps(prices)) {
    console.log(`${symbol}: Gaps significativos detectados`);
    return null;
  }

  // Verificar movimento mínimo
  // No calculatePredictions
  const priceMovement =
    Math.abs(prices[prices.length - 1] - prices[prices.length - 10]) /
    prices[prices.length - 1];
  if (priceMovement < 0.00005) {
    // Reduzido de 0.0001
    console.log(`${symbol}: Movimento insuficiente`);
    return null;
  }
  const momentum = calculateMomentum(prices);
  const lastMomentum = momentum[momentum.length - 1];

  const volatility = calculateVolatility(prices);
  console.log(
    `${symbol} - Volatilidade atual: ${(volatility * 100).toFixed(6)}%`
  );

  if (!isVolatilityAcceptable(prices)) {
    console.log(`${symbol}: Volatilidade fora do range ideal`);
    return null;
  }

  // Cálculos técnicos
  const rsi = calculateRSI(prices);
  const bb = calculateBollingerBands(prices);
  const trend = analyzeTrend(prices);
  const macdValue = calculateMACD(prices);
  console.log(`MACD: ${macdValue.MACD}, Signal: ${macdValue.signal}`);
  const williamsRValue = calculateWilliamsR(prices);
  console.log(`Williams %R: ${williamsRValue}`);

  const dmiValue = calculateDMI(symbolData[symbol].ticks);
  console.log(
    `DMI: +DI ${dmiValue.plusDI}, -DI ${dmiValue.minusDI}, ADX ${dmiValue.adx}`
  );

  const lastPrice = prices[prices.length - 1];
  const lastBB = bb[bb.length - 1];
  const lastRSI = rsi[rsi.length - 1];

  let predictedDirection;
  let signalStrength = 0;

  // Ajustar condições de entrada
  if (lastPrice <= lastBB.lower * 1.0001) {
    // Reduzido de 1.0002
    predictedDirection = "CALL";
    signalStrength++;
    if (lastRSI < 40) signalStrength += 2;
    if (trend.longTermTrend === "UP") signalStrength++;
  } else if (lastPrice >= lastBB.upper * 0.9999) {
    predictedDirection = "PUT";
    signalStrength++;
    if (lastRSI > 60) signalStrength += 2;
    if (trend.longTermTrend === "DOWN") signalStrength++;
  }

  // Adicionar verificação de divergência
  const rsiTrend = lastRSI > rsi[rsi.length - 2] ? "UP" : "DOWN";
  if (predictedDirection === "CALL" && rsiTrend === "UP") signalStrength++;
  if (predictedDirection === "PUT" && rsiTrend === "DOWN") signalStrength++;

  const sr = findSupportResistance(prices);
  if (predictedDirection === "CALL" && sr.distanceToLow < 0.0005)
    signalStrength++;
  if (predictedDirection === "PUT" && sr.distanceToHigh < 0.0005)
    signalStrength++;

  if (Math.abs(lastMomentum) > 0.0001) {
    // 0.01%
    if (lastMomentum > 0 && predictedDirection === "CALL") signalStrength++;
    if (lastMomentum < 0 && predictedDirection === "PUT") signalStrength++;
  }

  // Aqui é onde adicionamos a verificação de tendência
  if (predictedDirection && isTrendFavorable(prices, predictedDirection)) {
    signalStrength += 2; // Adiciona mais peso se a tendência for favorável
    console.log(`${symbol}: Tendência favorável para ${predictedDirection}`);
  }

  // Verificações adicionais de momentum
  const shortTermTrend = prices.slice(-5).reduce((acc, price, i, arr) => {
    if (i === 0) return acc;
    return acc + (price - arr[i - 1]);
  }, 0);

  if (predictedDirection === "CALL" && shortTermTrend > 0) signalStrength++;
  if (predictedDirection === "PUT" && shortTermTrend < 0) signalStrength++;

  // Verificar spread se disponível
  const lastTick = data.ticks[data.ticks.length - 1];
  if (lastTick && analyzeSpread(lastTick.ask, lastTick.bid)) {
    signalStrength++;
  }

  // Log detalhado da análise
  console.log(`${symbol} Análise Detalhada:`, {
    preço: lastPrice,
    rsi: lastRSI.toFixed(2),
    bbBands: {
      superior: lastBB.upper.toFixed(5),
      média: lastBB.middle.toFixed(5),
      inferior: lastBB.lower.toFixed(5),
    },
    tendência: {
      direção: trend.trendDirection,
      força: trend.strength.toFixed(6),
    },
    pontuação: signalStrength,
  });

  // Retornar previsão apenas se tiver força suficiente
  if (
    signalStrength >= 2 &&
    isSignalQualityGood({
      predictedDirection,
      currentPrice: lastPrice,
      indicators: { rsi: lastRSI, bb: lastBB },
    })
  ) {
    const prediction = {
      symbol: symbol,
      currentPrice: lastPrice,
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

    logPrediction(symbol, prediction);
    return prediction;
  }

  return null;
}
function calculateMomentum(prices, period = 14) {
  const momentum = [];
  for (let i = period; i < prices.length; i++) {
    momentum.push(prices[i] - prices[i - period]);
  }
  return momentum;
}
function isSignalQualityGood(prediction) {
  if (!prediction || !prediction.indicators) return false;

  const rsi = prediction.indicators.rsi;
  const bb = prediction.indicators.bb;
  const price = prediction.currentPrice;

  if (prediction.predictedDirection === "CALL") {
    if (rsi > 45) return false; // Aumentado de 40
    if (price > bb.middle) return false;
  } else {
    if (rsi < 55) return false; // Reduzido de 60
    if (price < bb.middle) return false;
  }

  const priceDistance = Math.abs(price - bb.middle) / bb.middle;
  if (priceDistance < 0.0001) return false; // Reduzido de 0.0002

  return true;
}
function calculateDMI(ticks) {
  const dmiInput = {
    high: ticks.map((t) => t.high),
    low: ticks.map((t) => t.low),
    close: ticks.map((t) => t.quote),
    period: 14,
  };
  const dmi = ADX.calculate(dmiInput);
  return dmi[dmi.length - 1];
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
  try {
    const predictions = Object.entries(symbolData)
      .map(([symbol, data]) => {
        if (!data.result) return null;

        // Adicionar mais informações ao resultado
        return {
          ...data.result,
          lastUpdate: new Date().toISOString(),
          tickCount: data.ticks.length,
          hasEnoughData: data.ticks.length >= MINIMUM_TICKS,
        };
      })
      .filter(
        (result) =>
          result && result.predictedDirection && result.signalScore >= 2
      );

    console.log("Previsões disponíveis:", predictions.length);

    res.json({
      timestamp: new Date().toISOString(),
      count: predictions.length,
      predictions: predictions,
      status: {
        isCollectingData: true,
        minTicksRequired: MINIMUM_TICKS,
        symbolsTracked: Object.keys(symbolData).length,
      },
    });
  } catch (error) {
    console.error("Erro ao buscar previsões:", error);
    res.status(500).json({
      error: "Erro ao buscar previsões",
      message: error.message,
    });
  }
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
//setInterval(cleanOldData, 60 * 60 * 1000); // Limpa dados a cada hora

function cleanupMemory() {
  // Limitar o tamanho do histórico para cada símbolo
  Object.values(symbolData).forEach((data) => {
    if (data.predictions.length > 1000) {
      data.predictions = data.predictions.slice(-500);
    }
  });
}

//setInterval(cleanupMemory, 5 * 60 * 1000); // Limpa a cada 5 minutos

// Iniciar o sistema
initialize();

module.exports = app;
