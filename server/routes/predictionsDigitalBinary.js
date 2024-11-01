const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const db = require("../config/database");
const MarketAnalyzer = require("../services/MarketAnalyzer");
const NotificationService = require("../services/NotificationService");
const moment = require("moment");

class PredictionsManager {
  constructor() {
    this.app = express.Router();
    this.setupRoutes();
    this.symbolData = new Map();
    this.activeConnections = new Set();
    this.minDataPoints = 100;
    this.signalTimeout = 300000; // 5 minutos
    
    // Configurações
    this.config = {
      minConfidence: 0.95,
      minConsecutiveTicks: 30,
      maxSignalsPerSymbol: 3,
      signalCooldown: 300000, // 5 minutos entre sinais do mesmo par
      volatilityThreshold: 0.002
    };

    // Pares de moedas suportados
    this.symbols = [
      "frxAUDCAD", "frxAUDCHF", "frxAUDJPY", "frxAUDNZD", "frxAUDUSD",
      "frxEURAUD", "frxEURCAD", "frxEURCHF", "frxEURGBP", "frxEURJPY",
      "frxEURNZD", "frxEURUSD", "frxGBPAUD", "frxGBPCAD", "frxGBPCHF",
      "frxGBPJPY", "frxGBPNZD", "frxGBPUSD", "frxNZDJPY", "frxUSDCAD",
      "frxUSDCHF", "frxUSDJPY", "frxUSDNOK", "frxUSDSEK"
    ];
  }

  setupRoutes() {
    this.app.get("/signals", this.getActiveSignals.bind(this));
    this.app.get("/performance", this.getPerformanceMetrics.bind(this));
    this.app.get("/", (req, res) => {
      res.sendFile(path.join(__dirname, "../../client", "index.html"));
    });
  }

  initialize() {
    this.initializeSymbolData();
    this.connectWebSocket();
    this.startMonitoring();
    console.log("PredictionsManager inicializado");
  }

  initializeSymbolData() {
    this.symbols.forEach(symbol => {
      this.symbolData.set(symbol, {
        ticks: [],
        lastSignal: null,
        performance: {
          wins: 0,
          losses: 0,
          totalTrades: 0
        },
        volatility: 0,
        consecutiveTicks: 0
      });
    });
  }

  async processMarketData(symbol, tick) {
    try {
      const data = this.symbolData.get(symbol);
      if (!data) return;

      // Atualizar dados
      data.ticks.push(tick);
      data.consecutiveTicks++;

      // Manter apenas os últimos 1000 ticks
      if (data.ticks.length > 1000) {
        data.ticks.shift();
      }

      // Verificar condições para análise
      if (!this.shouldAnalyze(symbol)) {
        return;
      }

      // Calcular volatilidade
      data.volatility = this.calculateVolatility(data.ticks);

      // Verificar condições de mercado
      if (!this.isMarketConditionSuitable(data)) {
        return;
      }

      // Realizar análise
      const prices = data.ticks.map(t => t.quote);
      const analysis = await MarketAnalyzer.analyzeTrend(prices);

      // Validar e processar sinal
      if (this.validateAnalysis(analysis)) {
        await this.processSignal(symbol, analysis, tick);
      }

    } catch (error) {
      console.error(`Erro ao processar dados para ${symbol}:`, error);
    }
  }

  shouldAnalyze(symbol) {
    const data = this.symbolData.get(symbol);
    if (!data) return false;

    // Verificar quantidade mínima de ticks
    if (data.ticks.length < this.minDataPoints) {
      return false;
    }

    // Verificar tempo desde último sinal
    if (data.lastSignal) {
      const timeSinceLastSignal = Date.now() - data.lastSignal;
      if (timeSinceLastSignal < this.config.signalCooldown) {
        return false;
      }
    }

    return true;
  }

  isMarketConditionSuitable(data) {
    // Verificar volatilidade
    if (data.volatility > this.config.volatilityThreshold) {
      return false;
    }

    // Verificar consistência dos ticks
    if (data.consecutiveTicks < this.config.minConsecutiveTicks) {
      return false;
    }

    return true;
  }

  calculateVolatility(ticks) {
    if (ticks.length < 2) return 0;

    const prices = ticks.map(t => t.quote);
    const returns = [];

    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;

    return Math.sqrt(variance);
  }

  validateAnalysis(analysis) {
    if (!analysis || !analysis.confidence) return false;

    return (
      analysis.confidence >= this.config.minConfidence &&
      analysis.direction !== "neutral" &&
      analysis.shouldTrade
    );
  }

  async processSignal(symbol, analysis, currentTick) {
    try {
      const signal = this.createSignal(symbol, analysis, currentTick);
      
      // Validar sinal final
      if (!this.validateFinalSignal(signal)) {
        return;
      }

      // Salvar e enviar sinal
      await this.saveSignal(signal);
      await NotificationService.sendSignal(signal);

      // Atualizar dados do símbolo
      this.updateSymbolData(symbol, signal);

      console.log(`Sinal gerado para ${symbol}:`, signal);

    } catch (error) {
      console.error(`Erro ao processar sinal para ${symbol}:`, error);
    }
  }

