// Калькулятор ипотеки
class MortgageCalculator {
    constructor() {
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.currentProgram = 'family';
        this.calculate();
    }

    setupEventListeners() {
        // Табы программ
        document.querySelectorAll('.mortgage-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                const program = e.currentTarget.dataset.program;
                this.switchProgram(program);
            });
        });

        // Слайдеры
        document.getElementById('property-price').addEventListener('input', () => this.calculate());
        document.getElementById('down-payment').addEventListener('input', () => this.calculate());
        document.getElementById('loan-term').addEventListener('input', () => this.calculate());
        
        // Слайдер процентной ставки
        const rateSlider = document.getElementById('interest-rate');
        if (rateSlider) {
            rateSlider.addEventListener('input', () => this.calculate());
        }
    }

    switchProgram(program) {
        this.currentProgram = program;
        
        // Переключение активного таба
        document.querySelectorAll('.mortgage-tab').forEach(tab => {
            tab.classList.remove('bg-white', 'text-gray-800', 'shadow-sm');
            tab.classList.add('text-gray-600', 'hover:text-gray-800');
        });
        
        const activeTab = document.querySelector(`[data-program="${program}"]`);
        activeTab.classList.remove('text-gray-600', 'hover:text-gray-800');
        activeTab.classList.add('bg-white', 'text-gray-800', 'shadow-sm');
        
        // Переключение блоков результатов
        document.querySelectorAll('.mortgage-result').forEach(result => {
            result.classList.add('hidden');
        });
        document.getElementById(`${program}-result`).classList.remove('hidden');
        
        // Настройка слайдера процентной ставки
        this.setupRateSlider(program);
        
        this.calculate();
    }

    setupRateSlider(program) {
        const rateBlock = document.getElementById('interest-rate-block');
        const rateSlider = document.getElementById('interest-rate');
        const rateDisplay = document.getElementById('rate-display');
        const rateMin = document.getElementById('rate-min');
        const rateMax = document.getElementById('rate-max');
        
        if (program === 'family') {
            rateBlock.classList.add('hidden');
        } else {
            rateBlock.classList.remove('hidden');
            
            if (program === 'basic') {
                rateSlider.min = 9;
                rateSlider.max = 20;
                rateSlider.value = 16;
                rateMin.textContent = '9%';
                rateMax.textContent = '20%';
                rateDisplay.textContent = '16%';
            } else if (program === 'it') {
                rateSlider.min = 3.5;
                rateSlider.max = 6;
                rateSlider.value = 6;
                rateMin.textContent = '3.5%';
                rateMax.textContent = '6%';
                rateDisplay.textContent = '6%';
            }
        }
    }

    calculate() {
        const propertyPrice = parseFloat(document.getElementById('property-price').value);
        let downPaymentPercent = parseFloat(document.getElementById('down-payment').value);
        const loanTermYears = parseFloat(document.getElementById('loan-term').value);
        
        // Получение процентной ставки и лимитов в зависимости от программы
        let interestRate;
        let maxLoanAmount;
        let minDownPaymentPercent = 20; // Minimum 20% down payment for all programs
        
        if (this.currentProgram === 'family') {
            interestRate = 6;
            maxLoanAmount = 6000000; // 6 million max loan for family mortgage
        } else if (this.currentProgram === 'basic') {
            interestRate = parseFloat(document.getElementById('interest-rate').value);
            document.getElementById('rate-display').textContent = `${interestRate}%`;
            maxLoanAmount = 15000000; // 15 million max loan for basic mortgage
        } else if (this.currentProgram === 'it') {
            interestRate = parseFloat(document.getElementById('interest-rate').value);
            document.getElementById('rate-display').textContent = `${interestRate}%`;
            maxLoanAmount = 9000000; // 9 million max loan for IT mortgage
        }
        
        // Calculate down payment and loan amount
        const downPaymentAmount = propertyPrice * downPaymentPercent / 100;
        const requestedLoanAmount = propertyPrice - downPaymentAmount;
        
        // Check if requested loan exceeds program limit
        let actualLoanAmount = requestedLoanAmount;
        let actualDownPaymentPercent = downPaymentPercent;
        let actualDownPaymentAmount = downPaymentAmount;
        
        // If loan exceeds limit, automatically increase down payment
        if (requestedLoanAmount > maxLoanAmount) {
            actualLoanAmount = maxLoanAmount;
            actualDownPaymentAmount = propertyPrice - actualLoanAmount;
            actualDownPaymentPercent = Math.round((actualDownPaymentAmount / propertyPrice) * 100);
            
            // Update slider to minimum required down payment
            const downPaymentSlider = document.getElementById('down-payment');
            downPaymentSlider.value = actualDownPaymentPercent;
        }
        
        // Обновление отображаемых значений
        document.getElementById('price-display').textContent = this.formatPrice(propertyPrice) + ' ₽';
        document.getElementById('down-payment-display').textContent = `${actualDownPaymentPercent}% (${this.formatPrice(actualDownPaymentAmount)} ₽)`;
        document.getElementById('term-display').textContent = `${loanTermYears} лет`;
        
        // Расчет ипотеки
        const monthlyRate = interestRate / 100 / 12;
        const totalMonths = loanTermYears * 12;
        
        let monthlyPayment;
        if (monthlyRate === 0) {
            monthlyPayment = actualLoanAmount / totalMonths;
        } else {
            monthlyPayment = actualLoanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths)) / (Math.pow(1 + monthlyRate, totalMonths) - 1);
        }
        
        const totalPayment = monthlyPayment * totalMonths;
        const overpayment = totalPayment - actualLoanAmount;
        
        // Обновление результатов
        document.getElementById(`${this.currentProgram}-monthly`).textContent = this.formatPrice(monthlyPayment) + ' ₽';
        document.getElementById(`${this.currentProgram}-overpay`).textContent = this.formatPrice(overpayment) + ' ₽';
        document.getElementById(`${this.currentProgram}-total`).textContent = this.formatPrice(totalPayment) + ' ₽';
    }

    formatPrice(price) {
        return Math.round(price).toLocaleString('ru-RU').replace(/,/g, ' ');
    }
}

// Инициализация калькулятора после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    new MortgageCalculator();
});