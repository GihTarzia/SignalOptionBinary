const tf = require("@tensorflow/tfjs");
const technicalIndicators = require("technicalindicators");
const moment = require("moment");

class MarketAnalyzer {
  constructor() {
    this.initialize();
    this.minPrices = 30;
    this.timeframes = {
      M1: 60, // 1 minuto
      M5: 300, // 5 minutos
      M15: 900, // 15 minutos
      M30: 1800, // 30 minutos
    };

    // Configurações de análise
    this.config = {
      minConfidence: 0.95, // Confiança mínima para gerar sinal
      volumeThreshold: 1.2, // Volume mínimo em relação à média
      trendStrengthMin: 0.7, // Força mínima da tendência
      rsiOverbought: 70, // Nível de sobrecompra
      rsiOversold: 30, // Nível de sobrevenda
      bollingerPeriod: 20, // Período das Bandas de Bollinger
      bollingerStdDev: 2, // Desvio padrão das Bandas
      macdFast: 12, // Período rápido do MACD
      macdSlow: 26, // Período lento do MACD
      macdSignal: 9, // Período do sinal do MACD
      minimumTicks: 100, // Mínimo de ticks para análise
    };

    // Cache de análises
    this.analysisCache = new Map();
    this.cacheDuration = 30000; // 30 segundos
  }

  async initialize() {
    try {
      this.initialized = true;
      console.log("MarketAnalyzer inicializado com sucesso");
    } catch (error) {
      console.error("Erro ao inicializar MarketAnalyzer:", error);
      throw error;
    }
  }

  async analyzeTrend(prices, additionalData = {}) {
    try {
      if (!Array.isArray(prices) || prices.length < this.config.minimumTicks) {
        return {
          direction: "neutral",
          confidence: 0,
          strength: 0,
          details: null,
        };
      }

      // Verificar cache
      const cacheKey = this.generateCacheKey(prices);
      const cachedAnalysis = this.getFromCache(cacheKey);
      if (cachedAnalysis) return cachedAnalysis;

      // Análise técnica completa
      const indicators = this.calculateIndicators(prices);
      const volume = this.calculateVolume(prices);
      const patterns = this.identifyPatterns(prices);
      const trends = this.analyzeTrendsByTimeframe(prices);
      const volatility = this.calculateVolatility(prices);
      const momentum = this.calculateMomentum(prices, indicators);

      // Análise principal
      const analysis = this.combineAnalyses({
        indicators,
        volume,
        patterns,
        trends,
        volatility,
        momentum,
        additionalData,
      });

      // Validação final
      const validatedAnalysis = this.validateAnalysis(analysis);

      // Atualizar cache
      this.updateCache(cacheKey, validatedAnalysis);

      return validatedAnalysis;
    } catch (error) {
      console.error("Erro na análise de tendência:", error);
      return null;
    }
  }

  calculateIndicators(prices) {
    try {
      const rsi = technicalIndicators.RSI.calculate({
        values: prices,
        period: 14,
      });

      const macd = technicalIndicators.MACD.calculate({
        values: prices,
        fastPeriod: this.config.macdFast,
        slowPeriod: this.config.macdSlow,
        signalPeriod: this.config.macdSignal,
      });

      const bollinger = technicalIndicators.BollingerBands.calculate({
        values: prices,
        period: this.config.bollingerPeriod,
        stdDev: this.config.bollingerStdDev,
      });

      const ema20 = technicalIndicators.EMA.calculate({
        values: prices,
        period: 20,
      });

      const ema50 = technicalIndicators.EMA.calculate({
        values: prices,
        period: 50,
      });

      return {
        rsi: this.normalizeIndicator(rsi),
        macd: this.normalizeMACD(macd),
        bollinger: this.normalizeBollinger(bollinger),
        ema: {
          ema20: this.normalizeIndicator(ema20),
          ema50: this.normalizeIndicator(ema50),
        },
      };
    } catch (error) {
      console.error("Erro ao calcular indicadores:", error);
      return null;
    }
  }

  normalizeIndicator(indicator) {
    if (!Array.isArray(indicator) || indicator.length === 0) return [];
    const lastValues = indicator.slice(-5);
    return {
      current: lastValues[lastValues.length - 1],
      previous: lastValues[lastValues.length - 2],
      history: lastValues,
      trend: this.calculateIndicatorTrend(lastValues),
    };
  }

  calculateIndicatorTrend(values) {
    if (values.length < 2) return "neutral";
    const last = values[values.length - 1];
    const previous = values[values.length - 2];
    return last > previous ? "up" : last < previous ? "down" : "neutral";
  }

  normalizeMACD(macd) {
    if (!Array.isArray(macd) || macd.length === 0) return null;
    const lastMACD = macd[macd.length - 1];
    return {
      value: lastMACD.MACD,
      signal: lastMACD.signal,
      histogram: lastMACD.histogram,
      trend: lastMACD.MACD > lastMACD.signal ? "up" : "down",
      strength: Math.abs(lastMACD.MACD - lastMACD.signal),
    };
  }

  normalizeBollinger(bollinger) {
    if (!Array.isArray(bollinger) || bollinger.length === 0) return null;
    const last = bollinger[bollinger.length - 1];
    return {
      upper: last.upper,
      middle: last.middle,
      lower: last.lower,
      bandwidth: (last.upper - last.lower) / last.middle,
      percentB: (last.close - last.lower) / (last.upper - last.lower),
    };
  }
  calculateVolume(prices) {
    try {
      if (prices.length < 2) return null;

      // Cálculo de volume sintético baseado em variação de preços
      const volumes = [];
      let avgChange = 0;

      for (let i = 1; i < prices.length; i++) {
        const change = Math.abs(prices[i] - prices[i - 1]);
        avgChange += change;
      }
      avgChange /= prices.length - 1;

      // Gerar volumes com base na volatilidade
      for (let i = 1; i < prices.length; i++) {
        const change = Math.abs(prices[i] - prices[i - 1]);
        const volatilityFactor = change / avgChange;
        volumes.push(1000000 * volatilityFactor); // Volume base * fator de volatilidade
      }

      const recentVolumes = volumes.slice(-20);
      const averageVolume =
        recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
      const currentVolume = volumes[volumes.length - 1];

      return {
        current: currentVolume,
        average: averageVolume,
        ratio: currentVolume / averageVolume,
        trend: this.analyzeVolumeTrend(recentVolumes),
        isStrong: currentVolume > averageVolume * this.config.volumeThreshold,
      };
    } catch (error) {
      console.error("Erro ao calcular volume:", error);
      return null;
    }
  }

  analyzeVolumeTrend(volumes) {
    const recentChange =
      (volumes[volumes.length - 1] - volumes[0]) / volumes[0];
    if (recentChange > 0.1) return "increasing";
    if (recentChange < -0.1) return "decreasing";
    return "stable";
  }

  analyzeTrendsByTimeframe(prices) {
    try {
      const trends = {};
      const timeframes = [5, 15, 30, 60]; // Períodos em minutos

      timeframes.forEach((period) => {
        const periodPrices = prices.slice(-period);
        trends[`M${period}`] = this.analyzeSingleTimeframe(periodPrices);
      });

      return {
        trends,
        alignment: this.checkTrendAlignment(trends),
        strength: this.calculateTrendStrength(trends),
      };
    } catch (error) {
      console.error("Erro na análise de timeframes:", error);
      return null;
    }
  }

  analyzeSingleTimeframe(prices) {
    if (prices.length < 2) return { direction: "neutral", strength: 0 };

    const first = prices[0];
    const last = prices[prices.length - 1];
    const highLow = this.calculateHighLow(prices);
    const linearRegression = this.calculateLinearRegression(prices);

    return {
      direction: this.determineTrendDirection(
        first,
        last,
        linearRegression.slope
      ),
      strength: this.calculateSingleTrendStrength(
        prices,
        highLow,
        linearRegression
      ),
      regression: linearRegression,
    };
  }

  calculateHighLow(prices) {
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    return { high, low, range: high - low };
  }

  calculateLinearRegression(prices) {
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    const n = prices.length;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += prices[i];
      sumXY += i * prices[i];
      sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const rSquared = this.calculateRSquared(prices, slope, intercept);

    return { slope, intercept, rSquared };
  }

