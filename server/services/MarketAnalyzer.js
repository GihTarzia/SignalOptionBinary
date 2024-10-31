const tf = require("@tensorflow/tfjs");
const technicalIndicators = require("technicalindicators");
const path = require("path");

class MarketAnalyzer {
  constructor() {
    this.model = null;
    this.initialized = false;
    this.dataStats = {
      price: { min: null, max: null },
      rsi: { min: 0, max: 100 },
      macd: { min: null, max: null },
      bollinger: { min: null, max: null },
    };
    this.historicalData = [];
    this.minPrices = 30;
    this.modelPath = path.join(__dirname, "../models/trading_model");
    this.dataPath = path.join(__dirname, "../data/market_data.json");
    this.lastTrainingTime = null;
    this.trainingInterval = 1000 * 60 * 60; // 1 hora
    this.resetInterval = 1000 * 60 * 60 * 24; // 24 horas
    this.baselineModel = null;
    this.timeframes = {
      M1: 60, // 1 minuto em segundos
      M5: 300, // 5 minutos
      M15: 900, // 15 minutos
      M30: 1800, // 30 minutos
    };
    this.volumeHistory = [];
    this.volumeWindow = 20; // Janela para média móvel do volume
    this.trendMemory = new Map(); // Para armazenar tendências anteriores
  }
  // Função para calcular volume sintético já que não temos volume real
  calculateVolume(prices) {
    try {
      if (!Array.isArray(prices) || prices.length < 2) {
        return this.getDefaultVolumeData();
      }

      const volumes = [];
      let avgChange = 0;

      // Calcular mudança média de preço
      for (let i = 1; i < prices.length; i++) {
        const change = Math.abs(prices[i] - prices[i - 1]);
        avgChange += change;
      }
      avgChange /= prices.length - 1;

      // Gerar volumes com base na volatilidade
      for (let i = 1; i < prices.length; i++) {
        const change = Math.abs(prices[i] - prices[i - 1]);
        const volatilityFactor = change / avgChange;
        const syntheticVolume = 1000000 * volatilityFactor;
        volumes.push(syntheticVolume);
      }

      // Normalizar e calcular médias
      const maxVolume = Math.max(...volumes);
      const normalizedVolumes = volumes.map((v) => v / maxVolume);
      const vwap = this.calculateVWAP(prices, normalizedVolumes);
      const volumeMA = this.calculateVolumeMA(normalizedVolumes);

      return {
        current: normalizedVolumes[normalizedVolumes.length - 1],
        history: normalizedVolumes,
        average: volumeMA,
        vwap: vwap,
        trend: this.analyzeVolumeTrend(normalizedVolumes),
      };
    } catch (error) {
      console.error("Erro ao calcular volume:", error);
      return this.getDefaultVolumeData();
    }
  }
  getDefaultVolumeData() {
    return {
      current: 1,
      history: [],
      average: 1,
      vwap: 1,
      trend: "neutral",
    };
  }

  // Calcular VWAP (Volume Weighted Average Price)
  calculateVWAP(prices, volumes) {
    let sumPV = 0;
    let sumV = 0;

    for (let i = 0; i < prices.length; i++) {
      sumPV += prices[i] * volumes[i];
      sumV += volumes[i];
    }

    return sumV === 0 ? prices[prices.length - 1] : sumPV / sumV;
  }

  // Calcular Média Móvel do Volume
  calculateVolumeMA(volumes) {
    if (volumes.length < this.volumeWindow) {
      return volumes.reduce((a, b) => a + b, 0) / volumes.length;
    }

    const recentVolumes = volumes.slice(-this.volumeWindow);
    return recentVolumes.reduce((a, b) => a + b, 0) / this.volumeWindow;
  }

  // Analisar tendência do volume
  analyzeVolumeTrend(volumes) {
    if (volumes.length < 2) return "neutral";

    const recentVolumes = volumes.slice(-5);
    const volumeChange =
      (recentVolumes[recentVolumes.length - 1] - recentVolumes[0]) /
      recentVolumes[0];

    if (volumeChange > 0.1) return "increasing";
    if (volumeChange < -0.1) return "decreasing";
    return "stable";
  }

  // Verificar divergências de volume
  checkVolumeDivergence(prices, volumes) {
    const priceChange = (prices[prices.length - 1] - prices[0]) / prices[0];
    const volumeChange =
      (volumes[volumes.length - 1] - volumes[0]) / volumes[0];

    // Divergência positiva: preço cai mas volume aumenta
    if (priceChange < 0 && volumeChange > 0) {
      return { type: "positive", strength: Math.abs(volumeChange) };
    }

    // Divergência negativa: preço sobe mas volume diminui
    if (priceChange > 0 && volumeChange < 0) {
      return { type: "negative", strength: Math.abs(volumeChange) };
    }

    return { type: "none", strength: 0 };
  }

  analyzePriceAction(prices) {
    if (!Array.isArray(prices)) {
      console.warn("Dados de preços inválidos em analyzePriceAction");
      return { swings: [], support: [], resistance: [], prices: [] };
    }

    const swings = this.identifySwings(prices);
    const support = this.findSupportLevels(prices);
    const resistance = this.findResistanceLevels(prices);

    return {
      swings,
      support,
      resistance,
      prices, // Incluir os preços no retorno
    };
  }
  identifySwings(prices) {
    const swings = [];
    for (let i = 2; i < prices.length - 2; i++) {
      // Identifica topos e fundos
      if (prices[i] > prices[i - 1] && prices[i] > prices[i + 1]) {
        swings.push({ type: "high", price: prices[i], index: i });
      }
      if (prices[i] < prices[i - 1] && prices[i] < prices[i + 1]) {
        swings.push({ type: "low", price: prices[i], index: i });
      }
    }
    return swings;
  }

  findSupportLevels(prices) {
    const levels = [];
    const tolerance = 0.0001; // 0.01%

    for (let i = 0; i < prices.length; i++) {
      let touchCount = 0;
      for (let j = i + 1; j < prices.length; j++) {
        if (Math.abs(prices[j] - prices[i]) / prices[i] < tolerance) {
          touchCount++;
        }
      }
      if (touchCount >= 2) {
        levels.push(prices[i]);
      }
    }
    return [...new Set(levels)]; // Remove duplicatas
  }

  findResistanceLevels(prices) {
    // Similar ao support, mas procurando níveis superiores
    return this.findSupportLevels(prices.slice().reverse());
  }
  async initialize() {
    try {
      // Criar modelo base
      this.baselineModel = await this.createModel();
      await this.trainInitialModel(this.baselineModel); // Passar o modelo como parâmetro

      // Criar modelo ativo
      this.model = await this.createModel();
      await this.trainInitialModel(this.model); // Passar o modelo como parâmetro

      this.initialized = true;
      this.startPeriodicReset();
      console.log("MarketAnalyzer inicializado com sucesso");
    } catch (error) {
      console.error("Erro ao inicializar MarketAnalyzer:", error);
      throw error;
    }
  }

  async createModel() {
    try {
      const model = tf.sequential();

      // Input layer
      model.add(
        tf.layers.dense({
          units: 64,
          activation: "relu",
          inputShape: [5],
          kernelInitializer: "glorotNormal",
        })
      );

      // Hidden layer
      model.add(
        tf.layers.dense({
          units: 32,
          activation: "relu",
          kernelInitializer: "glorotNormal",
        })
      );

      // Dropout layer
      model.add(tf.layers.dropout({ rate: 0.2 }));

      // Output layer
      model.add(
        tf.layers.dense({
          units: 1,
          activation: "sigmoid",
          kernelInitializer: "glorotNormal",
        })
      );

      const optimizer = tf.train.adam(0.001);

      model.compile({
        optimizer: optimizer,
        loss: "binaryCrossentropy",
        metrics: ["accuracy"],
      });

      return model;
    } catch (error) {
      console.error("Erro ao criar modelo:", error);
      throw error;
    }
  }

