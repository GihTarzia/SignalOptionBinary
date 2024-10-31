const nodemailer = require("nodemailer");
const TelegramBot = require("node-telegram-bot-api");
require("dotenv").config();

class NotificationService {
  constructor() {
    if (!process.env.TELEGRAM_TOKEN) {
      console.error("TELEGRAM_TOKEN não configurado no arquivo .env");
      this.telegramEnabled = false;
    } else if (!process.env.TELEGRAM_CHAT_ID) {
      console.error("TELEGRAM_CHAT_ID não configurado no arquivo .env");
      this.telegramEnabled = false;
    } else {
      this.telegramEnabled = true;
      this.telegramBot = new TelegramBot(process.env.TELEGRAM_TOKEN, {
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
    
    Par: ${signal.symbol}
    Direção: ${signal.direction}
    Preço de Entrada: ${signal.entryPrice}
    
    ⏰ *Tempos*
    Hora Atual: ${signal.currentTime}
    Entrada em: ${signal.timeToEntry}
    Hora de Entrada: ${signal.entryTime}
    Tempo do Trade: ${signal.timeFrame}
    Hora de Expiração: ${signal.expirationTime}
    
    📊 *Detalhes*
    Confiança: ${(signal.confidence * 100).toFixed(2)}%
    Stop Loss: ${signal.stopLoss}
    Take Profit: ${signal.takeProfit}
    
    ⚠️ _Trade por sua conta e risco_
        `.trim();
  }
  async sendTelegramMessage(message) {
    console.log(message);
    try {
      //await this.telegramBot.sendMessage(process.env.TELEGRAM_CHAT_ID, message);
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