  calculateRSquared(prices, slope, intercept) {
    const mean = prices.reduce((a, b) => a + b) / prices.length;
    let totalSS = 0;
    let residualSS = 0;

    prices.forEach((price, i) => {
      totalSS += Math.pow(price - mean, 2);
      residualSS += Math.pow(price - (slope * i + intercept), 2);
    });

    return 1 - residualSS / totalSS;
  }

  determineTrendDirection(first, last, slope) {
    const priceChange = (last - first) / first;
    const threshold = 0.0001; // Ajuste conforme necessário

    if (Math.abs(priceChange) < threshold) return "neutral";
    if (slope > 0 && priceChange > 0) return "up";
    if (slope < 0 && priceChange < 0) return "down";
    return "neutral";
  }

  calculateSingleTrendStrength(prices, highLow, regression) {
    const volatility = this.calculateVolatility(prices);
    const trendConsistency = regression.rSquared;
    const priceRange = highLow.range / prices[0];

    return {
      value: trendConsistency * 0.4 + (1 - volatility) * 0.3 + priceRange * 0.3,
      components: {
        consistency: trendConsistency,
        volatility: volatility,
        range: priceRange,
      },
    };
  }

  checkTrendAlignment(trends) {
    const directions = Object.values(trends).map((t) => t.direction);
    const mainDirection = this.getMajorityDirection(directions);
    const alignedCount = directions.filter((d) => d === mainDirection).length;

    return {
      direction: mainDirection,
      strength: alignedCount / directions.length,
      isAligned: alignedCount === directions.length,
    };
  }

  calculateTrendStrength(trends) {
    const strengths = Object.values(trends).map((t) => t.strength.value);
    const averageStrength =
      strengths.reduce((a, b) => a + b) / strengths.length;
    const alignment = this.checkTrendAlignment(trends);

    return averageStrength * alignment.strength;
  }

  getMajorityDirection(directions) {
    const counts = directions.reduce((acc, dir) => {
      acc[dir] = (acc[dir] || 0) + 1;
      return acc;
    }, {});

    return Object.entries(counts).reduce((a, b) => (a[1] > b[1] ? a : b))[0];
  }

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
  combineAnalyses(data) {
    try {
      const { indicators, volume, patterns, trends, volatility, momentum } =
        data;

      // Verificar dados mínimos necessários
      if (!indicators || !trends) {
        throw new Error("Dados insuficientes para análise");
      }

      // Análise de indicadores técnicos
      const indicatorSignals = this.analyzeIndicatorSignals(indicators);

      // Análise de tendência e momento
      const trendAnalysis = this.analyzeTrendAndMomentum(trends, momentum);

      // Análise de volume e volatilidade
      const marketConditions = this.analyzeMarketConditions(volume, volatility);

      // Confirmação de padrões
      const patternConfirmation = this.validatePatterns(
        patterns,
        trends.trends
      );

      // Combinar todas as análises
      const combinedAnalysis = this.generateFinalAnalysis({
        indicatorSignals,
        trendAnalysis,
        marketConditions,
        patternConfirmation,
      });

      return this.formatAnalysisResult(combinedAnalysis);
    } catch (error) {
      console.error("Erro na combinação de análises:", error);
      return null;
    }
  }
  analyzeIndicatorSignals(indicators) {
    try {
      if (!indicators) {
        console.warn("Indicadores ausentes em analyzeIndicatorSignals");
        return {
          direction: "neutral",
          strength: 0,
          signals: {},
        };
      }

      console.log(
        "Indicadores recebidos:",
        JSON.stringify(indicators, null, 2)
      );

      const { rsi, macd, bollinger, ema } = indicators;
      const signals = [];

      // RSI Analysis
      if (rsi && rsi.current) {
        const rsiSignal = this.analyzeRSI(rsi);
        console.log("Sinal RSI:", rsiSignal);
        if (rsiSignal && rsiSignal.direction !== "neutral") {
          signals.push(rsiSignal);
        }
      }

      // MACD Analysis
      if (macd && macd.histogram) {
        const macdSignal = this.analyzeMACD(macd);
        console.log("Sinal MACD:", macdSignal);
        if (macdSignal && macdSignal.direction !== "neutral") {
          signals.push(macdSignal);
        }
      }

      // Bollinger Analysis
      if (bollinger && bollinger.upper && bollinger.lower) {
        const bollingerSignal = this.analyzeBollinger(bollinger);
        console.log("Sinal Bollinger:", bollingerSignal);
        if (bollingerSignal && bollingerSignal.direction !== "neutral") {
          signals.push(bollingerSignal);
        }
      }

      // EMA Analysis
      if (ema && ema.ema20 && ema.ema50) {
        const emaSignal = this.analyzeEMA(ema);
        console.log("Sinal EMA:", emaSignal);
        if (emaSignal && emaSignal.direction !== "neutral") {
          signals.push(emaSignal);
        }
      }

      console.log("Sinais válidos coletados:", signals.length);

      // Se não houver sinais válidos, retornar neutral
      if (signals.length === 0) {
        console.log("Nenhum sinal válido encontrado");
        return {
          direction: "neutral",
          strength: 0,
          signals: {},
        };
      }

      // Determinar direção dominante
      const direction = this.determineOverallDirection(signals);
      console.log("Direção calculada:", direction);

      // Calcular força média apenas dos sinais válidos
      const strength =
        signals.reduce((acc, signal) => acc + (signal.strength || 0), 0) /
        signals.length;

      const result = {
        direction,
        strength: Math.min(strength, 1),
        signals: {
          rsi: signals.find((s) => s.type === "rsi"),
          macd: signals.find((s) => s.type === "macd"),
          bollinger: signals.find((s) => s.type === "bollinger"),
          ema: signals.find((s) => s.type === "ema"),
        },
      };

      console.log("Resultado final da análise:", result);
      return result;
    } catch (error) {
      console.error("Erro na análise de indicadores:", error);
      return {
        direction: "neutral",
        strength: 0,
        signals: {},
      };
    }
  }

  analyzeRSI(rsi) {
    const current = rsi.current;
    let direction = "neutral";
    let strength = 0;

    if (current <= 30) {
      direction = "up";
      strength = 1 - current / 30;
    } else if (current >= 70) {
      direction = "down";
      strength = (current - 70) / 30;
    } else if (current < 45) {
      direction = "up";
      strength = (45 - current) / 15;
    } else if (current > 55) {
      direction = "down";
      strength = (current - 55) / 15;
    }

    return {
      type: "rsi",
      direction,
      strength: Math.min(Math.max(strength, 0), 1),
    };
  }

  analyzeMACD(macd) {
    const signal = {
      type: "macd",
      direction: "neutral",
      strength: 0,
    };

    if (macd.histogram > 0 && macd.value > macd.signal) {
      signal.direction = "up";
      signal.strength = Math.min(Math.abs(macd.histogram) / 0.001, 1);
    } else if (macd.histogram < 0 && macd.value < macd.signal) {
      signal.direction = "down";
      signal.strength = Math.min(Math.abs(macd.histogram) / 0.001, 1);
    }

    return signal;
  }

  analyzeBollinger(bollinger) {
    const price = bollinger.price || bollinger.middle;
    const signal = {
      type: "bollinger",
      direction: "neutral",
      strength: 0,
    };

    const bandwidth = bollinger.upper - bollinger.lower;
    const position = (price - bollinger.lower) / bandwidth;

    if (position <= 0.2) {
      signal.direction = "up";
      signal.strength = 1 - position;
    } else if (position >= 0.8) {
      signal.direction = "down";
      signal.strength = position;
    }

    return signal;
  }

  analyzeEMA(ema) {
    const signal = {
      type: "ema",
      direction: "neutral",
      strength: 0,
    };

    if (ema.ema20.current > ema.ema50.current) {
      signal.direction = "up";
      signal.strength = Math.min(
        ((ema.ema20.current - ema.ema50.current) / ema.ema50.current) * 100,
        1
      );
    } else if (ema.ema20.current < ema.ema50.current) {
      signal.direction = "down";
      signal.strength = Math.min(
        ((ema.ema50.current - ema.ema20.current) / ema.ema50.current) * 100,
        1
      );
    }

    return signal;
  }

  analyzeTrendAndMomentum(trends, momentum) {
    const trendAlignment = trends.alignment;
    const momentumStrength = momentum ? momentum.strength : 0;

    return {
      direction: trendAlignment.direction,
      strength: trendAlignment.strength * 0.7 + momentumStrength * 0.3,
      isConfirmed: trendAlignment.isAligned && momentumStrength > 0.7,
    };
  }

