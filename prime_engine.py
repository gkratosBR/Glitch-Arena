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

# --- LIMITES PARA INTERPOLAÇÃO DE SKILL ---
# Define o que é um jogador "Ruim" (Min) e "Bom" (Max) para a régua de dificuldade
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

def _calculate_odd(implied_prob, safety_reduction=0.0):
    """ 
    Calcula a Odd final aplicando a Margem de Segurança (Subtração).
    safety_reduction: Percentual a reduzir da odd final (ex: 0.10 para 10%)
    """
    if implied_prob <= 0: return 99.0
    
    # Odd Bruta (baseada na probabilidade estatística)
    raw_odd = max(1 / implied_prob, 1.05)
    
    # APLICA O REDUTOR DE SEGURANÇA (Safety Margin)
    # Ex: Odd 2.00 com 10% reduction vira 1.80
    safe_odd = raw_odd * (1.0 - safety_reduction)
    
    # Garante mínimo de 1.01 e arredonda para steps de 0.05
    final_odd = max(safe_odd, 1.01)
    multiplier = 1 / ODD_STEP
    return math.floor(final_odd * multiplier) / multiplier

def _calculate_implied_prob(true_prob, margin):
    """ Aplica a margem da casa (Vig) sobre a probabilidade real """
    return min(true_prob * (1 + margin), MAX_IMPLIED_PROBABILITY)

# --- FUNÇÕES DO MOTOR PONDERADO (LoL) ---
def _get_weighted_winrate(stats):
    overall_winrate = stats.get("winRate", 0.5)
    recent_wins = stats.get("recent_wins", [])[:7]
    
    if not recent_wins:
        weighted_winrate = overall_winrate
    else:
        # "Vitória Artificial" para suavizar (Evita 0% ou 100% absolutos)
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
        # "Média Estável": Remove extremos (o maior e o menor valor) para evitar distorção
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

def _get_role_weighted_prob(stats, market_type, main_role, margin, safety_red):
    freq_key = f"{market_type}_frequency"
    base_prob = stats.get(freq_key, DEFAULT_BASE_PROB.get(market_type, 0.05))
    if base_prob == 0.0: base_prob = DEFAULT_BASE_PROB.get(market_type, 0.05)
        
    role_map_key = 'mvp'
    if 'damage' in market_type: role_map_key = 'damage'
    elif 'farm' in market_type: role_map_key = 'farm'

    role_weight = ROLE_WEIGHTS.get(role_map_key, {}).get(main_role, 1.0)
    true_prob = base_prob * role_weight
    
    return _calculate_odd(_calculate_implied_prob(true_prob, margin), safety_red)