  startPeriodicReset() {
    setInterval(async () => {
      await this.evaluateAndResetIfNeeded();
    }, this.resetInterval);
  }

  async evaluateAndResetIfNeeded() {
    try {
      // Avaliar performance do modelo atual
      const currentPerformance = await this.evaluateModel(this.model);
      const baselinePerformance = await this.evaluateModel(this.baselineModel);

      console.log("Performance:", {
        current: currentPerformance,
        baseline: baselinePerformance,
      });

      // Se o modelo atual estiver performando pior que o baseline
      if (currentPerformance < baselinePerformance * 0.95) {
        // 5% de tolerância
        console.log("Resetando modelo para baseline...");
        await this.resetToBaseline();
      } else {
        // Atualizar baseline se o modelo atual estiver significativamente melhor
        if (currentPerformance > baselinePerformance * 1.1) {
          // 10% de melhoria
          console.log("Atualizando modelo baseline...");
          this.baselineModel = await this.cloneModel(this.model);
        }
      }
    } catch (error) {
      console.error("Erro na avaliação do modelo:", error);
    }
  }

  cleanupMemory() {
    try {
      // Limpar variáveis de tensor não utilizadas
      tf.disposeVariables();

      // Executar coleta de lixo
      if (global.gc) {
        global.gc();
      }
    } catch (error) {
      console.error("Erro ao limpar memória:", error);
    }
  }

  async evaluateModel(model) {
    let tensorFeatures = null;
    let tensorLabels = null;

    try {
      const testData = this.historicalData.slice(-1000);
      const indicators = this.calculateIndicators(testData);
      const features = this.prepareFeatures(testData, indicators);

      const labels = [];
      for (let i = 5; i < testData.length; i++) {
        labels.push(testData[i] > testData[i - 1] ? 1 : 0);
      }

      tensorFeatures = tf.tensor2d(features);
      tensorLabels = tf.tensor1d(labels);

      const result = await model.evaluate(tensorFeatures, tensorLabels);
      const accuracy = await result[1].data();

      return accuracy[0];
    } catch (error) {
      console.error("Erro na avaliação:", error);
      return 0;
    } finally {
      // Limpar memória
      if (tensorFeatures) tensorFeatures.dispose();
      if (tensorLabels) tensorLabels.dispose();
    }
  }

  async resetToBaseline() {
    this.model = await this.cloneModel(this.baselineModel);
    this.lastTrainingTime = Date.now();
    console.log("Modelo resetado para baseline");
  }

  async cloneModel(sourceModel) {
    const clonedModel = await this.createModel();
    const weights = sourceModel.getWeights();
    clonedModel.setWeights(weights);
    return clonedModel;
  }

  async processNewData(price) {
    try {
      if (!this.initialized) {
        console.log("MarketAnalyzer ainda não inicializado");
        return;
      }

      if (typeof price !== "number" || isNaN(price)) {
        console.error("Preço inválido recebido:", price);
        return;
      }

      this.historicalData.push(price);

      if (this.historicalData.length > 10000) {
        this.historicalData.shift();
      }

      const timeSinceLastTraining = Date.now() - (this.lastTrainingTime || 0);
      if (timeSinceLastTraining > this.trainingInterval) {
        console.log("Iniciando treinamento periódico...");
        await this.trainWithHistoricalData();
        this.lastTrainingTime = Date.now();
        this.cleanupMemory();
      }
    } catch (error) {
      console.error("Erro ao processar novos dados:", error);
    }
  }
  async trainWithHistoricalData() {
    try {
      if (!this.model) {
        throw new Error("Modelo não inicializado");
      }

      if (this.historicalData.length < this.minPrices) {
        console.log("Dados históricos insuficientes para treinamento");
        return;
      }

      const batchSize = Math.min(1000, this.historicalData.length);
      const recentData = this.historicalData.slice(-batchSize);

      const indicators = this.calculateIndicators(recentData);
      const features = this.prepareFeatures(recentData, indicators);

      const labels = [];
      for (let i = 5; i < recentData.length; i++) {
        labels.push(recentData[i] > recentData[i - 1] ? 1 : 0);
      }

      const tensorFeatures = tf.tensor2d(features);
      const tensorLabels = tf.tensor1d(labels);

      const trainLogs = await this.model.fit(tensorFeatures, tensorLabels, {
        epochs: 10,
        batchSize: 32,
        shuffle: true,
        verbose: 1,
        callbacks: {
          onEpochEnd: async (epoch, logs) => {
            console.log(
              `Treinamento contínuo - Epoch ${epoch}: loss = ${logs.loss.toFixed(
                4
              )}, accuracy = ${logs.acc.toFixed(4)}`
            );
          },
        },
      });

      // Limpar memória
      tf.dispose([tensorFeatures, tensorLabels]);

      console.log("Treinamento com dados históricos concluído");
      return trainLogs;
    } catch (error) {
      console.error("Erro no treinamento com dados históricos:", error);
      throw error;
    }
  }

  normalizeData(data, min = null, max = null) {
    if (min === null) min = Math.min(...data);
    if (max === null) max = Math.max(...data);
    if (max === min) return data.map(() => 0.5);
    return data.map((x) => (x - min) / (max - min));
  }

  updateDataStats(prices, indicators) {
    this.dataStats.price.min = Math.min(...prices);
    this.dataStats.price.max = Math.max(...prices);

    const macdValues = indicators.macd
      .map((m) => m.MACD)
      .filter((m) => m !== undefined);
    this.dataStats.macd.min = Math.min(...macdValues);
    this.dataStats.macd.max = Math.max(...macdValues);

    const bollingerRanges = indicators.bollinger.map((b) => b.upper - b.lower);
    this.dataStats.bollinger.min = Math.min(...bollingerRanges);
    this.dataStats.bollinger.max = Math.max(...bollingerRanges);
  }

  generateSyntheticData() {
    const data = [];
    let price = 100;

    for (let i = 0; i < 1000; i++) {
      const trend = Math.random() > 0.5 ? 1 : -1;
      const change = Math.random() * 0.002 * trend;
      price = price * (1 + change);
      data.push(price);
    }

    return data;
  }

  async trainInitialModel(model) {
    try {
      if (!model) {
        throw new Error("Modelo não fornecido para treinamento inicial");
      }

      const syntheticData = this.generateSyntheticData();
      const indicators = this.calculateIndicators(syntheticData);
      const features = this.prepareFeatures(syntheticData, indicators);

      const labels = [];
      for (let i = 5; i < syntheticData.length; i++) {
        labels.push(syntheticData[i] > syntheticData[i - 1] ? 1 : 0);
      }

      const tensorFeatures = tf.tensor2d(features);
      const tensorLabels = tf.tensor1d(labels);

      const trainLogs = await model.fit(tensorFeatures, tensorLabels, {
        epochs: 50,
        batchSize: 32,
        shuffle: true,
        verbose: 1,
        validationSplit: 0.2,
        callbacks: {
          onEpochEnd: async (epoch, logs) => {
            if (epoch % 10 === 0) {
              console.log(
                `Epoch ${epoch}: loss = ${logs.loss.toFixed(
                  4
                )}, accuracy = ${logs.acc.toFixed(4)}`
              );
            }
          },
        },
      });

      // Limpar memória
      tf.dispose([tensorFeatures, tensorLabels]);

      console.log("Modelo treinado com dados sintéticos");
      return trainLogs;
    } catch (error) {
      console.error("Erro no treinamento inicial:", error);
      throw error;
    }
  }

