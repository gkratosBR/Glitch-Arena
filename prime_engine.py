import math
from datetime import datetime
from collections import Counter

# --- CONFIGURAÇÕES GERAIS DO MOTOR ---
POISSON_LAMBDA_ADJUST = 0.95  
MAX_IMPLIED_PROBABILITY = 0.95 
ODD_STEP = 0.05

# --- PESOS DO MOTOR DE ODDS (LoL) ---
RECENT_7_WEIGHT = 0.6
OVERALL_20_WEIGHT = 0.4

# --- LIMITES COMERCIAIS ---
MAX_PROB_FOR_WIN_ODD = 0.70
MIN_PROB_FOR_WIN_ODD = 0.20

# --- PESOS DO MOTOR DE P/L (Margem Dinâmica) ---
PLAYER_PL_BET_THRESHOLD = 10
PLAYER_PL_ADJUSTMENT_FACTOR = 0.0005
PLATFORM_PL_ADJUSTMENT_FACTOR = 0.0001
MAX_DYNAMIC_MARGIN = 0.35

# --- ESCALA DE DIFICULDADE ---
MIN_SCALAR_KDA = 0.25 
MAX_SCALAR_KDA = 0.60 
MIN_WR_FOR_SCALAR = 0.30 
MAX_WR_FOR_SCALAR = 0.70 

# --- PESOS DE ROTA E PROBABILIDADES BASE ---
ROLE_WEIGHTS = {
    'mvp': {
        'BOTTOM': 1.25, 'MIDDLE': 1.20, 'JUNGLE': 1.10, 'TOP': 0.90, 'UTILITY': 0.55, 'UNKNOWN': 1.0
    },
    'damage': {
        'BOTTOM': 1.40, 'MIDDLE': 1.30, 'JUNGLE': 0.90, 'TOP': 0.90, 'UTILITY': 0.50, 'UNKNOWN': 1.0
    },
    'farm': {
        'BOTTOM': 1.25, 'MIDDLE': 1.25, 'TOP': 1.10, 'JUNGLE': 1.00, 'UTILITY': 0.40, 'UNKNOWN': 1.0
    }
}
DEFAULT_BASE_PROB = {
    'mvp_team': 0.10,
    'mvp_match': 0.05,
    'top_damage': 0.05,
    'top_farm': 0.05
}

def validate_account(player_data, min_summoner_level):
    """ VALIDADOR DE CONTA (GERENCIAMENTO DE RISCO) """
    stats = player_data.get("stats", {})
    
    # Anti-Smurf: Nível
    summoner_level = stats.get("summonerLevel", 0)
    if summoner_level < min_summoner_level:
        return {"valid": False, "reason": f"Nível insuficiente ({summoner_level}). Mín: {min_summoner_level}."}

    # Anti-Smurf: Winrate
    if stats.get("winRate", 0.5) >= 0.85:
        return {"valid": False, "reason": "Conta sob análise (Winrate > 85%)."}
    
    return {"valid": True}

def _get_dynamic_margin(base_margin, player_pl_data, platform_pl):
    """ Calcula margem dinâmica baseada no P/L do jogador e da plataforma. """
    current_margin = base_margin 
    
    if player_pl_data and player_pl_data.get('total_bets_made', 0) > PLAYER_PL_BET_THRESHOLD:
        player_profit = player_pl_data.get('profit_loss', 0.0)
        if player_profit > 0:
            current_margin += (player_profit * PLAYER_PL_ADJUSTMENT_FACTOR)
            
    if platform_pl < 0:
        current_margin += (abs(platform_pl) * PLATFORM_PL_ADJUSTMENT_FACTOR)
        
    return min(current_margin, MAX_DYNAMIC_MARGIN)

def _calculate_implied_prob(true_prob, margin):
    return min(true_prob * (1 + margin), MAX_IMPLIED_PROBABILITY)

def _calculate_odd(implied_prob):
    if implied_prob <= 0: return 99.0
    raw_odd = max(1 / implied_prob, 1.05)
    multiplier = 1 / ODD_STEP
    return math.floor(raw_odd * multiplier) / multiplier

