// server/app.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const routes = require("./routes"); // Adicione esta linha para importar as rotas
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./predictions.db');

// Criação da tabela de previsões
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    predicted_direction TEXT NOT NULL,
    actual_result TEXT,
    confidence REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Aqui você pode adicionar a lógica do seu aplicativo

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Usando as rotas
app.use("/", routes);
// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, "client")));
app.use(express.static(path.join(__dirname, "../client")));

// Iniciando o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