  prepareFeatures(prices, indicators) {
    const window = 5;
    const features = [];

    this.updateDataStats(prices, indicators);

    for (let i = window; i < prices.length; i++) {
      const slice = prices.slice(i - window, i);
      const returns = slice.map((p, j) =>
        j > 0 ? (p - slice[j - 1]) / slice[j - 1] : 0
      );

      const normalizedReturns = this.normalizeData(returns);
      const normalizedRSI = indicators.rsi[i] / 100;
      const normalizedMACD = this.normalizeData(
        [indicators.macd[i]?.MACD || 0],
        this.dataStats.macd.min,
        this.dataStats.macd.max
      )[0];

      const bollingerWidth =
        indicators.bollinger[i]?.upper - indicators.bollinger[i]?.lower || 0;
      const normalizedBollinger = this.normalizeData(
        [bollingerWidth],
        this.dataStats.bollinger.min,
        this.dataStats.bollinger.max
      )[0];

      features.push([
        normalizedReturns[normalizedReturns.length - 1],
        normalizedRSI,
        normalizedMACD,
        normalizedBollinger,
        (prices[i] - this.dataStats.price.min) /
          (this.dataStats.price.max - this.dataStats.price.min),
      ]);
    }

    return features;
  }

  calculateIndicators(prices) {
    const period = 14;

    const rsi = technicalIndicators.RSI.calculate({
      values: prices,
      period: period,
    });

    const macd = technicalIndicators.MACD.calculate({
      values: prices,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
    });

    const bollinger = technicalIndicators.BollingerBands.calculate({
      values: prices,
      period: period,
      stdDev: 2,
    });

    while (rsi.length < prices.length) rsi.unshift(50);
    while (macd.length < prices.length)
      macd.unshift({ MACD: 0, signal: 0, histogram: 0 });
    while (bollinger.length < prices.length) {
      bollinger.unshift({
        middle: prices[0],
        upper: prices[0],
        lower: prices[0],
      });
    }

    return { rsi, macd, bollinger };
  }

  // Modificar a função de análise de tendência principal
  async analyzeTrend(prices) {
    try {
      if (prices.length < this.minPrices) {
        return { direction: "neutral", strength: 0, confidence: 0 };
      }

      const indicators = this.calculateIndicators(prices);
      const volumes = this.calculateVolume(prices);
      const priceAction = this.analyzePriceAction(prices);

      // Verificar divergências de volume
      const volumeDivergence = this.checkVolumeDivergence(
        prices,
        volumes.history
      );

      // Análise multi-timeframe
      const trends = {
        short: this.analyzeTrendByTimeframe(
          prices.slice(-30),
          indicators,
          volumes
        ),
        medium: this.analyzeTrendByTimeframe(
          prices.slice(-60),
          indicators,
          volumes
        ),
        long: this.analyzeTrendByTimeframe(prices, indicators, volumes),
      };

      // Confirmação de tendência com volume
      const trendConfirmation = this.confirmTrendWithVolume(
        trends,
        priceAction,
        volumes
      );

      // Cálculo de força e confiança considerando volume
      const strength = this.calculateTrendStrength(trends, indicators, volumes);
      const confidence = this.calculateConfidence(
        trends,
        indicators,
        priceAction,
        volumes
      );

      // Ajustar confiança baseado em divergências de volume
      const adjustedConfidence = this.adjustConfidenceForVolume(
        confidence,
        volumeDivergence
      );

      return {
        direction: trendConfirmation.direction,
        strength: strength,
        confidence: adjustedConfidence,
        details: {
          ...indicators,
          volume: volumes,
          priceAction,
          volumeDivergence,
          trends,
        },
      };
    } catch (error) {
      console.error("Erro na análise de tendência:", error);
      return { direction: "neutral", strength: 0, confidence: 0 };
    }
  }
  calculateReversalProbability(trend, indicators, priceAction, divergences) {
    try {
      let probability = 0;

      // Verificar condições de reversão
      if (divergences.length > 0) probability += 0.3;

      // Verificar níveis importantes
      const currentPrice =
        priceAction.swings[priceAction.swings.length - 1]?.price;
      const nearSupport = this.isNearLevel(currentPrice, priceAction.support);
      const nearResistance = this.isNearLevel(
        currentPrice,
        priceAction.resistance
      );

      if (trend.direction === "up" && nearResistance) probability += 0.3;
      if (trend.direction === "down" && nearSupport) probability += 0.3;

      // Verificar sobrecompra/sobrevenda
      const rsi = indicators.rsi[indicators.rsi.length - 1];
      if (trend.direction === "up" && rsi > 70) probability += 0.2;
      if (trend.direction === "down" && rsi < 30) probability += 0.2;

      return Math.min(probability, 1);
    } catch (error) {
      console.error("Erro ao calcular probabilidade de reversão:", error);
      return 0;
    }
  }

  checkDivergences(prices, indicators) {
    const divergences = [];

    // Regular Divergences
    const regularBullish = this.isRegularBullishDivergence(
      prices,
      indicators.rsi
    );
    const regularBearish = this.isRegularBearishDivergence(
      prices,
      indicators.rsi
    );

    // Hidden Divergences
    const hiddenBullish = this.isHiddenBullishDivergence(
      prices,
      indicators.rsi
    );
    const hiddenBearish = this.isHiddenBearishDivergence(
      prices,
      indicators.rsi
    );

    if (regularBullish)
      divergences.push({ type: "regular", direction: "bullish" });
    if (regularBearish)
      divergences.push({ type: "regular", direction: "bearish" });
    if (hiddenBullish)
      divergences.push({ type: "hidden", direction: "bullish" });
    if (hiddenBearish)
      divergences.push({ type: "hidden", direction: "bearish" });

    return divergences;
  }

  isNearKeyLevel(price, historicalData) {
    const tolerance = 0.0005; // 0.05%
    const levels = this.identifyKeyLevels(historicalData);

    const isNearSupport = levels.support.some(
      (level) => Math.abs(price - level) / level < tolerance
    );

    const isNearResistance = levels.resistance.some(
      (level) => Math.abs(price - level) / level < tolerance
    );

    return isNearSupport || isNearResistance;
  }

