// server/app.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const routes = require("./routes"); // Adicione esta linha para importar as rotas
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Usando as rotas
app.use("/api", routes);
// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, "client")));

// Iniciando o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