# --- GERADOR PRINCIPAL ---
def generate_odds(player_data, game_type, config_margins, math_config):
    """
    Gera odds usando as configs dinâmicas do Admin com Interpolação de Dificuldade.
    math_config espera: { 'min_difficulty': 0.25, 'max_difficulty': 0.65, 'safety_reduction': 0.10 }
    """
    stats = player_data.get("stats", {})
    challenges = []
    
    # Configs do Admin ou Defaults Seguros
    margin_main = config_margins.get('main', 0.15)
    margin_stats = config_margins.get('stats', 0.30)
    
    min_scalar = math_config.get('min_difficulty', 0.25) # Mínimo aumento de meta (25%)
    max_scalar = math_config.get('max_difficulty', 0.65) # Máximo aumento de meta (65%)
    safety = math_config.get('safety_reduction', 0.10)   # Redutor de Odd (10%)
    
    # 1. Vitória
    win_odd = _calculate_odd(_calculate_implied_prob(_get_weighted_winrate(stats), margin_main), safety)
    challenges.append({
        "id": f"win_{game_type}", "title": "Vencer a próxima partida", "odd": win_odd,
        "conflictKey": "match_outcome", "targetStat": "win", "targetValue": True, "gameType": game_type
    })

    if game_type == 'lol':
        # 2. Stats (Kills, Assists, Deaths)
        
        # --- CÁLCULO DA DIFICULDADE DINÂMICA (INTERPOLAÇÃO) ---
        wr = _get_weighted_winrate(stats)
        
        # Normaliza o Winrate entre 0.0 (Pior caso) e 1.0 (Melhor caso)
        # Ex: Se WR for 0.30, norm_wr = 0. Se for 0.70, norm_wr = 1. Se for 0.50, norm_wr = 0.5.
        norm_wr = (max(MIN_WR_FOR_SCALAR, min(wr, MAX_WR_FOR_SCALAR)) - MIN_WR_FOR_SCALAR) / (MAX_WR_FOR_SCALAR - MIN_WR_FOR_SCALAR)
        
        # Interpola entre o Mínimo e Máximo configurado no Admin
        # Ex: Se min=25%, max=65% e o player é mediano (0.5), scalar será 45%.
        scalar = min_scalar + (norm_wr * (max_scalar - min_scalar))

        # Kills
        avg_k = _get_weighted_avg_stat(stats, "kill", 5.0)
        target_k = math.ceil(avg_k * (1 + scalar)) # Aplica a dificuldade calculada
        prob_k = _calculate_poisson_probability_greater_than_or_equal(target_k, avg_k)
        odd_k = _calculate_odd(_calculate_implied_prob(prob_k, margin_stats), safety) # Aplica margem e segurança
        
        challenges.append({
            "id": f"kills_over_{target_k}", "title": f"Fazer +{target_k - 0.5} Kills", "odd": odd_k,
            "conflictKey": "kills_stat", "targetStat": "kills", "targetValue": target_k, "gameType": game_type
        })

        # Assists
        avg_a = _get_weighted_avg_stat(stats, "assist", 7.0)
        target_a = math.ceil(avg_a * (1 + scalar))
        prob_a = _calculate_poisson_probability_greater_than_or_equal(target_a, avg_a)
        odd_a = _calculate_odd(_calculate_implied_prob(prob_a, margin_stats), safety)
        
        challenges.append({
            "id": f"assists_over_{target_a}", "title": f"Fazer +{target_a - 0.5} Assists", "odd": odd_a,
            "conflictKey": "assists_stat", "targetStat": "assists", "targetValue": target_a, "gameType": game_type
        })
        
        # Deaths (Under - Desafio Inverso)
        avg_d = _get_weighted_avg_stat(stats, "death", 6.0)
        # Para mortes, queremos MENOS, então reduzimos a média pelo scalar
        target_d = math.floor(avg_d * (1 - scalar)) 
        prob_d = _calculate_poisson_prob_less_than(target_d + 1, avg_d)
        odd_d = _calculate_odd(_calculate_implied_prob(prob_d, margin_stats), safety)
        
        challenges.append({
            "id": f"deaths_under_{target_d}", "title": f"Morrer -{target_d + 0.5} vezes", "odd": odd_d,
            "conflictKey": "deaths_stat", "targetStat": "deaths", "targetValue": target_d, "gameType": game_type
        })

        # 3. Frequência (MVP, Dano)
        role = _get_player_main_role(stats.get("player_roles", []))
        challenges.append({
            "id": "mvp_team", "title": "Ser Destaque do Time", 
            "odd": _get_role_weighted_prob(stats, 'mvp_team', role, margin_stats, safety),
            "conflictKey": "mvp_outcome", "targetStat": "mvp_team", "targetValue": True, "gameType": game_type
        })
        challenges.append({
            "id": "top_damage", "title": "Maior Dano do Time", 
            "odd": _get_role_weighted_prob(stats, 'top_damage', role, margin_stats, safety),
            "conflictKey": "damage_outcome", "targetStat": "top_damage", "targetValue": True, "gameType": game_type
        })

    return challenges

def calculate_custom_odd(account_data, game_type, target_value, margins, math_config):
    """ Calcula odd para aposta personalizada (Ex: Quero fazer 20 kills) """
    stats = account_data.get("stats", {})
    safety = math_config.get('safety_reduction', 0.10)
    
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

    final_odd = _calculate_odd(_calculate_implied_prob(prob, margins.get("stats", 0.30)), safety)
    
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

# --- ESTATÍSTICA (POISSON) ---
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