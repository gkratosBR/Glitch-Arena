import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { 
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, getIdTokenResult
} from "https://www.gstatic.com/firebasejs/9.6.10/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCb3csf_fKDif-PwQXfTf6P_aolbK4Dm3Y",
    authDomain: "primegame-7cea1.firebaseapp.com",
    projectId: "primegame-7cea1",
    storageBucket: "primegame-7cea1.firebasestorage.app",
    messagingSenderId: "369035051769",
    appId: "1:369035051769:web:c72189abab203fdb8c1828",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const API_URL = '';
let revenueChart = null;

// --- API HELPER ---
async function fetchWithAdminAuth(endpoint, options = {}) {
    const user = auth.currentUser;
    if (!user) throw new Error("Admin não autenticado.");
    
    const idToken = await user.getIdToken();
    options.headers = { ...options.headers, 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' };
    
    const response = await fetch(`${API_URL}${endpoint}`, options);
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${response.status}`);
    }
    return response.json();
}

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
    // Listeners de Auth
    document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);
    document.getElementById('admin-logout-btn').addEventListener('click', () => signOut(auth));
    
    // Listeners de Sliders (Atualiza o texto % ao lado)
    setupSliderListener('config-min-difficulty', 'val-min-difficulty', '%');
    setupSliderListener('config-max-difficulty', 'val-max-difficulty', '%');
    setupSliderListener('config-safety-reduction', 'val-safety', '%');

    // Monitor de Sessão
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                const tokenResult = await getIdTokenResult(user, true);
                if (tokenResult.claims.admin) {
                    showAdminPanel(user);
                } else {
                    showLoginError("Acesso negado. Esta conta não é Admin.");
                    await signOut(auth);
                }
            } catch (e) { showLoginError("Erro de permissão."); }
        } else {
            showLoginPage();
        }
    });
});

function setupSliderListener(inputId, displayId, suffix) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if(input && display) {
        // Atualiza ao carregar
        display.textContent = input.value + suffix;
        // Atualiza ao mover
        input.addEventListener('input', (e) => display.textContent = e.target.value + suffix);
    }
}

// --- AUTHENTICATION ---
async function handleAdminLogin(e) {
    e.preventDefault();
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('admin-email').value, document.getElementById('admin-password').value);
    } catch (e) {
        showLoginError("Credenciais inválidas.");
    }
}

function showLoginPage() {
    document.getElementById('admin-login-shell').classList.remove('hidden');
    document.getElementById('admin-panel-shell').classList.add('hidden');
}

function showAdminPanel(user) {
    document.getElementById('admin-user-email').textContent = user.email;
    document.getElementById('admin-login-shell').classList.add('hidden');
    document.getElementById('admin-panel-shell').classList.remove('hidden');
    
    loadDashboardData();
    loadConfigData();
    
    // Listeners de Formulários
    document.getElementById('config-form').addEventListener('submit', handleSaveConfig);
    document.getElementById('create-coupon-form').addEventListener('submit', handleCreateCoupon);
    document.getElementById('search-user-btn').addEventListener('click', handleSearchUser);
}

function showLoginError(msg) {
    const el = document.getElementById('admin-login-error');
    el.textContent = msg;
    el.classList.remove('hidden');
}

// --- DASHBOARD DATA ---
async function loadDashboardData() {
    try {
        const stats = await fetchWithAdminAuth('/api/admin/dashboard-stats');

        // KPIs
        const plEl = document.getElementById('kpi-platform-pl');
        plEl.textContent = `R$ ${stats.platform_pl.toFixed(2)}`;
        plEl.className = `text-2xl font-bold ${stats.platform_pl >= 0 ? 'text-green-400' : 'text-red-400'}`;
        
        document.getElementById('kpi-total-users').textContent = stats.total_users;
        document.getElementById('kpi-revenue').textContent = `R$ ${(stats.revenue_data.reduce((a, b) => a + b.faturamento, 0)).toFixed(2)}`;

        // Gráfico
        renderRevenueChart(stats.revenue_data);
        
        // Fila KYC
        const kycList = document.getElementById('kyc-queue-list');
        kycList.innerHTML = stats.kyc_pending_queue.length ? stats.kyc_pending_queue.map(u => `
            <li class="text-sm text-white bg-gray-800 p-2 rounded-md mb-2 border border-white/5">
                <p class="font-bold text-purple-400">${u.email}</p>
                <p class="text-xs text-gray-400">${u.fullname} | CPF: ${u.cpf}</p>
            </li>`).join('') : '<li class="text-sm text-gray-500 italic">Nenhuma verificação pendente.</li>';

    } catch (e) { console.error(e); }
}

// --- CONFIG DATA (LOAD & SAVE) ---
async function loadConfigData() {
    try {
        const c = await fetchWithAdminAuth('/api/admin/get-config');
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val !== undefined ? val : ''; };

        // 1. Margens e Taxas
        setVal('config-margin-main', (c.margins?.main * 100).toFixed(0));
        setVal('config-margin-stats', (c.margins?.stats * 100).toFixed(0));
        
        setVal('config-min-deposit', c.payment?.min_deposit);
        setVal('config-min-withdrawal', c.payment?.min_withdrawal);
        setVal('config-withdraw-fee', c.payment?.withdraw_fee);
        setVal('config-free-withdraw-threshold', c.payment?.free_withdraw_threshold);
        setVal('config-fee-behavior', c.payment?.fee_payer || 'user');

        // 2. Matemática (Ranges)
        const minDiff = (c.math?.min_difficulty || 0.25) * 100;
        const maxDiff = (c.math?.max_difficulty || 0.65) * 100;
        const safeReduct = (c.math?.safety_reduction || 0.10) * 100;
        
        setVal('config-min-difficulty', minDiff);
        setVal('config-max-difficulty', maxDiff);
        setVal('config-safety-reduction', safeReduct);
        
        // Atualiza textos dos sliders
        document.getElementById('val-min-difficulty').textContent = minDiff.toFixed(0) + '%';
        document.getElementById('val-max-difficulty').textContent = maxDiff.toFixed(0) + '%';
        document.getElementById('val-safety').textContent = safeReduct.toFixed(0) + '%';

        // 3. Referral (Sistema de Indicação)
        setVal('config-referrer-amount', c.referral?.referrer_amount);
        setVal('config-referee-amount', c.referral?.referee_amount);
        setVal('config-rollover-multiplier', c.referral?.rollover_multiplier);

        // 4. Sistema (Gateway e Riot)
        setVal('config-suitpay-client-id', c.payment_gateway?.client_id);
        setVal('config-suitpay-client-secret', c.payment_gateway?.client_secret);
        setVal('config-min-level', c.risk?.min_summoner_level);
        setVal('config-max-global-bet-limit', c.limits?.max_global_bet_limit);

    } catch (e) { console.error("Erro ao carregar config:", e); }
}

async function handleSaveConfig(e) {
    e.preventDefault();
    const btn = document.getElementById('config-save-btn');
    const originalTxt = btn.textContent;
    btn.textContent = "Salvando...";
    btn.disabled = true;

    try {
        const getVal = (id, def) => { const el = document.getElementById(id); return el && el.value ? parseFloat(el.value) : def; };
        const getStr = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

        // Constrói objeto de configuração completo
        const newConfig = {
            margins: {
                main: getVal('config-margin-main', 15) / 100,
                stats: getVal('config-margin-stats', 30) / 100
            },
            payment: {
                min_deposit: getVal('config-min-deposit', 20),
                min_withdrawal: getVal('config-min-withdrawal', 50),
                withdraw_fee: getVal('config-withdraw-fee', 5.00),
                free_withdraw_threshold: getVal('config-free-withdraw-threshold', 100.00),
                fee_payer: getStr('config-fee-behavior') || 'user'
            },
            math: {
                // Converte % para decimal (Ex: 25% -> 0.25)
                min_difficulty: getVal('config-min-difficulty', 25) / 100,
                max_difficulty: getVal('config-max-difficulty', 65) / 100,
                safety_reduction: getVal('config-safety-reduction', 10) / 100
            },
            referral: {
                referrer_amount: getVal('config-referrer-amount', 5.00),
                referee_amount: getVal('config-referee-amount', 5.00),
                rollover_multiplier: getVal('config-rollover-multiplier', 20.0)
            },
            payment_gateway: {
                client_id: getStr('config-suitpay-client-id'),
                client_secret: getStr('config-suitpay-client-secret')
            },
            risk: {
                min_summoner_level: parseInt(getVal('config-min-level', 100))
            },
            limits: {
                max_global_bet_limit: getVal('config-max-global-bet-limit', 200)
            },
            system: {
                stats_ttl_minutes: 45,
                resolution_interval_minutes: 10
            }
        };
        
        await fetchWithAdminAuth('/api/admin/set-config', { method: 'POST', body: JSON.stringify(newConfig) });
        alert("Configurações salvas com sucesso!");
    } catch (error) {
        alert(`Erro ao salvar: ${error.message}`);
    } finally {
        btn.textContent = originalTxt;
        btn.disabled = false;
    }
}

// --- OPERAÇÕES DE CUPOM ---
async function handleCreateCoupon(e) {
    e.preventDefault();
    const btn = document.getElementById('create-coupon-btn');
    const resDiv = document.getElementById('coupon-result');
    
    btn.disabled = true;
    btn.innerHTML = "Criando...";
    resDiv.classList.add('hidden');

    const payload = {
        code: document.getElementById('coupon-code').value,
        amount: document.getElementById('coupon-amount').value,
        min_deposit_required: document.getElementById('coupon-min-deposit').value,
        max_uses: document.getElementById('coupon-max-uses').value
    };

    try {
        const data = await fetchWithAdminAuth('/api/admin/create-coupon', { 
            method: 'POST', 
            body: JSON.stringify(payload) 
        });
        
        resDiv.textContent = `Cupom Criado: ${data.code}`;
        resDiv.classList.remove('hidden');
        document.getElementById('create-coupon-form').reset();
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = "Criar";
    }
}

// --- BUSCA DE USUÁRIO ---
async function handleSearchUser() {
    const email = document.getElementById('search-user-email').value;
    const res = document.getElementById('search-user-result');
    
    if (!email) return;
    res.textContent = "Buscando...";
    res.classList.remove('hidden', 'text-red-400');
    res.className = "mt-4 text-gray-400 text-sm";
    
    try {
        const u = await fetchWithAdminAuth(`/api/admin/find-user?email=${email}`);
        res.className = "mt-4 text-sm text-white p-4 bg-gray-800 rounded-lg space-y-2 border border-white/10";
        
        res.innerHTML = `
            <div class="flex justify-between items-center border-b border-white/10 pb-2 mb-2">
                <span class="font-bold text-purple-400">${u.email}</span>
                <span class="text-xs bg-gray-700 px-2 py-1 rounded">${u.kyc_status}</span>
            </div>
            <div class="grid grid-cols-2 gap-4 text-xs">
                <div>
                    <p class="text-gray-500">Saldo Real</p>
                    <p class="font-bold text-lg">R$ ${u.wallet.toFixed(2)}</p>
                </div>
                <div>
                    <p class="text-gray-500">Saldo Bônus</p>
                    <p class="font-bold text-lg text-purple-300">R$ ${(u.bonus_wallet || 0).toFixed(2)}</p>
                </div>
                <div>
                    <p class="text-gray-500">Rollover Restante</p>
                    <p>R$ ${(u.rollover_target || 0).toFixed(2)}</p>
                </div>
                <div>
                    <p class="text-gray-500">Lucro da Casa (P/L)</p>
                    <p class="${u.profit_loss >= 0 ? 'text-green-400' : 'text-red-400'} font-bold">R$ ${u.profit_loss.toFixed(2)}</p>
                </div>
            </div>
            <div class="pt-2 border-t border-white/10 text-xs text-gray-500">
                ID: <span class="font-mono select-all">${u.userId}</span>
            </div>
        `;
    } catch (e) {
        res.textContent = "Usuário não encontrado.";
        res.className = "mt-4 text-red-400 text-sm";
    }
}

// --- GRÁFICO ---
function renderRevenueChart(data) {
    const ctx = document.getElementById('revenue-chart').getContext('2d');
    if (revenueChart) revenueChart.destroy();
    
    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.month),
            datasets: [{
                label: 'Faturamento',
                data: data.map(d => d.faturamento),
                borderColor: '#8A2BE2',
                backgroundColor: 'rgba(138, 43, 226, 0.2)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}   