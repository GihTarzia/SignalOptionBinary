# OptimusSafeTrade

## Descrição

OptimusSafeTrade é um projeto desenvolvido para fornecer previsões de mercado para opções binárias. Utiliza WebSockets do Deriv API para obter dados de preços em tempo real e realiza análises técnicas com indicadores como EMA, MACD, RSI e Bandas de Bollinger.

## Estrutura do Projeto

/optimussafetrade
├── client
│ ├── indexPredictionsForex.html
│ └── indexPredictionsVolacity.html
├── node_modules
├── server
│ └── routes
│ ├── predictionsForex.js
│ └── predictionsVolacity.js
├── .env
├── app.js
├── package.json
└── README.md

## Pré-requisitos

- Node.js (versão 14 ou superior)
- NPM (Node Package Manager)

## Instalação

1. Clone este repositório:
   git clone https://github.com/seu-usuario/OptimusSafeTrade.git
   Navegue para o diretório do projeto:

2. Navegue para o diretório do projeto:
   cd optimussafetrade

3. Instale as dependências:
   npm install

4. Configure o arquivo .env com seu APP_ID:
   APP_ID=seu_app_id_aqui

5. Inicie o servidor:
   npm run start

6. Acesse o navegador:
    Para previsões Forex: http://localhost:3000/api/previsaoForex
    Para previsões de Volatilidade: http://localhost:3000/api/previsaoVolacity

## Funcionalidades

Previsões de Forex e Volatilidade: Análise de mercado em tempo real usando indicadores técnicos.
Interface Web: Visualize previsões diretamente em seu navegador.
Análise Técnica: Utiliza EMA, MACD, RSI e Bandas de Bollinger para gerar sinais de compra e venda.
Tecnologias
Node.js
Express
WebSocket
HTML/CSS para interface

## Contribuição
Faça um fork do projeto
Crie uma nova branch (git checkout -b feature/nova-feature)
Faça commit das suas mudanças (git commit -am 'Adiciona nova feature')
Faça push para a branch (git push origin feature/nova-feature)
Abra um Pull Request

## Licença
Este projeto está licenciado sob a Licença MIT - veja o arquivo LICENSE para detalhes.

## Contato
Para mais informações, entre em contato pelo email: seu-email@exemplo.com