  createSignal(symbol, analysis, currentTick) {
    const entryTime = moment().add(30, "seconds");
    const expirationMinutes = this.calculateExpirationTime(analysis);
    const expirationTime = moment(entryTime).add(expirationMinutes, "minutes");

    return {
      symbol,
      direction: analysis.direction === "up" ? "ACIMA" : "ABAIXO",
      entryPrice: currentTick.quote,
      currentTime: moment().format("HH:mm:ss"),
      entryTime: entryTime.format("HH:mm:ss"),
      expirationTime: expirationTime.format("HH:mm:ss"),
      timeFrame: `${expirationMinutes}M`,
      confidence: analysis.confidence,
      stopLoss: analysis.stopLoss,
      takeProfit: analysis.takeProfit,
      indicators: analysis.details.indicators
    };
  }

  calculateExpirationTime(analysis) {
    const confidence = analysis.confidence;
    if (confidence > 0.98) return 1;
    if (confidence > 0.96) return 2;
    return 3;
  }

  validateFinalSignal(signal) {
    // Verificar horário de negociação
    const currentHour = moment().hour();
    if (currentHour < 8 || currentHour > 20) {
      return false;
    }

    // Verificar stop loss e take profit
    if (!signal.stopLoss || !signal.takeProfit) {
      return false;
    }

    return true;
  }

  async saveSignal(signal) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO signals (
          symbol, entry_time, direction, entry_price, 
          expiration_time, confidence
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        signal.symbol,
        moment(signal.entryTime, "HH:mm:ss").unix(),
        signal.direction,
        signal.entryPrice,
        moment(signal.expirationTime, "HH:mm:ss").unix(),
        signal.confidence
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  updateSymbolData(symbol, signal) {
    const data = this.symbolData.get(symbol);
    if (data) {
      data.lastSignal = Date.now();
      data.consecutiveTicks = 0;
    }
  }

  connectWebSocket() {
    const app_id = process.env.APP_ID || 1089;
    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

    ws.on('open', () => {
      console.log("Conectado ao WebSocket Deriv");
      this.subscribeToSymbols(ws);
    });

    ws.on('message', async (data) => {
      const message = JSON.parse(data);
      if (message.tick) {
        await this.processMarketData(message.tick.symbol, {
          quote: message.tick.quote,
          epoch: message.tick.epoch
        });
      }
    });

    ws.on('error', (error) => {
      console.error("Erro no WebSocket:", error);
    });

    ws.on('close', () => {
      console.log("Conexão WebSocket fechada, reconectando...");
      setTimeout(() => this.connectWebSocket(), 5000);
    });
  }

  subscribeToSymbols(ws) {
    this.symbols.forEach(symbol => {
      ws.send(JSON.stringify({
        ticks: symbol,
        subscribe: 1
      }));
    });
  }

  startMonitoring() {
    setInterval(() => {
      this.logSystemStatus();
      this.cleanupOldData();
    }, 60000);
  }

  logSystemStatus() {
    console.log("\n=== Status do Sistema ===");
    this.symbols.forEach(symbol => {
      const data = this.symbolData.get(symbol);
      if (data) {
        console.log(`
          Símbolo: ${symbol}
          Ticks: ${data.ticks.length}
          Último Preço: ${data.ticks[data.ticks.length - 1]?.quote || "N/A"}
          Volatilidade: ${data.volatility.toFixed(6)}
          Último Sinal: ${data.lastSignal ? moment(data.lastSignal).fromNow() : "N/A"}
        `);
      }
    });
  }

  cleanupOldData() {
    this.symbols.forEach(symbol => {
      const data = this.symbolData.get(symbol);
      if (data && data.ticks.length > this.minDataPoints) {
        data.ticks = data.ticks.slice(-this.minDataPoints);
      }
    });
  }

  getActiveSignals(req, res) {
    const activeSignals = Array.from(this.symbolData.values())
      .filter(data => data.lastSignal && Date.now() - data.lastSignal < this.signalTimeout)
      .map(data => ({
        symbol: data.symbol,
        lastSignal: data.lastSignal,
        performance: data.performance
      }));

    res.json(activeSignals);
  }

  getPerformanceMetrics(req, res) {
    const performance = Array.from(this.symbolData.entries()).map(([symbol, data]) => ({
      symbol,
      wins: data.performance.wins,
      losses: data.performance.losses,
      winRate: data.performance.totalTrades > 0 
        ? (data.performance.wins / data.performance.totalTrades) * 100 
        : 0
    }));

    res.json(performance);
  }
}

//const predictionsManager = new PredictionsManager();
//predictionsManager.initialize();

//module.exports = predictionsManager.app;