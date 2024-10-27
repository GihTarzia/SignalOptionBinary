-- Usar o banco de dados existente
USE u530890629_signalsbinaryo;

-- Tabela para armazenar os sinais de compra e venda
CREATE TABLE IF NOT EXISTS signals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asset VARCHAR(50) NOT NULL,                   -- Nome do ativo (ex.: EUR/USD)
    entry_time DATETIME NOT NULL,                 -- Horário recomendado para entrada
    direction ENUM('buy', 'sell') NOT NULL,       -- Direção do sinal: 'buy' para compra, 'sell' para venda
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Data de criação do sinal
);

-- Tabela para registrar os resultados dos sinais para cálculo de acurácia
CREATE TABLE IF NOT EXISTS signal_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    signal_id INT NOT NULL,                       -- ID do sinal (foreign key)
    result ENUM('win', 'loss') NOT NULL,          -- Resultado do sinal: 'win' para ganho, 'loss' para perda
    FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE, -- Relaciona ao sinal correspondente
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Data de registro do resultado
);

-- Tabela de estatísticas de acurácia por ativo e direção
CREATE TABLE IF NOT EXISTS accuracy_statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    asset VARCHAR(50) NOT NULL,                   -- Nome do ativo
    direction ENUM('buy', 'sell') NOT NULL,       -- Direção do sinal
    total_signals INT NOT NULL DEFAULT 0,         -- Total de sinais analisados
    successful_signals INT NOT NULL DEFAULT 0,    -- Total de sinais com ganho
    accuracy DECIMAL(5, 2) AS (CASE               -- Cálculo da acurácia em %
        WHEN total_signals > 0 THEN (successful_signals / total_signals) * 100
        ELSE 0 
    END) PERSISTENT,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP -- Atualização automática
);

-- Índices para otimizar consultas
CREATE INDEX idx_asset_direction ON signals (asset, direction);
CREATE INDEX idx_accuracy_asset_direction ON accuracy_statistics (asset, direction);
