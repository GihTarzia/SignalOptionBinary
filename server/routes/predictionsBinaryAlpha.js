const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express.Router();
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY; // Coloque sua chave da API aqui

const symbolData = {};

// Função para obter todos os pares de moedas disponíveis na Alpha Vantage
async function getAvailableSymbols() {
  try {
    // Obter apenas uma vez para não sobrecarregar a API
    if (Object.keys(symbolData).length === 0) {
      const response = await axios.get(
        `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=USD&to_currency=EUR&apikey=${ALPHA_VANTAGE_API_KEY}`
      );

      // Para simplificação, usando apenas alguns pares, você pode expandir isso conforme necessário
      const availableSymbols = [
        "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD",
        "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY",
        "EURNZD", "EURUSD", "GBPAUD", "GBPCAD", "GBPCHF",
        "GBPJPY", "GBPNZD", "GBPUSD", "NZDJPY", "USDSEK",
        "USDCAD", "USDJPY", "USDMXN", "USDNOK", "USDPLN",
      ];

      availableSymbols.forEach((symbol) => {
        symbolData[symbol] = {
          ticks: [],
          successfulPredictions: 0,
          totalPredictions: 0,
          lastPredictionTime: 0,
          result: null,
        };
      });
    }
  } catch (error) {
    console.error("Erro ao obter símbolos disponíveis:", error);
  }
}

// Função para verificar se o mercado está aberto
function isMarketOpen() {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentDay = now.getUTCDay();
  
  // Horários de negociação do mercado Forex em UTC
  const marketOpenHour = 0; // 00:00 UTC
  const marketCloseHour = 23; // 23:00 UTC

  // O mercado está fechado aos sábados (6) e domingos (0)
  return currentDay !== 0 && currentDay !== 6 && (currentHour >= marketOpenHour && currentHour < marketCloseHour);
}

// Função para obter dados do Alpha Vantage
async function getSymbolData(symbol) {
    if (!isMarketOpen()) {
      console.log(`O mercado está fechado para ${symbol}.`);
      return; // Não busca dados se o mercado estiver fechado
    }
  
    try {
      const response = await axios.get(
        `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${symbol.slice(0, 3)}&to_currency=${symbol.slice(3)}&apikey=${ALPHA_VANTAGE_API_KEY}`
      );
  
      console.log(`Response for ${symbol}:`, response.data); // Adicione esta linha
  
      const exchangeRateData = response.data["Realtime Currency Exchange Rate"];
      if (!exchangeRateData) {
        console.error(`Nenhum dado disponível para ${symbol}. Resposta da API:`, response.data);
        return;
      }
  
      // Armazena a taxa de câmbio e outros dados que você precisar
      symbolData[symbol].ticks.push({
        epoch: Math.floor(Date.now() / 1000), // Timestamp atual
        quote: parseFloat(exchangeRateData["5. Exchange Rate"]),
      });
  
      calculatePredictions(symbol);
    } catch (error) {
      console.error(`Erro ao buscar dados para ${symbol}:`, error);
    }
  }
  
  

// Função para calcular a EMA
function calculateEMA(prices, period) {
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  return prices.slice(period).reduce((acc, price) => {
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
}

// Rota para iniciar previsões
app.get("/get", async (req, res) => {
  await getAvailableSymbols(); // Obtém os símbolos disponíveis ao acessar esta rota
  await Promise.all(Object.keys(symbolData).map(symbol => getSymbolData(symbol))); // Obtém os dados para cada símbolo
  const results = Object.values(symbolData)
    .map((data) => data.result)
    .filter((result) => result !== null);
  if (results.length > 0) {
    res.json(results);
  } else {
    res.json({ message: "Nenhuma previsão disponível no momento." });
  }
});

// Rota para servir o arquivo HTML
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "../../client", "indexPredictionsAlpha.html")
  );
});

module.exports = app;
