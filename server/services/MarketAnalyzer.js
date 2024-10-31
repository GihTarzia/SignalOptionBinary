const tf = require('@tensorflow/tfjs');
const technicalIndicators = require('technicalindicators');
const moment = require('moment');

class MarketAnalyzer {
    constructor() {
        this.model = null;
        this.initialized = false;
        this.dataStats = {
            price: { min: null, max: null },
            rsi: { min: 0, max: 100 },
            macd: { min: null, max: null },
            bollinger: { min: null, max: null }
        };
    }

    // Adiciona o método normalizeData como parte da classe
    normalizeData(data, min = null, max = null) {
        if (min === null) min = Math.min(...data);
        if (max === null) max = Math.max(...data);
        
        // Evita divisão por zero
        if (max === min) return data.map(() => 0.5);
        
        return data.map(x => (x - min) / (max - min));
    }

    // Método para atualizar as estatísticas dos dados
    updateDataStats(prices, indicators) {
        this.dataStats.price.min = Math.min(...prices);
        this.dataStats.price.max = Math.max(...prices);
        
        const macdValues = indicators.macd.map(m => m.MACD).filter(m => m !== undefined);
        this.dataStats.macd.min = Math.min(...macdValues);
        this.dataStats.macd.max = Math.max(...macdValues);
        
        const bollingerRanges = indicators.bollinger.map(b => b.upper - b.lower);
        this.dataStats.bollinger.min = Math.min(...bollingerRanges);
        this.dataStats.bollinger.max = Math.max(...bollingerRanges);
    }

    prepareFeatures(prices, indicators) {
        const window = 5;
        const features = [];
        
        // Atualiza as estatísticas dos dados
        this.updateDataStats(prices, indicators);
        
        for (let i = window; i < prices.length; i++) {
            const slice = prices.slice(i - window, i);
            const returns = slice.map((p, j) => j > 0 ? (p - slice[j-1]) / slice[j-1] : 0);
            
            // Normaliza os dados usando as estatísticas atualizadas
            const normalizedReturns = this.normalizeData(returns);
            const normalizedRSI = indicators.rsi[i] / 100; // RSI já está entre 0 e 100
            const normalizedMACD = this.normalizeData(
                [indicators.macd[i]?.MACD || 0],
                this.dataStats.macd.min,
                this.dataStats.macd.max
            )[0];
            
            const bollingerWidth = indicators.bollinger[i]?.upper - indicators.bollinger[i]?.lower || 0;
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
                (prices[i] - this.dataStats.price.min) / (this.dataStats.price.max - this.dataStats.price.min)
            ]);
        }

        return tf.tensor2d(features);
    }

    // Resto dos métodos da classe...
    async initialize() {
        this.model = await this.createModel();
        this.initialized = true;
    }

    async createModel() {
        const model = tf.sequential({
            layers: [
                tf.layers.dense({
                    units: 32,
                    inputShape: [5],
                    activation: 'relu'
                }),
                tf.layers.dropout(0.2),
                tf.layers.dense({
                    units: 16,
                    activation: 'relu'
                }),
                tf.layers.dense({
                    units: 1,
                    activation: 'sigmoid'
                })
            ]
        });

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
        });

        return model;
    }

    calculateIndicators(prices) {
        const period = 14;

        const rsi = technicalIndicators.RSI.calculate({
            values: prices,
            period: period
        });

        const macd = technicalIndicators.MACD.calculate({
            values: prices,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9
        });

        const bollinger = technicalIndicators.BollingerBands.calculate({
            values: prices,
            period: period,
            stdDev: 2
        });

        while (rsi.length < prices.length) rsi.unshift(50);
        while (macd.length < prices.length) macd.unshift({ MACD: 0, signal: 0, histogram: 0 });
        while (bollinger.length < prices.length) {
            bollinger.unshift({
                middle: prices[0],
                upper: prices[0],
                lower: prices[0]
            });
        }

        return { rsi, macd, bollinger };
    }

    async analyzeTrend(prices) {
        try {
            const indicators = this.calculateIndicators(prices);
            const features = this.prepareFeatures(prices, indicators);
            
            if (!this.initialized) {
                await this.initialize();
            }

            const prediction = await this.model.predict(features).data();
            const lastPrediction = prediction[prediction.length - 1];

            return {
                direction: lastPrediction > 0.5 ? 'up' : 'down',
                strength: Math.abs(lastPrediction - 0.5) * 2,
                confidence: lastPrediction
            };
        } catch (error) {
            console.error('Erro na análise de tendência:', error);
            return {
                direction: 'neutral',
                strength: 0,
                confidence: 0
            };
        }
    }

    async predictNextMove(prices) {
        const trend = await this.analyzeTrend(prices);
        const indicators = this.calculateIndicators(prices);
        const lastPrice = prices[prices.length - 1];

        const rsiValue = indicators.rsi[indicators.rsi.length - 1];
        const macdValue = indicators.macd[indicators.macd.length - 1];
        const bollinger = indicators.bollinger[indicators.bollinger.length - 1];

        let signalStrength = 0;
        let signalConfidence = trend.confidence;

        if (trend.direction === 'up') {
            if (rsiValue < 70) signalStrength += 0.2;
            if (macdValue.MACD > macdValue.signal) signalStrength += 0.2;
            if (lastPrice < bollinger.upper) signalStrength += 0.2;
        } else {
            if (rsiValue > 30) signalStrength += 0.2;
            if (macdValue.MACD < macdValue.signal) signalStrength += 0.2;
            if (lastPrice > bollinger.lower) signalStrength += 0.2;
        }

        signalConfidence *= (1 + signalStrength);

        return {
            direction: trend.direction,
            confidence: Math.min(signalConfidence, 1),
            suggestedEntry: lastPrice,
            stopLoss: trend.direction === 'up' ? 
                lastPrice * 0.997 : lastPrice * 1.003,
            takeProfit: trend.direction === 'up' ? 
                lastPrice * 1.005 : lastPrice * 0.995,
            indicators: {
                rsi: rsiValue,
                macd: macdValue,
                bollinger: bollinger
            }
        };
    }
}

module.exports = new MarketAnalyzer();