  analyzeMarketConditions(volume, volatility) {
    const volumeQuality = volume ? this.analyzeVolumeQuality(volume) : 0;
    const volatilityQuality = this.analyzeVolatilityQuality(volatility);

    return {
      isFavorable: volumeQuality > 0.7 && volatilityQuality > 0.7,
      quality: (volumeQuality + volatilityQuality) / 2,
      details: {
        volume: volumeQuality,
        volatility: volatilityQuality,
      },
    };
  }

  analyzeVolumeQuality(volume) {
    if (!volume) return 0;

    const volumeRatio = volume.ratio;
    const volumeTrend =
      volume.trend === "increasing" ? 1 : volume.trend === "stable" ? 0.5 : 0;

    return Math.min(volumeRatio * 0.7 + volumeTrend * 0.3, 1);
  }

  analyzeVolatilityQuality(volatility) {
    if (!volatility) return 0;

    // Volatilidade ideal entre 0.001 e 0.005
    if (volatility < 0.001) return volatility / 0.001;
    if (volatility > 0.005)
      return Math.max(0, 1 - (volatility - 0.005) / 0.005);
    return 1;
  }

  validatePatterns(patterns, trends) {
    if (!patterns) return { isValid: false, strength: 0 };

    const patternStrength = this.calculatePatternStrength(patterns);
    const trendConfirmation = this.checkPatternTrendAlignment(patterns, trends);

    return {
      isValid: patternStrength > 0.7 && trendConfirmation,
      strength: patternStrength * (trendConfirmation ? 1 : 0.5),
    };
  }

  generateFinalAnalysis(data) {
    const {
      indicatorSignals,
      trendAnalysis,
      marketConditions,
      patternConfirmation,
    } = data;

    // Pesos para cada componente
    const weights = {
      indicators: 0.35,
      trend: 0.3,
      market: 0.25,
      patterns: 0.1,
    };

    // Calcular pontuação final
    const score =
      indicatorSignals.strength * weights.indicators +
      trendAnalysis.strength * weights.trend +
      marketConditions.quality * weights.market +
      patternConfirmation.strength * weights.patterns;

    // Determinar direção final
    const direction = this.determineOverallDirection({
      indicators: indicatorSignals.direction,
      trend: trendAnalysis.direction,
    });

    return {
      direction,
      score,
      confidence: this.calculateConfidence({
        score,
        marketConditions,
        trendAnalysis,
      }),
      details: {
        indicators: indicatorSignals,
        trend: trendAnalysis,
        market: marketConditions,
        patterns: patternConfirmation,
      },
    };
  }
  calculateConfidence(data) {
    const { score, marketConditions, trendAnalysis } = data;

    // Fatores de ajuste
    const marketFactor = marketConditions.isFavorable ? 1 : 0.7;
    const trendFactor = trendAnalysis.isConfirmed ? 1 : 0.8;

    // Cálculo base de confiança
    let confidence = score * marketFactor * trendFactor;

    // Ajustes finais
    confidence = this.applyConfidenceAdjustments(confidence, data);

    // Garantir limites
    return Math.min(Math.max(confidence, 0), 1);
  }

  applyConfidenceAdjustments(confidence, data) {
    // Reduzir confiança se houver sinais contraditórios
    if (this.hasContradictorySignals(data)) {
      confidence *= 0.8;
    }

    // Reduzir se a volatilidade estiver muito alta
    if (data.marketConditions.details.volatility < 0.5) {
      confidence *= 0.9;
    }

    return confidence;
  }

  hasContradictorySignals(data) {
    const directions = [
      data.indicators?.direction,
      data.trend?.direction,
    ].filter(Boolean);

    return directions.some((dir) => dir !== directions[0]);
  }

  formatAnalysisResult(analysis) {
    if (!analysis) return null;

    const { direction, confidence, details } = analysis;

    // Só gerar sinal se atingir confiança mínima
    if (confidence < this.config.minConfidence) {
      return {
        direction: "neutral",
        confidence: 0,
        shouldTrade: false,
        details: details,
      };
    }

    // Calcular níveis de entrada e saída
    const levels = this.calculateTradingLevels(details);

    return {
      direction: direction,
      confidence: confidence,
      shouldTrade: true,
      suggestedEntry: levels.entry,
      stopLoss: levels.stopLoss,
      takeProfit: levels.takeProfit,
      timeframe: this.determineBestTimeframe(details),
      details: {
        ...details,
        levels,
      },
    };
  }

  calculateTradingLevels(details) {
    const { trend, market } = details;
    const volatility = market.details.volatility;
    const atr = this.calculateATR(trend.prices);

    return {
      entry: trend.current,
      stopLoss: this.calculateStopLoss(trend, atr, volatility),
      takeProfit: this.calculateTakeProfit(trend, atr, volatility),
    };
  }

  calculateATR(prices, period = 14) {
    if (!prices || prices.length < period) return 0;

    const trs = [];
    for (let i = 1; i < prices.length; i++) {
      const high = prices[i];
      const low = prices[i];
      const prevClose = prices[i - 1];

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.slice(-period).reduce((a, b) => a + b) / period;
  }

  calculateStopLoss(trend, atr, volatility) {
    const direction = trend.direction;
    const multiplier = 2 + volatility * 2; // Ajusta com base na volatilidade

    return direction === "up"
      ? trend.current - atr * multiplier
      : trend.current + atr * multiplier;
  }

  calculateTakeProfit(trend, atr, volatility) {
    const direction = trend.direction;
    const multiplier = 3 + volatility * 2; // Maior que SL para RR positivo

    return direction === "up"
      ? trend.current + atr * multiplier
      : trend.current - atr * multiplier;
  }

  determineBestTimeframe(details) {
    const { trend, market } = details;
    const volatility = market.details.volatility;

    // Ajustar timeframe baseado na volatilidade e força da tendência
    if (volatility > 0.004 || trend.strength < 0.6) {
      return this.timeframes.M5; // Mais conservador
    } else if (trend.strength > 0.8 && volatility < 0.002) {
      return this.timeframes.M1; // Mais agressivo
    }
    return this.timeframes.M15; // Moderado
  }

  // Funções de Cache
  generateCacheKey(prices) {
    return prices.slice(-5).join(",");
  }

  getFromCache(key) {
    const cached = this.analysisCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.data;
    }
    return null;
  }

  updateCache(key, data) {
    this.analysisCache.set(key, {
      data,
      timestamp: Date.now(),
    });

    // Limpar cache antigo
    this.cleanupCache();
  }

  cleanupCache() {
    const now = Date.now();
    for (const [key, value] of this.analysisCache.entries()) {
      if (now - value.timestamp > this.cacheDuration) {
        this.analysisCache.delete(key);
      }
    }
  }

  // Função pública para previsão
  async predictNextMove(prices) {
    const analysis = await this.analyzeTrend(prices);
    if (!analysis || !analysis.shouldTrade) {
      return null;
    }

    return {
      direction: analysis.direction,
      confidence: analysis.confidence,
      suggestedEntry: analysis.suggestedEntry,
      stopLoss: analysis.stopLoss,
      takeProfit: analysis.takeProfit,
      timeFrame: analysis.timeframe,
      indicators: analysis.details.indicators,
    };
  }
  identifyPatterns(prices) {
    try {
      if (!Array.isArray(prices) || prices.length < 30) {
        return {
          patterns: [],
          strength: 0,
          reliability: 0,
        };
      }

      const patterns = {
        doubleTop: this.findDoubleTop(prices),
        doubleBottom: this.findDoubleBottom(prices),
        headAndShoulders: this.findHeadAndShoulders(prices),
        inverseHeadAndShoulders: this.findInverseHeadAndShoulders(prices),
        triangles: this.findTrianglePatterns(prices),
      };

      const strengthAndReliability = this.calculatePatternMetrics(patterns);

      return {
        patterns,
        ...strengthAndReliability,
      };
    } catch (error) {
      console.error("Erro na identificação de padrões:", error);
      return {
        patterns: [],
        strength: 0,
        reliability: 0,
      };
    }
  }
  checkPatternTrendAlignment(patterns, trends) {
    try {
      if (!patterns || !trends) {
        return false;
      }

      // Obter direção dominante da tendência
      const trendDirection = this.getTrendDirection(trends);

      // Se não houver tendência clara, retornar falso
      if (trendDirection === "neutral") {
        return false;
      }

      // Verificar alinhamento de cada padrão com a tendência
      return this.validatePatternAlignment(patterns, trendDirection);
    } catch (error) {
      console.error(
        "Erro ao verificar alinhamento de padrões com tendência:",
        error
      );
      return false;
    }
  }

