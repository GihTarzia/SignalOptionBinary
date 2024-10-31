const nodemailer = require("nodemailer");
const TelegramBot = require("node-telegram-bot-api");
const TELEGRAM_TOKEN = "7906357537:AAHIU7JotNw2bQ46cSnruCtRmC65DCTAGvQ";
const TELEGRAM_CHAT_ID = "164097182";
class NotificationService {
  constructor() {
    if (!TELEGRAM_TOKEN) {
      console.error("TELEGRAM_TOKEN não configurado no arquivo .env");
      this.telegramEnabled = false;
    } else if (!TELEGRAM_CHAT_ID) {
      console.error("TELEGRAM_CHAT_ID não configurado no arquivo .env");
      this.telegramEnabled = false;
    } else {
      this.telegramEnabled = true;
      this.telegramBot = new TelegramBot(TELEGRAM_TOKEN, {
        polling: false,
      });
    }
    this.emailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  async sendSignal(signal) {
    const message = this.formatSignalMessage(signal);
    await this.sendTelegramMessage(message);
    //await this.sendEmail('Novo Sinal de Trading', message);
  }

  formatSignalMessage(signal) {
    return `
    🎯 *NOVO SINAL DE TRADING*
    
    Ativo: ${signal.symbol.replace("frx", "")}
    Direção: ${signal.direction} ${signal.direction === "ACIMA" ? "🟢" : "🔴"}
    
    ⏰ *Tempos*
    Entrada: ${signal.entryTime}
    Tempo: ${signal.timeFrame}
    Expiração: ${signal.expirationTime}
    
    📊 *Detalhes*
    Confiança: ${(signal.confidence * 100).toFixed(2)}%
            `.trim();
  }
  async sendTelegramMessage(message) {
    console.log(message);
    try {
      await this.telegramBot.sendMessage(TELEGRAM_CHAT_ID, message);
    } catch (error) {
      console.error("Erro ao enviar mensagem no Telegram:", error);
    }
  }

  async sendEmail(subject, message) {
    try {
      await this.emailTransporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.ALERT_EMAIL,
        subject: subject,
        text: message,
      });
    } catch (error) {
      console.error("Erro ao enviar email:", error);
    }
  }
}

module.exports = new NotificationService();
