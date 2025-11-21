import math
from datetime import datetime
from collections import Counter

# --- CONFIGURAÇÕES GERAIS ---
POISSON_LAMBDA_ADJUST = 0.95  
MAX_IMPLIED_PROBABILITY = 0.95 
ODD_STEP = 0.05

# --- PESOS E LIMITES ---
RECENT_7_WEIGHT = 0.6
OVERALL_20_WEIGHT = 0.4
MAX_PROB_FOR_WIN_ODD = 0.70
MIN_PROB_FOR_WIN_ODD = 0.20

# --- PESOS DE ROTA ---
ROLE_WEIGHTS = {
    'mvp': {'BOTTOM': 1.25, 'MIDDLE': 1.20, 'JUNGLE': 1.10, 'TOP': 0.90, 'UTILITY': 0.55, 'UNKNOWN': 1.0},
    'damage': {'BOTTOM': 1.40, 'MIDDLE': 1.30, 'JUNGLE': 0.90, 'TOP': 0.90, 'UTILITY': 0.50, 'UNKNOWN': 1.0},
    'farm': {'BOTTOM': 1.25, 'MIDDLE': 1.25, 'TOP': 1.10, 'JUNGLE': 1.00, 'UTILITY': 0.40, 'UNKNOWN': 1.0}
}
DEFAULT_BASE_PROB = {'mvp_team': 0.10, 'mvp_match': 0.05, 'top_damage': 0.05, 'top_farm': 0.05}

def validate_account(player_data, min_summoner_level):
    stats = player_data.get("stats", {})
    if stats.get("summonerLevel", 0) < min_summoner_level:
        return {"valid": False, "reason": f"Nível insuficiente ({stats.get('summonerLevel')}). Mín: {min_summoner_level}."}
    if stats.get("winRate", 0.5) >= 0.85:
        return {"valid": False, "reason": "Conta sob análise (Winrate > 85%)."}
    return {"valid": True}

def _calculate_odd(implied_prob, safety_reduction=0.0):
    """ Calcula a Odd final aplicando a Margem de Segurança """
    if implied_prob <= 0: return 99.0
    
    # Odd Bruta
    raw_odd = max(1 / implied_prob, 1.05)
    
    # APLICA O REDUTOR DE SEGURANÇA (Safety Margin)
    # Ex: Odd 2.00 com 10% reduction vira 1.80
    safe_odd = raw_odd * (1.0 - safety_reduction)
    
    # Garante mínimo de 1.01 e arredonda
    final_odd = max(safe_odd, 1.01)
    multiplier = 1 / ODD_STEP
    return math.floor(final_odd * multiplier) / multiplier

def _calculate_implied_prob(true_prob, margin):
    return min(true_prob * (1 + margin), MAX_IMPLIED_PROBABILITY)

def _get_weighted_winrate(stats):
    overall = stats.get("winRate", 0.5)
    recent = stats.get("recent_wins", [])[:7]
    if not recent: return overall
    
    # Suavização
    recent_cp = list(recent)
    if len(recent_cp) > 0: recent_cp[0] = True
    recent_wr = sum(1 for w in recent_cp if w) / len(recent_cp)
    
    weighted = (recent_wr * RECENT_7_WEIGHT) + (overall * OVERALL_20_WEIGHT)
    return max(MIN_PROB_FOR_WIN_ODD, min(weighted, MAX_PROB_FOR_WIN_ODD))

def _get_weighted_avg_stat(stats, stat_key, fallback):
    k_avg = f"avg{stat_key.capitalize()}s" if stat_key != "death" else "avgDeaths"
    k_rec = f"recent_{stat_key}s" if stat_key != "death" else "recent_deaths"
    
    ovr = stats.get(k_avg, fallback)
    rec_list = stats.get(k_rec, [])[:7]
    
    if len(rec_list) < 3: return ovr
    
    # Remove extremos
    sorted_rec = sorted(rec_list)
    trimmed = sorted_rec[1:-1]
    rec_avg = sum(trimmed) / len(trimmed) if trimmed else ovr
    
    return (rec_avg * RECENT_7_WEIGHT) + (ovr * OVERALL_20_WEIGHT)

