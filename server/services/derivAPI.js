const axios = require('axios');

// Configurações da API da Deriv
const DERIV_API_URL = 'https://api.deriv.com'; // URL base da API
const DERIV_API_TOKEN = process.env.DERIV_TOKEN;

// Função para fazer uma chamada à API da Deriv
const callDerivAPI = async (endpoint, method = 'GET', data = {}) => {
    try {
        const response = await axios({
            method: method,
            url: `${DERIV_API_URL}${endpoint}`,
            data: data,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DERIV_TOKEN}` // Adicionando o token aqui
            }
        });
        return response.data;
    } catch (error) {
        console.error('Erro ao chamar a API da Deriv:', error);
        throw error;
    }
};


// Função para obter os preços de um ativo
const getAssetPrices = async (asset) => {
    const endpoint = `/price/${asset}`; // Ajuste o endpoint conforme a documentação da API
    return await callDerivAPI(endpoint);
};

// Função para enviar uma ordem
const placeOrder = async (orderDetails) => {
    const endpoint = '/trade'; // Ajuste o endpoint conforme a documentação da API
    return await callDerivAPI(endpoint, 'POST', orderDetails);
};

// Exportando as funções para uso em outros arquivos
module.exports = {
    getAssetPrices,
    placeOrder
};
