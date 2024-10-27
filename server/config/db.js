// server/config/db.js
const mysql = require('mysql2');
require('dotenv').config(); // Carrega as variáveis de ambiente do arquivo .env

// Configuração da conexão com o banco de dados MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// Conectando ao banco de dados
db.connect(err => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err);
        return;
    }
    console.log('Conectado ao banco de dados MySQL.');
});

module.exports = db; // Exporta a conexão para uso em outros arquivos