def _get_role_weighted_prob(stats, mkt_type, role, margin, safety_red):
    base = stats.get(f"{mkt_type}_frequency", DEFAULT_BASE_PROB.get(mkt_type, 0.05)) or 0.05
    map_key = 'damage' if 'damage' in mkt_type else 'farm' if 'farm' in mkt_type else 'mvp'
    weight = ROLE_WEIGHTS.get(map_key, {}).get(role, 1.0)
    
    true_prob = base * weight
    return _calculate_odd(_calculate_implied_prob(true_prob, margin), safety_red)

# --- GERADOR PRINCIPAL ---
def generate_odds(player_data, game_type, config_margins, math_config):
    """
    Gera odds usando as configs dinâmicas do Admin.
    math_config: { 'difficulty_scalar': 0.30, 'safety_reduction': 0.10 }
    """
    stats = player_data.get("stats", {})
    challenges = []
    
    # Configs
    margin_main = config_margins.get('main', 0.15)
    margin_stats = config_margins.get('stats', 0.30)
    
    scalar = math_config.get('difficulty_scalar', 0.30) # O tal dos 25% a 65%
    safety = math_config.get('safety_reduction', 0.10) # O tal dos 10% subtração
    
    # 1. Vitória
    win_odd = _calculate_odd(_calculate_implied_prob(_get_weighted_winrate(stats), margin_main), safety)
    challenges.append({
        "id": f"win_{game_type}", "title": "Vencer a próxima partida", "odd": win_odd,
        "conflictKey": "match_outcome", "targetStat": "win", "targetValue": True, "gameType": game_type
    })

    if game_type == 'lol':
        # Kills
        avg_k = _get_weighted_avg_stat(stats, "kill", 5.0)
        target_k = math.ceil(avg_k * (1 + scalar)) # Aplica a dificuldade configurável
        prob_k = _calculate_poisson_probability_greater_than_or_equal(target_k, avg_k)
        odd_k = _calculate_odd(_calculate_implied_prob(prob_k, margin_stats), safety)
        
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
        
        # MVP & Damage (Frequência)
        role = _get_player_main_role(stats.get("player_roles", []))
        challenges.append({
            "id": "mvp_team", "title": "Ser Destaque do Time", 
            "odd": _get_role_weighted_prob(stats, 'mvp_team', role, margin_stats, safety),
            "conflictKey": "mvp_outcome", "targetStat": "mvp_team", "targetValue": True, "gameType": game_type
        })
        
    return challenges

def calculate_custom_odd(account_data, game_type, target_value, margins, math_config):
    stats = account_data.get("stats", {})
    safety = math_config.get('safety_reduction', 0.10)
    
    try:
        avg_kills = _get_weighted_avg_stat(stats, "kill", 5.0)
        target = int(target_value)
    except: return {"error": "Inválido"}
    
    if target <= avg_kills: return {"error": f"Meta deve ser > {avg_kills:.1f}"}
    
    prob = _calculate_poisson_probability_greater_than_or_equal(target, avg_kills)
    if prob < 0.01: return {"error": "Improvável (<1%)"}

    final_odd = _calculate_odd(_calculate_implied_prob(prob, margins.get("stats", 0.30)), safety)
    
    return {
        "challenge": {
            "id": f"custom_{game_type}_{target}", "title": f"Fazer +{target} Kills", "odd": final_odd,
            "conflictKey": f"custom_target_{target}", "gameType": game_type, "targetStat": "kills", "targetValue": target
        }
    }

def _get_player_main_role(roles_list):
    if not roles_list: return "UNKNOWN"
    roles_list = ['MIDDLE' if r == 'MID' else 'BOTTOM' if r == 'BOT' else r for r in roles_list]
    try: return Counter(roles_list).most_common(1)[0][0]
    except: return "UNKNOWN"

def _calculate_poisson_probability_greater_than_or_equal(k, lambda_):
    lambda_ = lambda_ * POISSON_LAMBDA_ADJUST
    if k <= 0: return 1.0
    cumulative = 0
    for i in range(k):
        try: cumulative += (math.exp(-lambda_) * (lambda_ ** i)) / math.factorial(i)
        except: pass
    return max(1 - cumulative, 0.001)