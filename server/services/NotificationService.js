const TelegramBot = require("node-telegram-bot-api");
const moment = require("moment");

class NotificationService {
  constructor() {
    this.TELEGRAM_TOKEN =
      process.env.TELEGRAM_TOKEN ||
      "7906357537:AAHIU7JotNw2bQ46cSnruCtRmC65DCTAGvQ";
    this.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "164097182";
    this.lastSignals = new Map(); // Para controle de duplicatas
    this.signalInterval = 60000; // Intervalo mínimo entre sinais (1 minuto)

    this.initializeTelegram();
  }

  initializeTelegram() {
    if (!this.TELEGRAM_TOKEN) {
      console.error("TELEGRAM_TOKEN não configurado");
      this.telegramEnabled = false;
      return;
    }

    try {
      this.telegramBot = new TelegramBot(this.TELEGRAM_TOKEN, {
        polling: false,
      });
      this.telegramEnabled = true;
    } catch (error) {
      console.error("Erro ao inicializar Telegram:", error);
      this.telegramEnabled = false;
    }
  }

  async sendSignal(signal) {
    try {
      // Validar sinal antes de enviar
      if (!this.validateSignal(signal)) {
        console.log("Sinal inválido ou duplicado:", signal.symbol);
        return false;
      }

      // Formatar e enviar mensagem
      const message = this.formatSignalMessage(signal);
      const success = await this.sendTelegramMessage(message);

      if (success) {
        this.updateSignalHistory(signal);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Erro ao enviar sinal:", error);
      return false;
    }
  }

  validateSignal(signal) {
    // Verificar se todos os campos necessários existem
    if (!signal.symbol || !signal.direction || !signal.confidence) {
      return false;
    }

    // Verificar duplicatas recentes
    const lastSignal = this.lastSignals.get(signal.symbol);
    if (lastSignal) {
      const timeDiff = Date.now() - lastSignal.timestamp;
      if (timeDiff < this.signalInterval) {
        return false;
      }
    }

    // Validar confiança mínima (95%)
    if (signal.confidence < 0.95) {
      return false;
    }

    return true;
  }

  formatSignalMessage(signal) {
    // Calcular taxa de acerto se disponível
    const winRate = signal.performance
      ? `\nTaxa de Acerto: ${(signal.performance.winRate * 100).toFixed(2)}%`
      : "";

    // Calcular força do sinal
    const strengthIndicator = this.calculateStrengthIndicator(
      signal.confidence
    );

    return `
🎯 *SINAL DE ALTA PRECISÃO*

Par: ${signal.symbol.replace("frx", "")}
Direção: ${signal.direction} ${signal.direction === "ACIMA" ? "🟢" : "🔴"}
Força: ${strengthIndicator}

⏰ *HORÁRIOS*
Entrada: ${signal.entryTime}
Expiração: ${signal.expirationTime}
Tempo Operação: ${signal.timeFrame}

📊 *ANÁLISE*
Confiança: ${(signal.confidence * 100).toFixed(2)}%${winRate}
${this.getAdditionalIndicators(signal)}

⚠️ *Gerenciamento*
Stop Loss: ${signal.stopLoss || "NA"}
Take Profit: ${signal.takeProfit || "NA"}

⏱️ Sinal válido por: ${this.calculateValidityPeriod(signal)}
`.trim();
  }

  calculateStrengthIndicator(confidence) {
    if (confidence >= 0.98) return "💪💪💪 (Muito Forte)";
    if (confidence >= 0.96) return "💪💪 (Forte)";
    return "💪 (Moderado)";
  }

  getAdditionalIndicators(signal) {
    if (!signal.indicators) return "";

    return `
Indicadores Técnicos:
${signal.indicators.rsi ? `RSI: ${signal.indicators.rsi}` : ""}
${signal.indicators.macd ? `MACD: ${signal.indicators.macd}` : ""}
${
  signal.indicators.bollinger ? `Bollinger: ${signal.indicators.bollinger}` : ""
}
`.trim();
  }

  calculateValidityPeriod(signal) {
    const entryTime = moment(signal.entryTime, "HH:mm:ss");
    const expirationTime = moment(signal.expirationTime, "HH:mm:ss");
    const minutes = expirationTime.diff(entryTime, "minutes");
    return `${minutes} minutos`;
  }

  async sendTelegramMessage(message) {
    if (!this.telegramEnabled) {
      console.log("Telegram desativado. Mensagem:", message);
      return false;
    }

    try {
      await this.telegramBot.sendMessage(this.TELEGRAM_CHAT_ID, message, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
      return true;
    } catch (error) {
      console.error("Erro ao enviar mensagem no Telegram:", error);
      return false;
    }
  }

  updateSignalHistory(signal) {
    this.lastSignals.set(signal.symbol, {
      timestamp: Date.now(),
      direction: signal.direction,
    });

    // Limpar sinais antigos
    this.cleanupOldSignals();
  }

  cleanupOldSignals() {
    const now = Date.now();
    for (const [symbol, data] of this.lastSignals.entries()) {
      if (now - data.timestamp > this.signalInterval * 2) {
        this.lastSignals.delete(symbol);
      }
    }
  }
}

module.exports = new NotificationService();