  getTrendDirection(trends) {
    try {
      if (!trends) return "neutral";

      // Pesos para diferentes timeframes
      const weights = {
        M5: 0.2, // 5 minutos
        M15: 0.3, // 15 minutos
        M30: 0.5, // 30 minutos
      };

      const directions = {
        up: 0,
        down: 0,
        neutral: 0,
      };

      // Somar direções ponderadas
      Object.entries(trends).forEach(([timeframe, trend]) => {
        if (trend && trend.direction && weights[timeframe]) {
          directions[trend.direction] += weights[timeframe];
        }
      });

      // Encontrar direção dominante
      const dominantDirection = Object.entries(directions).reduce((a, b) =>
        a[1] > b[1] ? a : b
      )[0];

      // Verificar se a direção dominante é significativa
      const totalWeight = Object.values(directions).reduce((a, b) => a + b, 0);
      const threshold = 0.6; // 60% dos sinais precisam concordar

      return directions[dominantDirection] / totalWeight >= threshold
        ? dominantDirection
        : "neutral";
    } catch (error) {
      console.error("Erro ao determinar direção da tendência:", error);
      return "neutral";
    }
  }

  validatePatternAlignment(patterns, trendDirection) {
    try {
      // Verificar padrões de reversão
      if (patterns.doubleTop && patterns.doubleTop.found) {
        if (trendDirection !== "down") return false;
      }

      if (patterns.doubleBottom && patterns.doubleBottom.found) {
        if (trendDirection !== "up") return false;
      }

      if (patterns.headAndShoulders && patterns.headAndShoulders.found) {
        if (trendDirection !== "down") return false;
      }

      if (
        patterns.inverseHeadAndShoulders &&
        patterns.inverseHeadAndShoulders.found
      ) {
        if (trendDirection !== "up") return false;
      }

      // Verificar padrões de continuação
      if (patterns.triangles) {
        const triangleAlignment = this.checkTriangleAlignment(
          patterns.triangles,
          trendDirection
        );
        if (!triangleAlignment) return false;
      }

      return true;
    } catch (error) {
      console.error("Erro ao validar alinhamento de padrões:", error);
      return false;
    }
  }

  checkTriangleAlignment(triangles, trendDirection) {
    try {
      if (!triangles) return true;

      // Verificar triângulo ascendente
      if (triangles.ascending && triangles.ascending.found) {
        if (trendDirection !== "up") return false;
      }

      // Verificar triângulo descendente
      if (triangles.descending && triangles.descending.found) {
        if (trendDirection !== "down") return false;
      }

      // Triângulo simétrico pode ser válido em qualquer direção
      if (triangles.symmetric && triangles.symmetric.found) {
        return true;
      }

      return true;
    } catch (error) {
      console.error("Erro ao verificar alinhamento de triângulos:", error);
      return false;
    }
  }

  isPatternValid(pattern, trendDirection) {
    if (!pattern || !pattern.found) return true;

    // Verificar força mínima do padrão
    const minStrength = 0.7;
    if (pattern.strength < minStrength) return false;

    // Verificar alinhamento com a tendência
    switch (pattern.type) {
      case "doubleTop":
        return trendDirection === "down";
      case "doubleBottom":
        return trendDirection === "up";
      case "headAndShoulders":
        return trendDirection === "down";
      case "inverseHeadAndShoulders":
        return trendDirection === "up";
      default:
        return true;
    }
  }

  findDoubleTop(prices) {
    try {
      const tolerance = 0.0002; // 0.02%
      const minDistance = 5; // Mínimo de barras entre topos
      const peaks = this.findPeaks(prices);

      for (let i = 0; i < peaks.length - 1; i++) {
        const peak1 = peaks[i];
        const peak2 = peaks[i + 1];

        if (peak2.index - peak1.index >= minDistance) {
          const priceDiff = Math.abs(peak1.price - peak2.price) / peak1.price;
          if (priceDiff <= tolerance) {
            return {
              found: true,
              price1: peak1.price,
              price2: peak2.price,
              index1: peak1.index,
              index2: peak2.index,
            };
          }
        }
      }

      return { found: false };
    } catch (error) {
      console.error("Erro em findDoubleTop:", error);
      return { found: false };
    }
  }

  findDoubleBottom(prices) {
    try {
      const tolerance = 0.0002;
      const minDistance = 5;
      const troughs = this.findTroughs(prices);

      for (let i = 0; i < troughs.length - 1; i++) {
        const trough1 = troughs[i];
        const trough2 = troughs[i + 1];

        if (trough2.index - trough1.index >= minDistance) {
          const priceDiff =
            Math.abs(trough1.price - trough2.price) / trough1.price;
          if (priceDiff <= tolerance) {
            return {
              found: true,
              price1: trough1.price,
              price2: trough2.price,
              index1: trough1.index,
              index2: trough2.index,
            };
          }
        }
      }

      return { found: false };
    } catch (error) {
      console.error("Erro em findDoubleBottom:", error);
      return { found: false };
    }
  }

  findHeadAndShoulders(prices) {
    try {
      const peaks = this.findPeaks(prices);
      if (peaks.length < 3) return { found: false };

      const tolerance = 0.0002;

      for (let i = 0; i < peaks.length - 2; i++) {
        const leftShoulder = peaks[i];
        const head = peaks[i + 1];
        const rightShoulder = peaks[i + 2];

        // Verificar se o head é mais alto que os ombros
        if (
          head.price > leftShoulder.price &&
          head.price > rightShoulder.price
        ) {
          // Verificar se os ombros estão aproximadamente na mesma altura
          const shoulderDiff =
            Math.abs(leftShoulder.price - rightShoulder.price) /
            leftShoulder.price;
          if (shoulderDiff <= tolerance) {
            return {
              found: true,
              leftShoulder,
              head,
              rightShoulder,
            };
          }
        }
      }

      return { found: false };
    } catch (error) {
      console.error("Erro em findHeadAndShoulders:", error);
      return { found: false };
    }
  }

  findInverseHeadAndShoulders(prices) {
    try {
      const troughs = this.findTroughs(prices);
      if (troughs.length < 3) return { found: false };

      const tolerance = 0.0002;

      for (let i = 0; i < troughs.length - 2; i++) {
        const leftShoulder = troughs[i];
        const head = troughs[i + 1];
        const rightShoulder = troughs[i + 2];

        if (
          head.price < leftShoulder.price &&
          head.price < rightShoulder.price
        ) {
          const shoulderDiff =
            Math.abs(leftShoulder.price - rightShoulder.price) /
            leftShoulder.price;
          if (shoulderDiff <= tolerance) {
            return {
              found: true,
              leftShoulder,
              head,
              rightShoulder,
            };
          }
        }
      }

      return { found: false };
    } catch (error) {
      console.error("Erro em findInverseHeadAndShoulders:", error);
      return { found: false };
    }
  }

  findTrianglePatterns(prices) {
    try {
      const peaks = this.findPeaks(prices);
      const troughs = this.findTroughs(prices);

      return {
        ascending: this.findAscendingTriangle(peaks, troughs),
        descending: this.findDescendingTriangle(peaks, troughs),
        symmetric: this.findSymmetricTriangle(peaks, troughs),
      };
    } catch (error) {
      console.error("Erro em findTrianglePatterns:", error);
      return {
        ascending: { found: false },
        descending: { found: false },
        symmetric: { found: false },
      };
    }
  }

  findPeaks(prices) {
    const peaks = [];
    for (let i = 1; i < prices.length - 1; i++) {
      if (prices[i] > prices[i - 1] && prices[i] > prices[i + 1]) {
        peaks.push({ price: prices[i], index: i });
      }
    }
    return peaks;
  }

  findTroughs(prices) {
    const troughs = [];
    for (let i = 1; i < prices.length - 1; i++) {
      if (prices[i] < prices[i - 1] && prices[i] < prices[i + 1]) {
        troughs.push({ price: prices[i], index: i });
      }
    }
    return troughs;
  }