# --- FUNÇÕES DO MOTOR PONDERADO (LoL) ---
def _get_weighted_winrate(stats):
    overall_winrate = stats.get("winRate", 0.5)
    recent_wins = stats.get("recent_wins", [])[:7]
    
    if not recent_wins:
        weighted_winrate = overall_winrate
    else:
        # "Vitória Artificial" para suavizar
        recent_wins_copy = list(recent_wins)
        if len(recent_wins_copy) > 0: recent_wins_copy[0] = True
        recent_winrate = sum(1 for w in recent_wins_copy if w) / len(recent_wins_copy)
        weighted_winrate = (recent_winrate * RECENT_7_WEIGHT) + (overall_winrate * OVERALL_20_WEIGHT)
    
    # Limites Comerciais
    if weighted_winrate > MAX_PROB_FOR_WIN_ODD: return MAX_PROB_FOR_WIN_ODD
    if weighted_winrate < MIN_PROB_FOR_WIN_ODD: return MIN_PROB_FOR_WIN_ODD
    return weighted_winrate

def _get_weighted_avg_stat(stats, stat_key, fallback_avg):
    overall_avg_key = f"avg{stat_key.capitalize()}s" 
    if stat_key == "death": overall_avg_key = "avgDeaths"

    recent_stats_key = f"recent_{stat_key}s"
    if stat_key == "death": recent_stats_key = "recent_deaths"

    overall_avg = stats.get(overall_avg_key, fallback_avg)
    recent_stats = stats.get(recent_stats_key, [])[:7]
    
    if len(recent_stats) < 3: 
        recent_avg = overall_avg
    else:
        # "Média Estável": Remove extremos
        sorted_recent = sorted(recent_stats)
        trimmed_list = sorted_recent[1:-1]
        recent_avg = sum(trimmed_list) / len(trimmed_list) if trimmed_list else overall_avg
    
    return (recent_avg * RECENT_7_WEIGHT) + (overall_avg * OVERALL_20_WEIGHT)

def _get_player_main_role(roles_list):
    if not roles_list: return "UNKNOWN"
    roles_list = ['MIDDLE' if r == 'MID' else 'BOTTOM' if r == 'BOT' else r for r in roles_list]
    try:
        return Counter(roles_list).most_common(1)[0][0]
    except: return "UNKNOWN"

def _get_role_weighted_prob(stats, market_type, main_role, dynamic_margin):
    freq_key = f"{market_type}_frequency"
    base_prob = stats.get(freq_key, DEFAULT_BASE_PROB.get(market_type, 0.05))
    if base_prob == 0.0: base_prob = DEFAULT_BASE_PROB.get(market_type, 0.05)
        
    role_map_key = 'mvp'
    if 'damage' in market_type: role_map_key = 'damage'
    elif 'farm' in market_type: role_map_key = 'farm'

    role_weight = ROLE_WEIGHTS.get(role_map_key, {}).get(main_role, 1.0)
    true_prob = base_prob * role_weight
    
    return _calculate_odd(_calculate_implied_prob(true_prob, dynamic_margin))

