class RiskManager {
    constructor(initialBalance) {
        this.balance = initialBalance;
        this.maxRiskPerTrade = 0.02;
        this.consecutiveLosses = 0;
        this.maxDrawdown = 0.1;
        this.currentDrawdown = 0;
    }

    calculatePositionSize(confidence) {
        if (this.currentDrawdown >= this.maxDrawdown) {
            return { amount: 0, risk: 0 };
        }

        let riskAmount = this.balance * this.maxRiskPerTrade;
        
        if (this.consecutiveLosses > 2) {
            riskAmount *= 0.5;
        }

        return {
            amount: Math.round(riskAmount * confidence * 100) / 100,
            risk: this.maxRiskPerTrade
        };
    }

    updateBalance(result, amount) {
        const previousBalance = this.balance;
        
        if (result === 'win') {
            this.balance += amount;
            this.consecutiveLosses = 0;
        } else {
            this.balance -= amount;
            this.consecutiveLosses++;
        }

        this.currentDrawdown = (previousBalance - this.balance) / previousBalance;
        return this.balance;
    }
}

module.exports = RiskManager;