  findAscendingTriangle(peaks, troughs) {
    try {
      if (peaks.length < 2 || troughs.length < 2) return { found: false };

      const resistance = this.calculateResistance(peaks);
      const support = this.calculateSupport(troughs);

      if (support.slope > 0 && Math.abs(resistance.slope) < 0.0001) {
        return {
          found: true,
          resistance: resistance.level,
          support: support.level,
        };
      }

      return { found: false };
    } catch (error) {
      console.error("Erro em findAscendingTriangle:", error);
      return { found: false };
    }
  }

  findDescendingTriangle(peaks, troughs) {
    try {
      if (peaks.length < 2 || troughs.length < 2) return { found: false };

      const resistance = this.calculateResistance(peaks);
      const support = this.calculateSupport(troughs);

      if (resistance.slope < 0 && Math.abs(support.slope) < 0.0001) {
        return {
          found: true,
          resistance: resistance.level,
          support: support.level,
        };
      }

      return { found: false };
    } catch (error) {
      console.error("Erro em findDescendingTriangle:", error);
      return { found: false };
    }
  }

  findSymmetricTriangle(peaks, troughs) {
    try {
      if (peaks.length < 2 || troughs.length < 2) return { found: false };

      const resistance = this.calculateResistance(peaks);
      const support = this.calculateSupport(troughs);

      if (Math.abs(resistance.slope + support.slope) < 0.0001) {
        return {
          found: true,
          resistance: resistance.level,
          support: support.level,
        };
      }

      return { found: false };
    } catch (error) {
      console.error("Erro em findSymmetricTriangle:", error);
      return { found: false };
    }
  }

  calculateResistance(peaks) {
    if (peaks.length < 2) return { level: 0, slope: 0 };

    const x = peaks.map((p) => p.index);
    const y = peaks.map((p) => p.price);
    const regression = this.linearRegression(x, y);

    return {
      level: regression.b,
      slope: regression.m,
    };
  }

  calculateSupport(troughs) {
    if (troughs.length < 2) return { level: 0, slope: 0 };

    const x = troughs.map((t) => t.index);
    const y = troughs.map((t) => t.price);
    const regression = this.linearRegression(x, y);

    return {
      level: regression.b,
      slope: regression.m,
    };
  }

  linearRegression(x, y) {
    const n = x.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumXX += x[i] * x[i];
    }

    const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const b = (sumY - m * sumX) / n;