  calculateSlope(values) {
    if (values.length < 2) return 0;

    const n = values.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }

    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }

  calculateConfidence(trends, indicators, priceAction, volumes) {
    try {
      // Pesos base
      let weights = {
        trend: 0.35,
        indicators: 0.3,
        volume: 0.2,
        patterns: 0.15,
      };

      // Scores individuais
      const trendScore = this.analyzeTrendConsistency(trends, indicators);
      const indicatorScore = this.calculateIndicatorStrength(indicators);
      let volumeScore = 0;
      let patternScore = 0;

      // Ajuste de pesos se volume estiver ausente
      if (!volumes?.current) {
        const volumeWeight = weights.volume;
        weights.trend += volumeWeight * 0.4;
        weights.indicators += volumeWeight * 0.4;
        weights.patterns += volumeWeight * 0.2;
        weights.volume = 0;
      } else {
        volumeScore = this.calculateVolumeStrength(volumes);
      }

      // Cálculo de padrões
      if (priceAction?.swings) {
        patternScore = this.calculatePatternStrength(
          this.identifyPatterns(priceAction.prices, priceAction.swings)
        );
      }

      // Cálculo ponderado
      const confidence =
        trendScore * weights.trend +
        indicatorScore * weights.indicators +
        volumeScore * weights.volume +
        patternScore * weights.patterns;

      // Normalização com limite máximo de 0.95
      const finalConfidence = Math.min(Math.max(confidence, 0), 0.95);

      // Log detalhado
      console.log("Detalhes do cálculo de confiança:", {
        scores: {
          trend: trendScore,
          indicator: indicatorScore,
          volume: volumeScore,
          pattern: patternScore,
        },
        weights,
        rawConfidence: confidence,
        finalConfidence,
      });

      return finalConfidence;
    } catch (error) {
      console.error("Erro no cálculo de confiança:", error);
      return 0;
    }
  }

  // 3. Ajuste no cálculo de força dos padrões
  calculatePatternStrength(patterns) {
    if (!patterns) return 0;

    let strength = 0;
    let patternCount = 0;

    // Pontuação mais equilibrada para cada padrão
    if (patterns.doubleTop) {
      strength += 0.25;
      patternCount++;
    }
    if (patterns.doubleBottom) {
      strength += 0.25;
      patternCount++;
    }
    if (patterns.headAndShoulders) {
      strength += 0.35;
      patternCount++;
    }
    if (patterns.triangles.ascending || patterns.triangles.descending) {
      strength += 0.2;
      patternCount++;
    }

    // Ajuste baseado na quantidade de padrões
    return patternCount > 0 ? strength / patternCount : 0;
  }

  // Funções auxiliares adicionais
  isHiddenBullishDivergence(prices, rsi) {
    const priceLen = prices.length;
    const rsiLen = rsi.length;
    if (priceLen < 2 || rsiLen < 2) return false;

    const priceLow1 = prices[priceLen - 1];
    const priceLow2 = prices[priceLen - 2];
    const rsiLow1 = rsi[rsiLen - 1];
    const rsiLow2 = rsi[rsiLen - 2];

    return priceLow1 > priceLow2 && rsiLow1 < rsiLow2;
  }

  isHiddenBearishDivergence(prices, rsi) {
    const priceLen = prices.length;
    const rsiLen = rsi.length;
    if (priceLen < 2 || rsiLen < 2) return false;

    const priceHigh1 = prices[priceLen - 1];
    const priceHigh2 = prices[priceLen - 2];
    const rsiHigh1 = rsi[rsiLen - 1];
    const rsiHigh2 = rsi[rsiLen - 2];

    return priceHigh1 < priceHigh2 && rsiHigh1 > rsiHigh2;
  }

  isNearLevel(price, levels, tolerance = 0.0005) {
    return levels.some((level) => Math.abs(price - level) / level < tolerance);
  }
  analyzeTrendByTimeframe(prices, indicators, volumes) {
    try {
      // Verificar dados mínimos
      if (prices.length < this.minPrices) {
        return {
          direction: "neutral",
          strength: 0,
          confidence: 0,
        };
      }

      // Análise de tendência por preço
      const priceTrend = this.analyzePriceTrend(prices);

      // Análise de indicadores técnicos
      const indicatorTrend = this.analyzeIndicatorTrend(indicators);

      // Análise de estrutura de preço
      const structureTrend = this.analyzeStructure(prices);

      // Análise de momentum
      const momentum = this.analyzeMomentum(prices, indicators);

      // Combinar análises
      const combinedAnalysis = this.combineAnalyses(
        priceTrend,
        indicatorTrend,
        structureTrend,
        momentum,
        volumes
      );

      return combinedAnalysis;
    } catch (error) {
      console.error("Erro na análise de timeframe:", error);
      return {
        direction: "neutral",
        strength: 0,
        confidence: 0,
      };
    }
  }
  analyzePriceTrend(prices) {
    try {
      const periods = [5, 10, 20]; // Diferentes períodos para análise
      const trends = periods.map((period) => {
        const slice = prices.slice(-period);
        const first = slice[0];
        const last = slice[slice.length - 1];
        const change = (last - first) / first;

        // Calcular tendência linear
        const linearTrend = this.calculateLinearTrend(slice);

        return {
          period,
          direction: change > 0 ? "up" : change < 0 ? "down" : "neutral",
          strength: Math.abs(change),
          slope: linearTrend.slope,
        };
      });

      // Combinar resultados dos diferentes períodos
      const direction = this.getMajorityDirection(
        trends.map((t) => t.direction)
      );
      const strength =
        trends.reduce((acc, t) => acc + t.strength, 0) / trends.length;
      const consistency = this.checkTrendConsistency(trends);

      return {
        direction,
        strength,
        consistency,
        details: trends,
      };
    } catch (error) {
      console.error("Erro na análise de tendência de preço:", error);
      return { direction: "neutral", strength: 0, consistency: 0 };
    }
  }

  analyzeIndicatorTrend(indicators) {
    const { rsi, macd, bollinger } = indicators;

    // Análise RSI
    const rsiTrend = this.analyzeRSITrend(rsi);

    // Análise MACD
    const macdTrend = this.analyzeMACDTrend(macd);

    // Análise Bollinger
    const bollingerTrend = this.analyzeBollingerTrend(bollinger);

    // Combinar sinais
    const direction = this.getMajorityDirection([
      rsiTrend.direction,
      macdTrend.direction,
      bollingerTrend.direction,
    ]);

    const strength =
      (rsiTrend.strength + macdTrend.strength + bollingerTrend.strength) / 3;

    return {
      direction,
      strength,
      details: {
        rsi: rsiTrend,
        macd: macdTrend,
        bollinger: bollingerTrend,
      },
    };
  }

  analyzeStructure(prices) {
    // Identificar topos e fundos
    const swings = this.identifySwings(prices);

    // Analisar padrões de preço
    const patterns = this.identifyPatterns(prices, swings);

    // Identificar níveis importantes
    const levels = this.identifyKeyLevels(prices, swings);

    // Determinar estrutura geral
    return this.determineStructure(swings, patterns, levels);
  }

  analyzeMomentum(prices, indicators) {
    const recentPrices = prices.slice(-20);
    const rsi = indicators.rsi.slice(-20);
    const macd = indicators.macd.slice(-20);

    // Calcular força do momentum
    const momentumStrength = this.calculateMomentumStrength(
      recentPrices,
      rsi,
      macd
    );

    // Verificar divergências
    const divergences = this.checkMomentumDivergences(recentPrices, rsi, macd);

    // Analisar aceleração
    const acceleration = this.calculateAcceleration(recentPrices);

    return {
      strength: momentumStrength,
      divergences,
      acceleration,
    };
  }

  calculateLinearTrend(prices) {
    const n = prices.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i];
      sumXY += i * prices[i];
      sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  getMajorityDirection(directions) {
    try {
      if (!Array.isArray(directions) || directions.length === 0) {
        return "neutral";
      }

      const counts = directions.reduce((acc, dir) => {
        if (dir) {
          // Verificar se a direção não é undefined ou null
          acc[dir] = (acc[dir] || 0) + 1;
        }
        return acc;
      }, {});

      if (Object.keys(counts).length === 0) {
        return "neutral";
      }

      return Object.entries(counts).reduce((a, b) => (a[1] > b[1] ? a : b))[0];
    } catch (error) {
      console.error("Erro ao calcular direção majoritária:", error);
      return "neutral";
    }
  }

  checkTrendConsistency(trends) {
    const directions = trends.map((t) => t.direction);
    const mainDirection = this.getMajorityDirection(directions);
    const consistentCount = directions.filter(
      (d) => d === mainDirection
    ).length;
    return consistentCount / directions.length;
  }

  combineAnalyses(
    priceTrend,
    indicatorTrend,
    structureTrend,
    momentum,
    volumes
  ) {
    // Pesos para cada tipo de análise
    const weights = {
      price: 0.3,
      indicators: 0.25,
      structure: 0.2,
      momentum: 0.15,
      volume: 0.1,
    };

    // Calcular direção combinada
    const directions = [
      { direction: priceTrend.direction, weight: weights.price },
      { direction: indicatorTrend.direction, weight: weights.indicators },
      { direction: structureTrend.direction, weight: weights.structure },
      {
        direction: momentum.strength > 0.5 ? priceTrend.direction : "neutral",
        weight: weights.momentum,
      },
      {
        direction:
          volumes.trend === "increasing" ? priceTrend.direction : "neutral",
        weight: weights.volume,
      },
    ];

    const direction = this.calculateWeightedDirection(directions);

    // Calcular força combinada
    const strength =
      priceTrend.strength * weights.price +
      indicatorTrend.strength * weights.indicators +
      structureTrend.strength * weights.structure +
      momentum.strength * weights.momentum +
      (volumes.current / volumes.average) * weights.volume;

    // Calcular confiança baseada na consistência dos sinais
    const confidence = this.calculateSignalConsistency(
      priceTrend,
      indicatorTrend,
      structureTrend,
      momentum,
      volumes
    );

    return {
      direction,
      strength: Math.min(strength, 1),
      confidence,
      details: {
        priceTrend,
        indicatorTrend,
        structureTrend,
        momentum,
        volumes,
      },
    };
  }
  calculateSignalConsistency(
    priceTrend,
    indicatorTrend,
    structureTrend,
    momentum,
    volumes
  ) {
    const signals = [
      priceTrend.direction,
      indicatorTrend.direction,
      structureTrend.direction,
      momentum.strength > 0.5 ? priceTrend.direction : "neutral",
      volumes.trend === "increasing" ? priceTrend.direction : "neutral",
    ];

    const mainDirection = this.getMajorityDirection(signals);
    const consistentCount = signals.filter((s) => s === mainDirection).length;
    return consistentCount / signals.length;
  }

  calculateWeightedDirection(directions) {
    const weightedCounts = {
      up: 0,
      down: 0,
      neutral: 0,
    };

    directions.forEach(({ direction, weight }) => {
      weightedCounts[direction] += weight;
    });

    return Object.entries(weightedCounts).reduce((a, b) =>
      a[1] > b[1] ? a : b
    )[0];
  }

  validateSignal(signal, historicalData) {
    const minimumConfidence = 0.75;
    const minimumStrength = 0.6;

    if (
      signal.confidence < minimumConfidence ||
      signal.strength < minimumStrength
    ) {
      return false;
    }

    // Verificar condições de mercado
    const marketConditions = this.analyzeMarketConditions(historicalData);
    if (!marketConditions.isFavorable) {
      return false;
    }

    // Verificar divergências
    if (signal.divergences.length > 0) {
      return false;
    }

    // Verificar proximidade de níveis importantes
    if (this.isNearKeyLevel(signal.entryPoints.suggested, historicalData)) {
      return false;
    }

    return true;
  }
  async predictNextMove(prices) {
    try {
      const trend = await this.analyzeTrend(prices);
      const indicators = this.calculateIndicators(prices);
      const priceAction = this.analyzePriceAction(prices);

      // Análise de níveis importantes
      const nearestSupport = this.findNearestLevel(
        prices[prices.length - 1],
        priceAction.support
      );
      const nearestResistance = this.findNearestLevel(
        prices[prices.length - 1],
        priceAction.resistance
      );

      // Verificar divergências
      const divergences = this.checkDivergences(prices, indicators);

      // Calcular probabilidade de reversão
      const reversalProbability = this.calculateReversalProbability(
        trend,
        indicators,
        priceAction,
        divergences
      );

      // Determinar pontos de entrada
      const entryPoints = this.calculateEntryPoints(
        prices[prices.length - 1],
        trend,
        nearestSupport,
        nearestResistance
      );

      // Calcular stops dinâmicos
      const stopLevels = this.calculateStopLevels(
        prices,
        trend.direction,
        entryPoints
      );

      return {
        ...trend,
        entryPoints,
        stopLevels,
        reversalProbability,
        divergences,
      };
    } catch (error) {
      console.error("Erro na previsão:", error);
      return null;
    }
  }

  confirmTrend(trends, priceAction) {
    // Análise de concordância entre timeframes
    const directions = Object.values(trends).map((t) => t.direction);
    const mainDirection = directions.reduce((a, b) =>
      directions.filter((v) => v === a).length >=
      directions.filter((v) => v === b).length
        ? a
        : b
    );

    // Verificar se a tendência está se fortalecendo ou enfraquecendo
    const recentSwings = priceAction.swings.slice(-4);
    const swingConfirmation = this.analyzeSwings(recentSwings, mainDirection);

    return {
      direction: mainDirection,
      confirmed: swingConfirmation.confirmed,
      strength: swingConfirmation.strength,
    };
  }
  isIncreasing(numbers) {
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] <= numbers[i - 1]) return false;
    }
    return true;
  }

  isDecreasing(numbers) {
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] >= numbers[i - 1]) return false;
    }
    return true;
  }
  analyzeSwings(swings, direction) {
    if (swings.length < 2) return { confirmed: false, strength: 0 };

    const highs = swings.filter((s) => s.type === "high").map((s) => s.price);
    const lows = swings.filter((s) => s.type === "low").map((s) => s.price);

    if (direction === "up") {
      const higherHighs = this.isIncreasing(highs);
      const higherLows = this.isIncreasing(lows);
      return {
        confirmed: higherHighs && higherLows,
        strength: higherHighs && higherLows ? 1 : 0.5,
      };
    } else {
      const lowerHighs = this.isDecreasing(highs);
      const lowerLows = this.isDecreasing(lows);
      return {
        confirmed: lowerHighs && lowerLows,
        strength: lowerHighs && lowerLows ? 1 : 0.5,
      };
    }
  }

  // Adicionar método para calcular volatilidade
  calculateVolatility(prices) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
  }

  async getPerformanceMetrics() {
    return {
      modeloAtivo: await this.evaluateModel(this.model),
      modeloBase: await this.evaluateModel(this.baselineModel),
      dadosHistoricos: this.historicalData.length,
      ultimoTreinamento: new Date(this.lastTrainingTime).toLocaleString(),
    };
  }
  // Ajustar confiança baseado em volume
  adjustConfidenceForVolume(confidence, volumeDivergence) {
    if (volumeDivergence.type === "none") return confidence;

    // Reduzir confiança se houver divergência negativa
    if (volumeDivergence.type === "negative") {
      return confidence * (1 - volumeDivergence.strength);
    }

    // Aumentar confiança se houver divergência positiva
    if (volumeDivergence.type === "positive") {
      return Math.min(confidence * (1 + volumeDivergence.strength), 1);
    }

    return confidence;
  }

  // Confirmar tendência considerando volume
  confirmTrendWithVolume(trends, priceAction, volumes) {
    const baseConfirmation = this.confirmTrend(trends, priceAction);

    // Verificar se volume suporta a tendência
    const volumeSupportsTrend =
      volumes.trend === "increasing" && volumes.current > volumes.average;

    return {
      ...baseConfirmation,
      strength: volumeSupportsTrend
        ? baseConfirmation.strength
        : baseConfirmation.strength * 0.8,
    };
  }
  analyzeRSITrend(rsi) {
    const lastRSI = rsi[rsi.length - 1];
    let direction = "neutral";
    let strength = 0;

    if (lastRSI < 30) {
      direction = "up";
      strength = (30 - lastRSI) / 30;
    } else if (lastRSI > 70) {
      direction = "down";
      strength = (lastRSI - 70) / 30;
    } else {
      direction = lastRSI > 50 ? "up" : "down";
      strength = Math.abs(50 - lastRSI) / 50;
    }

    return { direction, strength };
  }

  analyzeMACDTrend(macd) {
    const recent = macd.slice(-5);
    const lastMACD = recent[recent.length - 1];

    const direction = lastMACD.MACD > lastMACD.signal ? "up" : "down";
    const strength =
      Math.abs(lastMACD.MACD - lastMACD.signal) / Math.abs(lastMACD.MACD);

    return { direction, strength: Math.min(strength, 1) };
  }

  analyzeBollingerTrend(bollinger) {
    const recent = bollinger[bollinger.length - 1];
    const middle = recent.middle;
    const price = recent.price || middle;

    const percentB = (price - recent.lower) / (recent.upper - recent.lower);

    let direction = "neutral";
    let strength = 0;

    if (percentB < 0.2) {
      direction = "up";
      strength = 1 - percentB;
    } else if (percentB > 0.8) {
      direction = "down";
      strength = percentB;
    }

    return { direction, strength };
  }
  identifyPatterns(prices, swings) {
    try {
      // Verificar se os parâmetros são válidos
      if (!Array.isArray(prices) || prices.length < this.minPrices) {
        console.log(
          "Dados de preços insuficientes para identificação de padrões"
        );
        return this.getDefaultPatterns();
      }

      // Gerar swings se não fornecidos
      const actualSwings = swings || this.identifySwings(prices);

      return {
        doubleTop: this.findDoubleTop(prices, actualSwings),
        doubleBottom: this.findDoubleBottom(prices, actualSwings),
        headAndShoulders: this.findHeadAndShoulders(prices, actualSwings),
        triangles: this.findTriangles(prices, actualSwings),
      };
    } catch (error) {
      console.error("Erro em identifyPatterns:", error);
      return this.getDefaultPatterns();
    }
  }
  getDefaultPatterns() {
    return {
      doubleTop: false,
      doubleBottom: false,
      headAndShoulders: false,
      triangles: { ascending: false, descending: false },
    };
  }

  identifyKeyLevels(prices, swings) {
    const levels = {
      support: [],
      resistance: [],
      pivot: null,
    };

    // Identificar níveis de suporte e resistência
    swings.forEach((swing) => {
      if (swing.type === "low") {
        levels.support.push(swing.price);
      } else {
        levels.resistance.push(swing.price);
      }
    });

    // Calcular pivot point
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const close = prices[prices.length - 1];
    levels.pivot = (high + low + close) / 3;

    return levels;
  }
  calculateMomentumStrength(prices, rsi, macd) {
    const priceChange = (prices[prices.length - 1] - prices[0]) / prices[0];
    const rsiStrength = Math.abs(rsi[rsi.length - 1] - 50) / 50;
    const macdStrength = Math.abs(macd[macd.length - 1].MACD);

    return (Math.abs(priceChange) + rsiStrength + macdStrength) / 3;
  }

  checkMomentumDivergences(prices, rsi, macd) {
    const divergences = [];

    // Regular Bullish Divergence
    if (this.isRegularBullishDivergence(prices, rsi)) {
      divergences.push({ type: "bullish", strength: "regular" });
    }

    // Regular Bearish Divergence
    if (this.isRegularBearishDivergence(prices, rsi)) {
      divergences.push({ type: "bearish", strength: "regular" });
    }

    return divergences;
  }

  calculateAcceleration(prices) {
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }

    const acceleration = [];
    for (let i = 1; i < returns.length; i++) {
      acceleration.push(returns[i] - returns[i - 1]);
    }

    return {
      current: acceleration[acceleration.length - 1],
      average: acceleration.reduce((a, b) => a + b, 0) / acceleration.length,
    };
  }
  // 2. Ajuste nos critérios de padrões
  findDoubleTop(prices, swings) {
    try {
      if (!Array.isArray(swings) || swings.length < 4) return false;

      const tops = swings.filter((s) => s.type === "high").slice(-4);
      if (tops.length < 2) return false;

      const tolerance = 0.0001; // Mais restritivo
      const minDistance = 10; // Mínimo de barras entre topos

      for (let i = 0; i < tops.length - 1; i++) {
        for (let j = i + 1; j < tops.length; j++) {
          const priceDiff =
            Math.abs(tops[i].price - tops[j].price) / tops[i].price;
          const indexDiff = Math.abs(tops[i].index - tops[j].index);

          if (priceDiff < tolerance && indexDiff >= minDistance) {
            // Verificar se há um vale entre os topos
            const hasValley = swings.some(
              (s) =>
                s.type === "low" &&
                s.index > tops[i].index &&
                s.index < tops[j].index &&
                s.price < Math.min(tops[i].price, tops[j].price)
            );

            if (hasValley) return true;
          }
        }
      }
      return false;
    } catch (error) {
      console.error("Erro em findDoubleTop:", error);
      return false;
    }
  }

  findDoubleBottom(prices, swings) {
    try {
      // Verificar se swings existe e é um array
      if (!Array.isArray(swings) || swings.length === 0) {
        console.warn("Dados de swings inválidos em findDoubleBottom");
        return false;
      }

      // Filtrar fundos com verificação de segurança
      const bottoms = swings.filter((s) => s && s.type === "low");

      // Verificar se há bottoms suficientes
      if (bottoms.length < 2) {
        return false;
      }

      const tolerance = 0.0002;
      const lastTwo = bottoms.slice(-2);

      // Verificar se os preços são válidos
      if (!lastTwo[0]?.price || !lastTwo[1]?.price) {
        return false;
      }

      return (
        Math.abs(lastTwo[0].price - lastTwo[1].price) / lastTwo[0].price <
        tolerance
      );
    } catch (error) {
      console.error("Erro em findDoubleBottom:", error);
      return false;
    }
  }

  findHeadAndShoulders(prices, swings) {
    try {
      // Verificar se swings existe e é um array
      if (!Array.isArray(swings) || swings.length === 0) {
        console.warn("Dados de swings inválidos em findHeadAndShoulders");
        return false;
      }

      // Filtrar topos com verificação de segurança
      const tops = swings.filter((s) => s && s.type === "high").slice(-3);

      // Verificar se há tops suficientes
      if (tops.length < 3) {
        return false;
      }

      const [leftShoulder, head, rightShoulder] = tops;
      const tolerance = 0.0003;

      // Verificar se todos os preços são válidos
      if (!leftShoulder?.price || !head?.price || !rightShoulder?.price) {
        return false;
      }

      return (
        head.price > leftShoulder.price &&
        head.price > rightShoulder.price &&
        Math.abs(leftShoulder.price - rightShoulder.price) /
          leftShoulder.price <
          tolerance
      );
    } catch (error) {
      console.error("Erro em findHeadAndShoulders:", error);
      return false;
    }
  }

  findTriangles(prices, swings) {
    try {
      // Verificar se swings existe e é um array
      if (!Array.isArray(swings) || swings.length === 0) {
        console.warn("Dados de swings inválidos em findTriangles");
        return { ascending: false, descending: false };
      }

      // Filtrar topos e fundos com verificação de segurança
      const highs = swings.filter((s) => s && s.type === "high").slice(-3);
      const lows = swings.filter((s) => s && s.type === "low").slice(-3);

      if (highs.length < 3 || lows.length < 3) {
        return { ascending: false, descending: false };
      }

      // Verificar se todos os preços são válidos
      const validHighs = highs.every((h) => h?.price !== undefined);
      const validLows = lows.every((l) => l?.price !== undefined);

      if (!validHighs || !validLows) {
        return { ascending: false, descending: false };
      }

      const highsSlope = this.calculateSlope(highs.map((h) => h.price));
      const lowsSlope = this.calculateSlope(lows.map((l) => l.price));

      return {
        ascending: lowsSlope > 0 && Math.abs(highsSlope) < 0.0001,
        descending: highsSlope < 0 && Math.abs(lowsSlope) < 0.0001,
      };
    } catch (error) {
      console.error("Erro em findTriangles:", error);
      return { ascending: false, descending: false };
    }
  }
  isRegularBullishDivergence(prices, rsi) {
    const priceLen = prices.length;
    const rsiLen = rsi.length;
    if (priceLen < 2 || rsiLen < 2) return false;

    const priceLow1 = prices[priceLen - 1];
    const priceLow2 = prices[priceLen - 2];
    const rsiLow1 = rsi[rsiLen - 1];
    const rsiLow2 = rsi[rsiLen - 2];

    return priceLow1 < priceLow2 && rsiLow1 > rsiLow2;
  }

  isRegularBearishDivergence(prices, rsi) {
    const priceLen = prices.length;
    const rsiLen = rsi.length;
    if (priceLen < 2 || rsiLen < 2) return false;

    const priceHigh1 = prices[priceLen - 1];
    const priceHigh2 = prices[priceLen - 2];
    const rsiHigh1 = rsi[rsiLen - 1];
    const rsiHigh2 = rsi[rsiLen - 2];

    return priceHigh1 > priceHigh2 && rsiHigh1 < rsiHigh2;
  }
  getRSIDirection(rsi) {
    const lastRSI = rsi[rsi.length - 1];
    if (lastRSI > 60) return "up";
    if (lastRSI < 40) return "down";
    return "neutral";
  }

  getMACDDirection(macd) {
    const lastMACD = macd[macd.length - 1];
    if (lastMACD.MACD > lastMACD.signal) return "up";
    if (lastMACD.MACD < lastMACD.signal) return "down";
    return "neutral";
  }

  getBollingerDirection(bollinger) {
    const latest = bollinger[bollinger.length - 1];
    const price = latest.price || latest.middle;

    if (price > latest.upper) return "down";
    if (price < latest.lower) return "up";
    return "neutral";
  }
  analyzeVolumeProfile(historicalData) {
    const volumes = this.calculateVolume(historicalData);
    const averageVolume = volumes.average;
    const currentVolume = volumes.current;

    return {
      isAdequate: currentVolume > averageVolume * 0.8,
      ratio: currentVolume / averageVolume,
      trend: volumes.trend,
    };
  }
  determineStructure(swings, patterns, levels) {
    const structure = {
      direction: "neutral",
      strength: 0,
      pattern: null,
    };

    // Determinar direção baseada nos swings
    const recentSwings = swings.slice(-4);
    if (recentSwings.length >= 2) {
      const highs = recentSwings.filter((s) => s.type === "high");
      const lows = recentSwings.filter((s) => s.type === "low");

      if (highs.length >= 2 && this.isIncreasing(highs.map((h) => h.price))) {
        structure.direction = "up";
        structure.strength += 0.3;
      } else if (
        lows.length >= 2 &&
        this.isDecreasing(lows.map((l) => l.price))
      ) {
        structure.direction = "down";
        structure.strength += 0.3;
      }
    }

    // Adicionar força baseada em padrões
    if (patterns.doubleBottom && structure.direction === "up")
      structure.strength += 0.2;
    if (patterns.doubleTop && structure.direction === "down")
      structure.strength += 0.2;
    if (patterns.headAndShoulders) {
      structure.direction = "down";
      structure.strength += 0.3;
    }

    return structure;
  }
  analyzeTrendStrength(historicalData) {
    try {
      if (
        !Array.isArray(historicalData) ||
        historicalData.length < this.minPrices
      ) {
        return {
          strength: 0,
          direction: "neutral",
          consistency: 0,
        };
      }

      // Calcular médias móveis para diferentes períodos
      const ma20 = this.calculateMA(historicalData, 20);
      const ma50 = this.calculateMA(historicalData, 50);
      const ma200 = this.calculateMA(
        historicalData,
        Math.min(200, historicalData.length)
      );

      const currentPrice = historicalData[historicalData.length - 1];

      // Determinar direção baseada nas médias móveis
      let direction = "neutral";
      if (currentPrice > ma20 && ma20 > ma50) {
        direction = "up";
      } else if (currentPrice < ma20 && ma20 < ma50) {
        direction = "down";
      }

      // Calcular força da tendência
      const priceVolatility = this.calculateVolatility(
        historicalData.slice(-20)
      );
      const trendDeviation = Math.abs(currentPrice - ma50) / ma50;
      const momentumStrength = this.calculateMomentumStrength(
        historicalData.slice(-14),
        this.calculateIndicators(historicalData).rsi,
        this.calculateIndicators(historicalData).macd
      );

      // Combinar diferentes métricas
      const strength =
        trendDeviation * 0.4 +
        momentumStrength * 0.4 +
        Math.min(priceVolatility * 10, 1) * 0.2;

      // Calcular consistência
      const consistency = this.calculateTrendConsistency(
        historicalData,
        direction
      );

      return {
        strength: Math.min(strength, 1),
        direction,
        consistency,
      };
    } catch (error) {
      console.error("Erro ao analisar força da tendência:", error);
      return {
        strength: 0,
        direction: "neutral",
        consistency: 0,
      };
    }
  }
  // Função para calcular consistência da tendência
  calculateTrendConsistency(prices, direction) {
    try {
      const periods = [5, 10, 20];
      let consistentPeriods = 0;

      periods.forEach((period) => {
        const slice = prices.slice(-period);
        const start = slice[0];
        const end = slice[slice.length - 1];

        if (direction === "up" && end > start) {
          consistentPeriods++;
        } else if (direction === "down" && end < start) {
          consistentPeriods++;
        }
      });

      return consistentPeriods / periods.length;
    } catch (error) {
      console.error("Erro ao calcular consistência da tendência:", error);
      return 0;
    }
  }

  // Função auxiliar para calcular média móvel
  calculateMA(prices, period) {
    const ma = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices
        .slice(i - period + 1, i + 1)
        .reduce((a, b) => a + b, 0);
      ma.push(sum / period);
    }
    return ma;
  }
  // Atualizar a função analyzeMarketConditions para usar os novos cálculos
  analyzeMarketConditions(historicalData) {
    try {
      const volatility = this.calculateVolatility(historicalData);
      const trend = this.analyzeTrendStrength(historicalData);
      const volume = this.analyzeVolumeProfile(historicalData);

      const conditions = {
        volatility: {
          value: volatility,
          isGood: volatility < 0.02,
        },
        trend: {
          ...trend,
          isGood: trend.strength > 0.6 && trend.consistency > 0.7,
        },
        volume: {
          ...volume,
          isGood: volume.isAdequate && volume.ratio > 0.8,
        },
      };

      const isFavorable =
        conditions.volatility.isGood &&
        conditions.trend.isGood &&
        conditions.volume.isGood;

      return {
        isFavorable,
        conditions,
        overallScore:
          ((conditions.volatility.isGood ? 1 : 0) +
            (conditions.trend.isGood ? 1 : 0) +
            (conditions.volume.isGood ? 1 : 0)) /
          3,
      };
    } catch (error) {
      console.error("Erro ao analisar condições de mercado:", error);
      return {
        isFavorable: false,
        conditions: {
          volatility: { isGood: false },
          trend: { isGood: false },
          volume: { isGood: false },
        },
        overallScore: 0,
      };
    }
  }

  findNearestLevel(price, levels) {
    return levels.reduce((nearest, level) => {
      const currentDiff = Math.abs(price - level);
      const nearestDiff = Math.abs(price - nearest);
      return currentDiff < nearestDiff ? level : nearest;
    });
  }

  calculateEntryPoints(currentPrice, trend, support, resistance) {
    const volatility = this.calculateVolatility([
      support,
      resistance,
      currentPrice,
    ]);

    return {
      suggested: currentPrice,
      conservative:
        trend.direction === "up"
          ? currentPrice * (1 - volatility)
          : currentPrice * (1 + volatility),
      aggressive:
        trend.direction === "up"
          ? currentPrice * (1 + volatility * 0.5)
          : currentPrice * (1 - volatility * 0.5),
    };
  }

  calculateStopLevels(prices, direction, entryPoints) {
    const atr = this.calculateATR(prices);

    return {
      tight:
        direction === "up"
          ? entryPoints.suggested * (1 - atr)
          : entryPoints.suggested * (1 + atr),
      normal:
        direction === "up"
          ? entryPoints.suggested * (1 - atr * 1.5)
          : entryPoints.suggested * (1 + atr * 1.5),
      wide:
        direction === "up"
          ? entryPoints.suggested * (1 - atr * 2)
          : entryPoints.suggested * (1 + atr * 2),
    };
  }
  calculateATR(prices, period = 14) {
    const trueRanges = [];

    for (let i = 1; i < prices.length; i++) {
      const high = prices[i];
      const low = prices[i];
      const previousClose = prices[i - 1];

      const tr1 = high - low;
      const tr2 = Math.abs(high - previousClose);
      const tr3 = Math.abs(low - previousClose);

      trueRanges.push(Math.max(tr1, tr2, tr3));
    }

    return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
  }
  calculateTrendStrength(trends, indicators, volumes) {
    try {
      // Análise de força baseada em múltiplos fatores
      const priceStrength = this.calculatePriceStrength(trends);
      const indicatorStrength = this.calculateIndicatorStrength(indicators);
      const volumeStrength = this.calculateVolumeStrength(volumes);
      const momentumStrength = this.calculateOverallMomentum(indicators);

      // Pesos para cada componente
      const weights = {
        price: 0.35,
        indicators: 0.3,
        volume: 0.2,
        momentum: 0.15,
      };

      // Cálculo ponderado da força total
      const totalStrength =
        priceStrength * weights.price +
        indicatorStrength * weights.indicators +
        volumeStrength * weights.volume +
        momentumStrength * weights.momentum;

      // Análise de consistência
      const consistency = this.analyzeTrendConsistency(trends, indicators);

      // Ajuste final baseado na consistência
      const adjustedStrength = totalStrength * consistency;

      return {
        strength: Math.min(adjustedStrength, 1),
        components: {
          price: priceStrength,
          indicators: indicatorStrength,
          volume: volumeStrength,
          momentum: momentumStrength,
        },
        consistency,
      };
    } catch (error) {
      console.error("Erro ao calcular força da tendência:", error);
      return {
        strength: 0,
        components: {
          price: 0,
          indicators: 0,
          volume: 0,
          momentum: 0,
        },
        consistency: 0,
      };
    }
  }

  calculatePriceStrength(trends) {
    try {
      const { short, medium, long } = trends;

      // Verificar alinhamento das tendências
      const alignment = this.checkTrendAlignment(short, medium, long);

      // Calcular força baseada na direção e consistência
      const shortStrength = Math.abs(short.strength || 0);
      const mediumStrength = Math.abs(medium.strength || 0);
      const longStrength = Math.abs(long.strength || 0);

      // Pesos diferentes para cada timeframe
      const weightedStrength =
        shortStrength * 0.2 + mediumStrength * 0.3 + longStrength * 0.5;

      // Ajuste baseado no alinhamento
      return weightedStrength * alignment;
    } catch (error) {
      console.error("Erro ao calcular força do preço:", error);
      return 0;
    }
  }

  calculateIndicatorStrength(indicators) {
    try {
      const { rsi, macd, bollinger } = indicators;

      // Força do RSI
      const rsiStrength = this.calculateRSIStrength(rsi);

      // Força do MACD
      const macdStrength = this.calculateMACDStrength(macd);

      // Força das Bandas de Bollinger
      const bollingerStrength = this.calculateBollingerStrength(bollinger);

      // Combinar indicadores com pesos
      return rsiStrength * 0.3 + macdStrength * 0.4 + bollingerStrength * 0.3;
    } catch (error) {
      console.error("Erro ao calcular força dos indicadores:", error);
      return 0;
    }
  }

  calculateRSIStrength(rsi) {
    const lastRSI = rsi[rsi.length - 1];

    if (lastRSI <= 30) {
      return (30 - lastRSI) / 30; // Força para tendência de alta
    } else if (lastRSI >= 70) {
      return (lastRSI - 70) / 30; // Força para tendência de baixa
    } else {
      return Math.abs(50 - lastRSI) / 50; // Força neutra
    }
  }

  calculateMACDStrength(macd) {
    const recent = macd.slice(-5);
    const lastMACD = recent[recent.length - 1];

    // Calcular força baseada na diferença entre MACD e Signal
    const difference = Math.abs(lastMACD.MACD - lastMACD.signal);
    const maxDiff = Math.max(...recent.map((m) => Math.abs(m.MACD - m.signal)));

    return difference / maxDiff;
  }

  calculateBollingerStrength(bollinger) {
    const latest = bollinger[bollinger.length - 1];
    const price = latest.price || latest.middle;

    // Calcular posição relativa nas bandas
    const bandwidth = latest.upper - latest.lower;
    const position = (price - latest.lower) / bandwidth;

    // Retornar força baseada na posição
    if (position <= 0.2) return 1 - position; // Próximo da banda inferior
    if (position >= 0.8) return position; // Próximo da banda superior
    return 0.5 - Math.abs(0.5 - position); // Força média
  }

  calculateVolumeStrength(volumes) {
    const { current, average, trend } = volumes;

    // Força baseada no volume atual vs média
    const volumeRatio = current / average;

    // Ajuste baseado na tendência do volume
    const trendMultiplier =
      trend === "increasing" ? 1.2 : trend === "decreasing" ? 0.8 : 1;

    return Math.min(volumeRatio * trendMultiplier, 1);
  }

  calculateOverallMomentum(indicators) {
    const rsiMomentum = this.calculateRSIMomentum(indicators.rsi);
    const macdMomentum = this.calculateMACDMomentum(indicators.macd);

    return (rsiMomentum + macdMomentum) / 2;
  }

  calculateRSIMomentum(rsi) {
    const recent = rsi.slice(-5);
    const change = recent[recent.length - 1] - recent[0];
    return Math.min(Math.abs(change) / 50, 1);
  }

  calculateMACDMomentum(macd) {
    const recent = macd.slice(-5);
    const histogramChange =
      recent[recent.length - 1].histogram - recent[0].histogram;
    return Math.min(Math.abs(histogramChange) / 0.001, 1);
  }

  analyzeTrendConsistency(trends, indicators) {
    try {
      if (!trends || !indicators) {
        console.warn("Dados insuficientes para análise de consistência");
        return 0;
      }

      const directions = [];

      // Adicionar direções das tendências se disponíveis
      if (trends.short?.direction) directions.push(trends.short.direction);
      if (trends.medium?.direction) directions.push(trends.medium.direction);
      if (trends.long?.direction) directions.push(trends.long.direction);

      // Adicionar direção dos indicadores se disponível
      const indicatorDirection = this.getIndicatorDirection(indicators);
      if (indicatorDirection) directions.push(indicatorDirection);

      if (directions.length === 0) {
        console.warn("Nenhuma direção disponível para análise");
        return 0;
      }

      const mainDirection = this.getMajorityDirection(directions);
      const consistentCount = directions.filter(
        (d) => d === mainDirection
      ).length;

      return consistentCount / directions.length;
    } catch (error) {
      console.error("Erro na análise de consistência:", error);
      return 0;
    }
  }

  checkTrendAlignment(short, medium, long) {
    if (!short || !medium || !long) return 0;

    const directions = [short.direction, medium.direction, long.direction];
    const aligned = directions.every((d) => d === directions[0]);

    if (aligned) return 1;

    // Retornar valor parcial baseado no alinhamento parcial
    const mainDirection = this.getMajorityDirection(directions);
    const alignedCount = directions.filter((d) => d === mainDirection).length;

    return alignedCount / directions.length;
  }

  getIndicatorDirection(indicators) {
    try {
      if (
        !indicators ||
        !indicators.rsi ||
        !indicators.macd ||
        !indicators.bollinger
      ) {
        console.warn("Indicadores incompletos para determinar direção");
        return "neutral";
      }

      const rsiDirection = this.getRSIDirection(indicators.rsi);
      const macdDirection = this.getMACDDirection(indicators.macd);
      const bollingerDirection = this.getBollingerDirection(
        indicators.bollinger
      );

      const directions = [
        rsiDirection,
        macdDirection,
        bollingerDirection,
      ].filter((direction) => direction !== undefined);

      if (directions.length === 0) {
        return "neutral";
      }

      return this.getMajorityDirection(directions);
    } catch (error) {
      console.error("Erro ao obter direção dos indicadores:", error);
      return "neutral";
    }
  }
}

module.exports = new MarketAnalyzer();