# --- GERADOR PRINCIPAL ---
def generate_odds(player_data, game_type, margins, player_pl_data=None, platform_pl=0.0):
    stats = player_data.get("stats", {})
    challenges = []
    
    main_margin = _get_dynamic_margin(margins.get('main', 0.15), player_pl_data, platform_pl)
    stats_margin = _get_dynamic_margin(margins.get('stats', 0.30), player_pl_data, platform_pl)
    
    # 1. Vitória
    win_odd = _calculate_odd(_calculate_implied_prob(_get_weighted_winrate(stats), main_margin))
    challenges.append({
        "id": f"win_{game_type}", "title": "Vencer a próxima partida", "odd": win_odd,
        "conflictKey": "match_outcome", "targetStat": "win", "targetValue": True, "gameType": game_type
    })

    if game_type == 'lol':
        # 2. Stats (Kills, Assists, Deaths)
        # Escalar dificuldade baseada no Winrate
        wr = _get_weighted_winrate(stats)
        norm_wr = (max(MIN_WR_FOR_SCALAR, min(wr, MAX_WR_FOR_SCALAR)) - MIN_WR_FOR_SCALAR) / (MAX_WR_FOR_SCALAR - MIN_WR_FOR_SCALAR)
        scalar = MIN_SCALAR_KDA + (norm_wr * (MAX_SCALAR_KDA - MIN_SCALAR_KDA))

        # Kills
        avg_k = _get_weighted_avg_stat(stats, "kill", 5.0)
        target_k = math.ceil(avg_k * (1 + scalar))
        odd_k = _calculate_odd(_calculate_implied_prob(_calculate_poisson_probability_greater_than_or_equal(target_k, avg_k), stats_margin))
        challenges.append({
            "id": f"kills_over_{target_k}", "title": f"Fazer +{target_k - 0.5} Kills", "odd": odd_k,
            "conflictKey": "kills_stat", "targetStat": "kills", "targetValue": target_k, "gameType": game_type
        })

        # Assists
        avg_a = _get_weighted_avg_stat(stats, "assist", 7.0)
        target_a = math.ceil(avg_a * (1 + scalar))
        odd_a = _calculate_odd(_calculate_implied_prob(_calculate_poisson_probability_greater_than_or_equal(target_a, avg_a), stats_margin))
        challenges.append({
            "id": f"assists_over_{target_a}", "title": f"Fazer +{target_a - 0.5} Assists", "odd": odd_a,
            "conflictKey": "assists_stat", "targetStat": "assists", "targetValue": target_a, "gameType": game_type
        })
        
        # Deaths (Under)
        avg_d = _get_weighted_avg_stat(stats, "death", 6.0)
        target_d = math.floor(avg_d * (1 - scalar))
        odd_d = _calculate_odd(_calculate_implied_prob(_calculate_poisson_prob_less_than(target_d + 1, avg_d), stats_margin))
        challenges.append({
            "id": f"deaths_under_{target_d}", "title": f"Morrer -{target_d + 0.5} vezes", "odd": odd_d,
            "conflictKey": "deaths_stat", "targetStat": "deaths", "targetValue": target_d, "gameType": game_type
        })

        # 3. Frequência
        role = _get_player_main_role(stats.get("player_roles", []))
        challenges.append({
            "id": "mvp_team", "title": "Ser Destaque do Time", 
            "odd": _get_role_weighted_prob(stats, 'mvp_team', role, stats_margin),
            "conflictKey": "mvp_outcome", "targetStat": "mvp_team", "targetValue": True, "gameType": game_type
        })
        challenges.append({
            "id": "top_damage", "title": "Maior Dano do Time", 
            "odd": _get_role_weighted_prob(stats, 'top_damage', role, stats_margin),
            "conflictKey": "damage_outcome", "targetStat": "top_damage", "targetValue": True, "gameType": game_type
        })

    return challenges

def calculate_custom_odd(account_data, game_type, target_value, margins):
    stats = account_data.get("stats", {})
    try:
        avg_kills = _get_weighted_avg_stat(stats, "kill", 5.0)
    except:
        avg_kills = stats.get("avgKills", 5.0)
        
    try:
        target = int(target_value)
    except (ValueError, TypeError):
        return {"error": "Meta inválida. Insira um número inteiro."}
    
    if target <= avg_kills:
        return {"error": f"A meta deve ser maior que sua média ({avg_kills:.1f})"}
    
    prob = _calculate_poisson_probability_greater_than_or_equal(target, avg_kills)
    if prob < 0.01: return {"error": "Probabilidade muito baixa (<1%)."}

    final_odd = _calculate_odd(_calculate_implied_prob(prob, margins.get("stats", 0.30)))
    
    return {
        "challenge": {
            "id": f"custom_{game_type}_{target}",
            "title": f"Fazer +{target} Kills",
            "odd": final_odd,
            "conflictKey": f"custom_target_{target}",
            "gameType": game_type,
            "targetStat": "kills",
            "targetValue": target
        }
    }

# --- ESTATÍSTICA ---
def _calculate_poisson_probability_greater_than_or_equal(k, lambda_):
    lambda_ = lambda_ * POISSON_LAMBDA_ADJUST
    if k <= 0: return 1.0
    cumulative = 0
    for i in range(k):
        try:
            cumulative += (math.exp(-lambda_) * (lambda_ ** i)) / math.factorial(i)
        except: pass
    return max(1 - cumulative, 0.001)

def _calculate_poisson_prob_less_than(k, lambda_):
    lambda_ = lambda_ * POISSON_LAMBDA_ADJUST
    cumulative = 0
    for i in range(k):
        try:
            cumulative += (math.exp(-lambda_) * (lambda_ ** i)) / math.factorial(i)
        except: pass
    return max(cumulative, 0.001)