    return { m, b };
  }

  calculatePatternMetrics(patterns) {
    let strength = 0;
    let reliability = 0;
    let patternCount = 0;

    // Avaliar cada padrão encontrado
    if (patterns.doubleTop.found) {
      strength += 0.8;
      reliability += 0.7;
      patternCount++;
    }
    if (patterns.doubleBottom.found) {
      strength += 0.8;
      reliability += 0.7;
      patternCount++;
    }
    if (patterns.headAndShoulders.found) {
      strength += 0.9;
      reliability += 0.8;
      patternCount++;
    }
    if (patterns.inverseHeadAndShoulders.found) {
      strength += 0.9;
      reliability += 0.8;
      patternCount++;
    }
    if (
      patterns.triangles.ascending.found ||
      patterns.triangles.descending.found ||
      patterns.triangles.symmetric.found
    ) {
      strength += 0.7;
      reliability += 0.6;
      patternCount++;
    }

    // Normalizar os valores
    if (patternCount > 0) {
      strength /= patternCount;
      reliability /= patternCount;
    }

    return { strength, reliability };
  }
  calculateMomentum(prices, indicators) {
    try {
      if (!Array.isArray(prices) || prices.length < 14) {
        return {
          strength: 0,
          direction: "neutral",
          momentum: 0,
        };
      }

      // Cálculo do Rate of Change (ROC)
      const roc = this.calculateROC(prices, 14);

      // Cálculo do momentum usando RSI e MACD
      const rsiMomentum = this.calculateRSIMomentum(indicators.rsi);
      const macdMomentum = this.calculateMACDMomentum(indicators.macd);

      // Análise de aceleração de preço
      const acceleration = this.calculatePriceAcceleration(prices);

      // Combinar diferentes métricas de momentum
      const momentumStrength = this.combineMomentumMetrics({
        roc,
        rsiMomentum,
        macdMomentum,
        acceleration,
      });

      return {
        strength: momentumStrength.strength,
        direction: momentumStrength.direction,
        momentum: momentumStrength.value,
        details: {
          roc,
          rsiMomentum,
          macdMomentum,
          acceleration,
        },
      };
    } catch (error) {
      console.error("Erro ao calcular momentum:", error);
      return {
        strength: 0,
        direction: "neutral",
        momentum: 0,
      };
    }
  }

  calculateROC(prices, period) {
    try {
      if (prices.length < period + 1) {
        return {
          value: 0,
          direction: "neutral",
          strength: 0,
        };
      }

      const currentPrice = prices[prices.length - 1];
      const previousPrice = prices[prices.length - period - 1];
      const roc = ((currentPrice - previousPrice) / previousPrice) * 100;

      return {
        value: roc,
        direction: roc > 0 ? "up" : roc < 0 ? "down" : "neutral",
        strength: Math.min(Math.abs(roc) / 2, 1), // Normalizar para 0-1
      };
    } catch (error) {
      console.error("Erro ao calcular ROC:", error);
      return {
        value: 0,
        direction: "neutral",
        strength: 0,
      };
    }
  }

  calculateRSIMomentum(rsi) {
    try {
      if (!rsi || !rsi.history || rsi.history.length < 2) {
        return {
          value: 0,
          direction: "neutral",
          strength: 0,
        };
      }

      const current = rsi.current;
      const previous = rsi.previous;
      const change = current - previous;

      // Determinar força e direção
      let strength = 0;
      let direction = "neutral";

      if (current < 30) {
        strength = (30 - current) / 30;
        direction = "up"; // Condição de sobrevenda
      } else if (current > 70) {
        strength = (current - 70) / 30;
        direction = "down"; // Condição de sobrecompra
      } else {
        strength = Math.abs(change) / 20; // Normalizar para 0-1
        direction = change > 0 ? "up" : "down";
      }

      return {
        value: change,
        direction,
        strength: Math.min(strength, 1),
      };
    } catch (error) {
      console.error("Erro ao calcular momentum do RSI:", error);
      return {
        value: 0,
        direction: "neutral",
        strength: 0,
      };
    }
  }

  calculateMACDMomentum(macd) {
    try {
      if (!macd || !macd.histogram) {
        return {
          value: 0,
          direction: "neutral",
          strength: 0,
        };
      }

      const histogram = macd.histogram;
      const signal = macd.signal;
      const macdLine = macd.value;

      // Calcular força do momentum baseado na diferença MACD-Signal
      const strength = Math.min(Math.abs(macdLine - signal) / 0.001, 1);

      // Determinar direção
      let direction = "neutral";
      if (histogram > 0 && macdLine > signal) {
        direction = "up";
      } else if (histogram < 0 && macdLine < signal) {
        direction = "down";
      }

      return {
        value: histogram,
        direction,
        strength,
      };
    } catch (error) {
      console.error("Erro ao calcular momentum do MACD:", error);
      return {
        value: 0,
        direction: "neutral",
        strength: 0,
      };
    }
  }

  calculatePriceAcceleration(prices) {
    try {
      if (prices.length < 3) {
        return {
          value: 0,
          direction: "neutral",
          strength: 0,
        };
      }

      // Calcular velocidades (primeira derivada)
      const velocities = [];
      for (let i = 1; i < prices.length; i++) {
        velocities.push(prices[i] - prices[i - 1]);
      }

      // Calcular acelerações (segunda derivada)
      const accelerations = [];
      for (let i = 1; i < velocities.length; i++) {
        accelerations.push(velocities[i] - velocities[i - 1]);
      }

      // Pegar a aceleração mais recente
      const currentAcceleration = accelerations[accelerations.length - 1];

      // Normalizar a força
      const strength = Math.min(Math.abs(currentAcceleration) / 0.0001, 1);

      return {
        value: currentAcceleration,
        direction: currentAcceleration > 0 ? "up" : "down",
        strength,
      };
    } catch (error) {
      console.error("Erro ao calcular aceleração de preço:", error);
      return {
        value: 0,
        direction: "neutral",
        strength: 0,
      };
    }
  }

  combineMomentumMetrics(metrics) {
    try {
      const { roc, rsiMomentum, macdMomentum, acceleration } = metrics;

      // Pesos para cada métrica
      const weights = {
        roc: 0.25,
        rsi: 0.25,
        macd: 0.3,
        acceleration: 0.2,
      };

      // Calcular força ponderada
      const strength =
        roc.strength * weights.roc +
        rsiMomentum.strength * weights.rsi +
        macdMomentum.strength * weights.macd +
        acceleration.strength * weights.acceleration;

      // Determinar direção baseada em maioria
      const directions = [
        { dir: roc.direction, weight: weights.roc },
        { dir: rsiMomentum.direction, weight: weights.rsi },
        { dir: macdMomentum.direction, weight: weights.macd },
        { dir: acceleration.direction, weight: weights.acceleration },
      ];

      const direction = this.getWeightedDirection(directions);

      // Calcular valor final do momentum
      const value =
        roc.value * weights.roc +
        rsiMomentum.value * weights.rsi +
        macdMomentum.value * weights.macd +
        acceleration.value * weights.acceleration;

      return {
        strength: Math.min(strength, 1),
        direction,
        value,
      };
    } catch (error) {
      console.error("Erro ao combinar métricas de momentum:", error);
      return {
        strength: 0,
        direction: "neutral",
        value: 0,
      };
    }
  }

  getWeightedDirection(directions) {
    const weights = {
      up: 0,
      down: 0,
      neutral: 0,
    };

    directions.forEach(({ dir, weight }) => {
      weights[dir] += weight;
    });

    return Object.entries(weights).reduce((a, b) =>
      weights[a] > weights[b[0]] ? a : b[0]
    );
  }
  validateAnalysis(analysis) {
    try {
      // Verificar se a análise existe
      if (!analysis || typeof analysis !== "object") {
        console.log("Análise inválida ou ausente");
        return false;
      }

      // Validar confiança mínima
      if (
        !analysis.confidence ||
        analysis.confidence < this.config.minConfidence
      ) {
        console.log(`Confiança insuficiente: ${analysis.confidence}`);
        return false;
      }

      // Validar direção
      if (!analysis.direction || analysis.direction === "neutral") {
        console.log("Direção indefinida ou neutra");
        return false;
      }

      // Validar força da tendência
      if (!this.validateTrendStrength(analysis)) {
        console.log("Força da tendência insuficiente");
        return false;
      }

      // Validar indicadores técnicos
      if (!this.validateIndicators(analysis.details?.indicators)) {
        console.log("Indicadores técnicos não confirmam");
        return false;
      }

      // Validar condições de mercado
      if (!this.validateMarketConditions(analysis.details)) {
        console.log("Condições de mercado desfavoráveis");
        return false;
      }

      // Validar padrões de preço
      if (!this.validatePricePatterns(analysis.details?.patterns)) {
        console.log("Padrões de preço não confirmam");
        return false;
      }

      // Validar momentum
      if (!this.validateMomentum(analysis.details?.momentum)) {
        console.log("Momentum insuficiente");
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação da análise:", error);
      return false;
    }
  }

  validateTrendStrength(analysis) {
    try {
      // Verificar força mínima da tendência
      if (
        !analysis.strength ||
        analysis.strength < this.config.trendStrengthMin
      ) {
        return false;
      }

      // Verificar alinhamento de diferentes timeframes
      if (analysis.details?.trends?.alignment) {
        const alignment = analysis.details.trends.alignment;
        if (!alignment.isAligned || alignment.strength < 0.7) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Erro na validação da força da tendência:", error);
      return false;
    }
  }

  validateIndicators(indicators) {
    try {
      if (!indicators) return false;

      // Validar RSI
      const rsiValid = this.validateRSI(indicators.rsi);

      // Validar MACD
      const macdValid = this.validateMACD(indicators.macd);

      // Validar Bollinger Bands
      const bollingerValid = this.validateBollinger(indicators.bollinger);

      // Exigir que pelo menos 2 dos 3 indicadores confirmem
      const validCount = [rsiValid, macdValid, bollingerValid].filter(
        Boolean
      ).length;

      return validCount >= 2;
    } catch (error) {
      console.error("Erro na validação dos indicadores:", error);
      return false;
    }
  }

  validateRSI(rsi) {
    if (!rsi || !rsi.current) return false;

    // Verificar condições de sobrecompra/sobrevenda
    if (rsi.current > 70) {
      return rsi.trend === "down";
    }
    if (rsi.current < 30) {
      return rsi.trend === "up";
    }

    // Verificar tendência do RSI
    return Math.abs(rsi.current - 50) > 10;
  }

  validateMACD(macd) {
    if (!macd) return false;

    // Verificar cruzamento significativo
    const significantCrossover = Math.abs(macd.value - macd.signal) > 0.0001;

    // Verificar direção do histograma
    const positiveHistogram = macd.histogram > 0;

    return significantCrossover && positiveHistogram;
  }

  validateBollinger(bollinger) {
    if (!bollinger) return false;

    // Verificar posição do preço em relação às bandas
    const percentB = bollinger.percentB;

    // Validar sinais de reversão nas bandas
    if (percentB < 0.05) return true; // Próximo à banda inferior
    if (percentB > 0.95) return true; // Próximo à banda superior

    return false;
  }

  validateMarketConditions(details) {
    try {
      if (!details || !details.market) return false;

      const { volume, volatility } = details.market.details;

      // Validar volume
      if (volume < 0.7) {
        // Volume deve ser pelo menos 70% da média
        return false;
      }

      // Validar volatilidade
      if (volatility > this.config.volatilityThreshold) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação das condições de mercado:", error);
      return false;
    }
  }

  validatePricePatterns(patterns) {
    try {
      if (!patterns) return true; // Padrões não são obrigatórios

      // Se houver padrões, verificar a confiabilidade
      if (patterns.reliability < 0.7) {
        return false;
      }

      // Verificar força do padrão
      if (patterns.strength < 0.7) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação dos padrões de preço:", error);
      return true; // Em caso de erro, não bloquear por padrões
    }
  }

  validateMomentum(momentum) {
    try {
      if (!momentum) return false;

      // Verificar força do momentum
      if (momentum.strength < 0.6) {
        return false;
      }

      // Verificar alinhamento com a direção da tendência
      if (momentum.direction === "neutral") {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação do momentum:", error);
      return false;
    }
  }
  validateAnalysis(analysis) {
    try {
      // Verificar se a análise existe
      if (!analysis || typeof analysis !== "object") {
        console.log("Análise inválida ou ausente");
        return false;
      }

      // Validar confiança mínima
      if (
        !analysis.confidence ||
        analysis.confidence < this.config.minConfidence
      ) {
        console.log(`Confiança insuficiente: ${analysis.confidence}`);
        return false;
      }

      // Validar direção
      if (!analysis.direction || analysis.direction === "neutral") {
        console.log("Direção indefinida ou neutra");
        return false;
      }

      // Validar força da tendência
      if (!this.validateTrendStrength(analysis)) {
        console.log("Força da tendência insuficiente");
        return false;
      }

      // Validar indicadores técnicos
      if (!this.validateIndicators(analysis.details?.indicators)) {
        console.log("Indicadores técnicos não confirmam");
        return false;
      }

      // Validar condições de mercado
      if (!this.validateMarketConditions(analysis.details)) {
        console.log("Condições de mercado desfavoráveis");
        return false;
      }

      // Validar padrões de preço
      if (!this.validatePricePatterns(analysis.details?.patterns)) {
        console.log("Padrões de preço não confirmam");
        return false;
      }

      // Validar momentum
      if (!this.validateMomentum(analysis.details?.momentum)) {
        console.log("Momentum insuficiente");
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação da análise:", error);
      return false;
    }
  }

  validateTrendStrength(analysis) {
    try {
      // Verificar força mínima da tendência
      if (
        !analysis.strength ||
        analysis.strength < this.config.trendStrengthMin
      ) {
        return false;
      }

      // Verificar alinhamento de diferentes timeframes
      if (analysis.details?.trends?.alignment) {
        const alignment = analysis.details.trends.alignment;
        if (!alignment.isAligned || alignment.strength < 0.7) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Erro na validação da força da tendência:", error);
      return false;
    }
  }

  validateIndicators(indicators) {
    try {
      if (!indicators) return false;

      // Validar RSI
      const rsiValid = this.validateRSI(indicators.rsi);

      // Validar MACD
      const macdValid = this.validateMACD(indicators.macd);

      // Validar Bollinger Bands
      const bollingerValid = this.validateBollinger(indicators.bollinger);

      // Exigir que pelo menos 2 dos 3 indicadores confirmem
      const validCount = [rsiValid, macdValid, bollingerValid].filter(
        Boolean
      ).length;

      return validCount >= 2;
    } catch (error) {
      console.error("Erro na validação dos indicadores:", error);
      return false;
    }
  }

  validateRSI(rsi) {
    if (!rsi || !rsi.current) return false;

    // Verificar condições de sobrecompra/sobrevenda
    if (rsi.current > 70) {
      return rsi.trend === "down";
    }
    if (rsi.current < 30) {
      return rsi.trend === "up";
    }

    // Verificar tendência do RSI
    return Math.abs(rsi.current - 50) > 10;
  }

  validateMACD(macd) {
    if (!macd) return false;

    // Verificar cruzamento significativo
    const significantCrossover = Math.abs(macd.value - macd.signal) > 0.0001;

    // Verificar direção do histograma
    const positiveHistogram = macd.histogram > 0;

    return significantCrossover && positiveHistogram;
  }

  validateBollinger(bollinger) {
    if (!bollinger) return false;

    // Verificar posição do preço em relação às bandas
    const percentB = bollinger.percentB;

    // Validar sinais de reversão nas bandas
    if (percentB < 0.05) return true; // Próximo à banda inferior
    if (percentB > 0.95) return true; // Próximo à banda superior

    return false;
  }

  validateMarketConditions(details) {
    try {
      if (!details || !details.market) return false;

      const { volume, volatility } = details.market.details;

      // Validar volume
      if (volume < 0.7) {
        // Volume deve ser pelo menos 70% da média
        return false;
      }

      // Validar volatilidade
      if (volatility > this.config.volatilityThreshold) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação das condições de mercado:", error);
      return false;
    }
  }

  validatePricePatterns(patterns) {
    try {
      if (!patterns) return true; // Padrões não são obrigatórios

      // Se houver padrões, verificar a confiabilidade
      if (patterns.reliability < 0.7) {
        return false;
      }

      // Verificar força do padrão
      if (patterns.strength < 0.7) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação dos padrões de preço:", error);
      return true; // Em caso de erro, não bloquear por padrões
    }
  }

  validateMomentum(momentum) {
    try {
      if (!momentum) return false;

      // Verificar força do momentum
      if (momentum.strength < 0.6) {
        return false;
      }

      // Verificar alinhamento com a direção da tendência
      if (momentum.direction === "neutral") {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação do momentum:", error);
      return false;
    }
  }
  validateAnalysis(analysis) {
    try {
      // Verificar se a análise existe
      if (!analysis || typeof analysis !== "object") {
        console.log("Análise inválida ou ausente");
        return false;
      }

      // Validar confiança mínima
      if (
        !analysis.confidence ||
        analysis.confidence < this.config.minConfidence
      ) {
        console.log(`Confiança insuficiente: ${analysis.confidence}`);
        return false;
      }

      // Validar direção
      if (!analysis.direction || analysis.direction === "neutral") {
        console.log("Direção indefinida ou neutra");
        return false;
      }

      // Validar força da tendência
      if (!this.validateTrendStrength(analysis)) {
        console.log("Força da tendência insuficiente");
        return false;
      }

      // Validar indicadores técnicos
      if (!this.validateIndicators(analysis.details?.indicators)) {
        console.log("Indicadores técnicos não confirmam");
        return false;
      }

      // Validar condições de mercado
      if (!this.validateMarketConditions(analysis.details)) {
        console.log("Condições de mercado desfavoráveis");
        return false;
      }

      // Validar padrões de preço
      if (!this.validatePricePatterns(analysis.details?.patterns)) {
        console.log("Padrões de preço não confirmam");
        return false;
      }

      // Validar momentum
      if (!this.validateMomentum(analysis.details?.momentum)) {
        console.log("Momentum insuficiente");
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação da análise:", error);
      return false;
    }
  }

  validateTrendStrength(analysis) {
    try {
      // Verificar força mínima da tendência
      if (
        !analysis.strength ||
        analysis.strength < this.config.trendStrengthMin
      ) {
        return false;
      }

      // Verificar alinhamento de diferentes timeframes
      if (analysis.details?.trends?.alignment) {
        const alignment = analysis.details.trends.alignment;
        if (!alignment.isAligned || alignment.strength < 0.7) {
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("Erro na validação da força da tendência:", error);
      return false;
    }
  }

  validateIndicators(indicators) {
    try {
      if (!indicators) return false;

      // Validar RSI
      const rsiValid = this.validateRSI(indicators.rsi);

      // Validar MACD
      const macdValid = this.validateMACD(indicators.macd);

      // Validar Bollinger Bands
      const bollingerValid = this.validateBollinger(indicators.bollinger);

      // Exigir que pelo menos 2 dos 3 indicadores confirmem
      const validCount = [rsiValid, macdValid, bollingerValid].filter(
        Boolean
      ).length;

      return validCount >= 2;
    } catch (error) {
      console.error("Erro na validação dos indicadores:", error);
      return false;
    }
  }

  validateRSI(rsi) {
    if (!rsi || !rsi.current) return false;

    // Verificar condições de sobrecompra/sobrevenda
    if (rsi.current > 70) {
      return rsi.trend === "down";
    }
    if (rsi.current < 30) {
      return rsi.trend === "up";
    }

    // Verificar tendência do RSI
    return Math.abs(rsi.current - 50) > 10;
  }

  validateMACD(macd) {
    if (!macd) return false;

    // Verificar cruzamento significativo
    const significantCrossover = Math.abs(macd.value - macd.signal) > 0.0001;

    // Verificar direção do histograma
    const positiveHistogram = macd.histogram > 0;

    return significantCrossover && positiveHistogram;
  }

  validateBollinger(bollinger) {
    if (!bollinger) return false;

    // Verificar posição do preço em relação às bandas
    const percentB = bollinger.percentB;

    // Validar sinais de reversão nas bandas
    if (percentB < 0.05) return true; // Próximo à banda inferior
    if (percentB > 0.95) return true; // Próximo à banda superior

    return false;
  }

  validateMarketConditions(details) {
    try {
      if (!details || !details.market) return false;

      const { volume, volatility } = details.market.details;

      // Validar volume
      if (volume < 0.7) {
        // Volume deve ser pelo menos 70% da média
        return false;
      }

      // Validar volatilidade
      if (volatility > this.config.volatilityThreshold) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação das condições de mercado:", error);
      return false;
    }
  }

  validatePricePatterns(patterns) {
    try {
      if (!patterns) return true; // Padrões não são obrigatórios

      // Se houver padrões, verificar a confiabilidade
      if (patterns.reliability < 0.7) {
        return false;
      }

      // Verificar força do padrão
      if (patterns.strength < 0.7) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação dos padrões de preço:", error);
      return true; // Em caso de erro, não bloquear por padrões
    }
  }

  validateMomentum(momentum) {
    try {
      if (!momentum) return false;

      // Verificar força do momentum
      if (momentum.strength < 0.6) {
        return false;
      }

      // Verificar alinhamento com a direção da tendência
      if (momentum.direction === "neutral") {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Erro na validação do momentum:", error);
      return false;
    }
  }

  determineOverallDirection(signals) {
    try {
      // Validar entrada
      if (!signals || !Array.isArray(signals)) {
        console.warn("Sinais inválidos recebidos em determineOverallDirection");
        return "neutral";
      }

      // Filtrar sinais válidos
      const validSignals = signals.filter(
        (signal) => signal && typeof signal === "object" && signal.direction
      );

      if (validSignals.length === 0) {
        console.log("Nenhum sinal válido encontrado");
        return "neutral";
      }

      // Contagem de direções com pesos
      const directions = {
        up: 0,
        down: 0,
        neutral: 0,
      };

      // Pesos para cada tipo de sinal
      const weights = {
        rsi: 0.25,
        macd: 0.3,
        bollinger: 0.25,
        ema: 0.2,
      };

      // Processar cada sinal válido
      validSignals.forEach((signal, index) => {
        try {
          let weight = 0.25; // peso padrão

          // Determinar peso baseado no índice
          switch (index) {
            case 0:
              weight = weights.rsi;
              break;
            case 1:
              weight = weights.macd;
              break;
            case 2:
              weight = weights.bollinger;
              break;
            case 3:
              weight = weights.ema;
              break;
          }

          // Adicionar peso à direção correspondente
          if (signal.direction in directions) {
            directions[signal.direction] += weight * (signal.strength || 1);
          }
        } catch (err) {
          console.error("Erro ao processar sinal individual:", err);
        }
      });

      // Calcular direção dominante
      const totalWeight = Object.values(directions).reduce((a, b) => a + b, 0);

      if (totalWeight === 0) {
        console.log("Nenhum peso total encontrado");
        return "neutral";
      }

      // Verificar se há direção dominante clara
      const threshold = 0.6; // 60% dos sinais precisam concordar

      for (const [direction, weight] of Object.entries(directions)) {
        if (weight / totalWeight > threshold) {
          console.log(`Direção dominante encontrada: ${direction}`);
          return direction;
        }
      }

      console.log("Sem direção dominante clara");
      return "neutral";
    } catch (error) {
      console.error("Erro ao determinar direção geral:", error);
      return "neutral";
    }
  }
  calculatePatternStrength(patterns) {
    try {
      if (!patterns) return 0;

      let totalStrength = 0;
      let patternCount = 0;
      let reliability = 0;

      // Avaliar padrões de reversão
      if (patterns.doubleTop) {
        totalStrength += this.evaluateDoubleTop(patterns.doubleTop);
        patternCount++;
      }
      if (patterns.doubleBottom) {
        totalStrength += this.evaluateDoubleBottom(patterns.doubleBottom);
        patternCount++;
      }
      if (patterns.headAndShoulders) {
        totalStrength += this.evaluateHeadAndShoulders(
          patterns.headAndShoulders
        );
        patternCount++;
      }

      // Avaliar padrões de continuação
      if (patterns.triangles) {
        const triangleStrength = this.evaluateTriangles(patterns.triangles);
        if (triangleStrength > 0) {
          totalStrength += triangleStrength;
          patternCount++;
        }
      }

      // Calcular força média e confiabilidade
      if (patternCount === 0) return 0;

      const averageStrength = totalStrength / patternCount;
      reliability = this.calculatePatternReliability(patterns, patternCount);

      // Retornar força ajustada pela confiabilidade
      return averageStrength * reliability;
    } catch (error) {
      console.error("Erro ao calcular força dos padrões:", error);
      return 0;
    }
  }

  evaluateDoubleTop(pattern) {
    if (!pattern.found) return 0;

    try {
      // Calcular distância entre topos
      const peakDistance = Math.abs(pattern.index2 - pattern.index1);
      const priceDifference =
        Math.abs(pattern.price2 - pattern.price1) / pattern.price1;

      // Fatores de qualidade
      const idealDistance = 20; // Distância ideal entre topos
      const maxPriceDiff = 0.001; // Diferença máxima aceitável de preço

      // Calcular pontuação
      let strength = 1;

      // Ajustar baseado na distância
      strength *= Math.min(peakDistance / idealDistance, 1);

      // Ajustar baseado na diferença de preço
      strength *= 1 - priceDifference / maxPriceDiff;

      return Math.max(Math.min(strength, 1), 0);
    } catch (error) {
      console.error("Erro ao avaliar Double Top:", error);
      return 0;
    }
  }

  evaluateDoubleBottom(pattern) {
    if (!pattern.found) return 0;

    try {
      // Similar ao Double Top
      const troughDistance = Math.abs(pattern.index2 - pattern.index1);
      const priceDifference =
        Math.abs(pattern.price2 - pattern.price1) / pattern.price1;

      const idealDistance = 20;
      const maxPriceDiff = 0.001;

      let strength = 1;
      strength *= Math.min(troughDistance / idealDistance, 1);
      strength *= 1 - priceDifference / maxPriceDiff;

      return Math.max(Math.min(strength, 1), 0);
    } catch (error) {
      console.error("Erro ao avaliar Double Bottom:", error);
      return 0;
    }
  }

  evaluateHeadAndShoulders(pattern) {
    if (!pattern.found) return 0;

    try {
      const { leftShoulder, head, rightShoulder } = pattern;

      // Verificar simetria
      const leftHeight = Math.abs(head.price - leftShoulder.price);
      const rightHeight = Math.abs(head.price - rightShoulder.price);
      const heightDiff = Math.abs(leftHeight - rightHeight) / leftHeight;

      // Verificar espaçamento
      const leftSpan = head.index - leftShoulder.index;
      const rightSpan = rightShoulder.index - head.index;
      const spanDiff = Math.abs(leftSpan - rightSpan) / leftSpan;

      // Calcular força baseada na simetria e espaçamento
      let strength = 1;
      strength *= 1 - heightDiff;
      strength *= 1 - spanDiff;

      return Math.max(Math.min(strength, 1), 0);
    } catch (error) {
      console.error("Erro ao avaliar Head and Shoulders:", error);
      return 0;
    }
  }

  evaluateTriangles(triangles) {
    try {
      let maxStrength = 0;

      // Avaliar cada tipo de triângulo
      if (triangles.ascending.found) {
        maxStrength = Math.max(
          maxStrength,
          this.evaluateAscendingTriangle(triangles.ascending)
        );
      }
      if (triangles.descending.found) {
        maxStrength = Math.max(
          maxStrength,
          this.evaluateDescendingTriangle(triangles.descending)
        );
      }
      if (triangles.symmetric.found) {
        maxStrength = Math.max(
          maxStrength,
          this.evaluateSymmetricTriangle(triangles.symmetric)
        );
      }

      return maxStrength;
    } catch (error) {
      console.error("Erro ao avaliar triângulos:", error);
      return 0;
    }
  }

  evaluateAscendingTriangle(triangle) {
    if (!triangle.found) return 0;

    try {
      // Verificar qualidade da linha de resistência
      const resistanceQuality = Math.min(
        1,
        Math.abs(triangle.resistance.slope)
      );

      // Verificar inclinação da linha de suporte
      const supportSlope = triangle.support.slope;
      const slopeQuality =
        supportSlope > 0 ? Math.min(supportSlope * 1000, 1) : 0;

      return (resistanceQuality + slopeQuality) / 2;
    } catch (error) {
      console.error("Erro ao avaliar triângulo ascendente:", error);
      return 0;
    }
  }

  evaluateDescendingTriangle(triangle) {
    if (!triangle.found) return 0;

    try {
      // Similar ao ascendente, mas invertido
      const supportQuality = Math.min(1, Math.abs(triangle.support.slope));
      const resistanceSlope = triangle.resistance.slope;
      const slopeQuality =
        resistanceSlope < 0 ? Math.min(Math.abs(resistanceSlope * 1000), 1) : 0;

      return (supportQuality + slopeQuality) / 2;
    } catch (error) {
      console.error("Erro ao avaliar triângulo descendente:", error);
      return 0;
    }
  }

  evaluateSymmetricTriangle(triangle) {
    if (!triangle.found) return 0;

    try {
      // Verificar convergência das linhas
      const resistanceSlope = Math.abs(triangle.resistance.slope);
      const supportSlope = Math.abs(triangle.support.slope);

      // Verificar simetria
      const slopeDiff = Math.abs(resistanceSlope - supportSlope);
      const symmetryQuality =
        1 - Math.min(slopeDiff / Math.max(resistanceSlope, supportSlope), 1);

      return symmetryQuality;
    } catch (error) {
      console.error("Erro ao avaliar triângulo simétrico:", error);
      return 0;
    }
  }

  calculatePatternReliability(patterns, patternCount) {
    try {
      // Fatores de confiabilidade base para cada tipo de padrão
      const reliabilityFactors = {
        doubleTop: 0.85,
        doubleBottom: 0.85,
        headAndShoulders: 0.9,
        triangles: 0.8,
      };

      let totalReliability = 0;

      // Somar confiabilidade de cada padrão encontrado
      if (patterns.doubleTop?.found) {
        totalReliability += reliabilityFactors.doubleTop;
      }
      if (patterns.doubleBottom?.found) {
        totalReliability += reliabilityFactors.doubleBottom;
      }
      if (patterns.headAndShoulders?.found) {
        totalReliability += reliabilityFactors.headAndShoulders;
      }
      if (
        patterns.triangles?.ascending.found ||
        patterns.triangles?.descending.found ||
        patterns.triangles?.symmetric.found
      ) {
        totalReliability += reliabilityFactors.triangles;
      }

      // Calcular média de confiabilidade
      return patternCount > 0 ? totalReliability / patternCount : 0;
    } catch (error) {
      console.error("Erro ao calcular confiabilidade dos padrões:", error);
      return 0;
    }
  }
}

module.exports = new MarketAnalyzer();
