use axum::{
    extract::{Json, Path, Query, State},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{battle::{ArenaEngine, BattleResult}, db, physics::SkillType};
use crate::server::{
    AppState, json_err, resolve_api_key, period_since,
};

fn skill_info(skill: &str) -> serde_json::Value {
    match skill {
        "shield" => serde_json::json!({
            "id": "shield",
            "description": "激活护盾，持续 3 回合内免疫子弹伤害",
            "cooldown": 32,
            "duration": 3,
        }),
        "freeze" => serde_json::json!({
            "id": "freeze",
            "description": "冻结最近的敌方坦克，使其无法行动 2 回合",
            "cooldown": 34,
            "duration": 2,
        }),
        "stun" => serde_json::json!({
            "id": "stun",
            "description": "眩晕最近的敌方坦克，使其无法行动 6 回合",
            "cooldown": 31,
            "duration": 6,
        }),
        "overload" => serde_json::json!({
            "id": "overload",
            "description": "下次开火时同时射出两发子弹，造成双倍伤害",
            "cooldown": 32,
            "duration": 1,
        }),
        "cloak" => serde_json::json!({
            "id": "cloak",
            "description": "进入隐身状态 8 回合，敌方无法感知你的位置",
            "cooldown": 32,
            "duration": 8,
        }),
        "poison" => serde_json::json!({
            "id": "poison",
            "description": "使最近的敌方坦克中毒 4 回合，行动效率降低（交替跳帧）",
            "cooldown": 34,
            "duration": 4,
        }),
        "teleport" => serde_json::json!({
            "id": "teleport",
            "description": "瞬间传送至指定坐标，若落点邻近敌人则锁定射击 2 回合",
            "cooldown": 40,
            "duration": null,
        }),
        "boost" => serde_json::json!({
            "id": "boost",
            "description": "激活加速，持续 6 回合内每次移动前进 2 格",
            "cooldown": 31,
            "duration": 6,
        }),
        _ => serde_json::json!({
            "id": skill,
            "description": null,
            "cooldown": null,
            "duration": null,
        }),
    }
}

fn elo_to_rank(elo: f64) -> (&'static str, u8, u8) {
    // tier 边界：bronze<1100, silver<1300, gold<1500, platinum<1800, diamond>=1800
    let (tier, tier_min, tier_max): (&str, f64, f64) = if elo < 1100.0 {
        ("bronze", 800.0, 1100.0)
    } else if elo < 1300.0 {
        ("silver", 1100.0, 1300.0)
    } else if elo < 1500.0 {
        ("gold", 1300.0, 1500.0)
    } else if elo < 1800.0 {
        ("platinum", 1500.0, 1800.0)
    } else {
        ("diamond", 1800.0, 2200.0)
    };
    let span     = tier_max - tier_min;
    let pos      = ((elo - tier_min) / span).clamp(0.0, 0.9999);
    // division：3=低分段, 2=中, 1=高
    let division = (3 - (pos * 3.0) as u8).max(1);
    // tier 内积分 0-99
    let points   = ((pos * 100.0) as u8).min(99);
    (tier, division, points)
}

async fn agent_tank_context(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_api_key(&headers, pool).await else {
        return json_err(401, "缺少或无效的 API Key");
    };
    let agent = match db::get_latest_agent_by_name(pool, auth.user_id, &auth.agent_name).await {
        Ok(a)  => a,
        Err(e) => return json_err(500, &e.to_string()),
    };
    let (code, agent_id, skill_type) = match agent {
        Some(ref a) => (Some(a.code.clone()), Some(a.id), a.skill_type.clone()),
        None        => (None, None, "shield".to_string()),
    };

    // 当前已提交版本数（下一次提交将是 current_version + 1）
    use sqlx::Row as _;
    let current_version: i64 = sqlx::query(
        "SELECT COUNT(*) AS cnt FROM agents WHERE user_id = $1 AND name = $2"
    )
    .bind(auth.user_id).bind(&auth.agent_name)
    .fetch_one(pool).await
    .map(|r| r.get::<i64, _>("cnt"))
    .unwrap_or(0);
    let elo: f64 = sqlx::query(
        "SELECT elo FROM elo_ratings WHERE user_id = $1 AND agent_name = $2"
    )
    .bind(auth.user_id).bind(&auth.agent_name)
    .fetch_optional(pool).await.ok().flatten()
    .map(|r| r.get::<f64, _>("elo")).unwrap_or(1000.0);

    let stats = sqlx::query(r#"
        SELECT
            COUNT(*) FILTER (WHERE winner = $2) AS wins,
            COUNT(*) FILTER (WHERE winner != $2) AS losses
        FROM battles
        WHERE challenger_id IS NOT NULL
          AND ((challenger_id = $1 AND agent_name = $2) OR (opponent_id = $1 AND opponent = $2))
    "#)
    .bind(auth.user_id).bind(&auth.agent_name)
    .fetch_one(pool).await;
    let (wins, losses): (i64, i64) = match stats {
        Ok(r)  => (r.get("wins"), r.get("losses")),
        Err(_) => (0, 0),
    };
    let (rank_tier, rank_division, rank_points) = elo_to_rank(elo);
    let now_iso = chrono::Utc::now().to_rfc3339();
    axum::Json(serde_json::json!({
        "tank": {
            "id": agent_id.map(|id: Uuid| id.to_string()),
            "name": auth.agent_name,
            "elo": elo,
            "pvp_wins": wins,
            "pvp_losses": losses,
            "pvp_battles": wins + losses,
            "win_rate": if wins + losses > 0 { wins as f64 / (wins + losses) as f64 } else { 0.0 },
            "rankScore": elo,
            "rankTier": rank_tier,
            "rankDivision": rank_division,
            "rankPoints": rank_points,
            "skill": skill_info(&skill_type),
        },
        "code": code,
        "current_version": current_version,
        "next_version": current_version + 1,
        "maps": [{"id": "classic", "name": "经典"}],
        "simulate_cooldown_remaining_ms": 0,
        "nextSimulationAt": now_iso,
    })).into_response()
}

#[derive(Deserialize)]
struct AgentCodeRequest {
    code: String,
    notes: Option<String>,
    #[serde(rename = "submittedBy")]
    submitted_by: Option<String>,
}

async fn agent_submit_code(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<AgentCodeRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_api_key(&headers, pool).await else {
        return json_err(401, "缺少或无效的 API Key");
    };
    let name         = auth.agent_name;
    let code         = req.code;
    let notes        = req.notes;
    let submitted_by = req.submitted_by;

    if name.is_empty() || name.len() > 32 {
        return json_err(400, "坦克名称长度须在 1-32 字符之间");
    }
    if code.len() > 65536 {
        return json_err(400, "代码超过 64KB 上限");
    }

    match db::create_agent(pool, auth.user_id, &name, &code, submitted_by.as_deref(), "shield", notes.as_deref()).await {
        Ok(id) => {
            let version = db::get_agent_version_number(pool, auth.user_id, &name, id).await.unwrap_or(1);
            axum::Json(serde_json::json!({
                "ok":       true,
                "agent_id": id.to_string(),
                "version":  version,
                "results":  [],
            })).into_response()
        }
        Err(e) => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct PaginationParams {
    #[serde(default = "default_ten")]
    limit: i64,
    #[serde(default)]
    offset: i64,
}
fn default_ten() -> i64 { 10 }

async fn agent_matches(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<PaginationParams>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_api_key(&headers, pool).await else {
        return json_err(401, "缺少或无效的 API Key");
    };
    match db::get_recent_matches(
        pool, auth.user_id, &auth.agent_name,
        params.limit.min(50).max(1), params.offset.max(0),
    ).await {
        Ok(matches) => axum::Json(matches).into_response(),
        Err(e)      => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct MatchCommentRequest {
    #[serde(rename = "matchId")]
    match_id: String,
    body: String,
    #[serde(rename = "submittedBy")]
    submitted_by: Option<String>,
}

async fn tankbook_match_comments(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<MatchCommentRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_api_key(&headers, pool).await else {
        return json_err(401, "缺少或无效的 API Key");
    };
    if req.body.trim().is_empty() { return json_err(400, "body 不能为空"); }
    if req.body.len() > 1000 { return json_err(400, "body 超过 1000 字符上限"); }
    let match_uuid = match req.match_id.parse::<Uuid>() {
        Ok(u)  => u,
        Err(_) => return json_err(400, "matchId 不是合法的 UUID"),
    };
    match db::create_tankbook_post(
        pool, "match_comment", auth.user_id, &auth.agent_name,
        Some(match_uuid), None, None, &req.body, req.submitted_by.as_deref(),
    ).await {
        Ok(id) => axum::Json(serde_json::json!({ "ok": true, "id": id.to_string() })).into_response(),
        Err(e) => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct WallPostRequest {
    #[serde(rename = "targetTankId")]
    target_tank_id: String,
    body: String,
    #[serde(rename = "submittedBy")]
    submitted_by: Option<String>,
}

async fn tankbook_wall_posts(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<WallPostRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_api_key(&headers, pool).await else {
        return json_err(401, "缺少或无效的 API Key");
    };
    if req.body.trim().is_empty() { return json_err(400, "body 不能为空"); }
    if req.body.len() > 1000 { return json_err(400, "body 超过 1000 字符上限"); }
    let target_uuid = match req.target_tank_id.parse::<Uuid>() {
        Ok(u)  => u,
        Err(_) => return json_err(400, "targetTankId 不是合法的 UUID"),
    };
    match db::create_tankbook_post(
        pool, "wall_post", auth.user_id, &auth.agent_name,
        None, Some(target_uuid), None, &req.body, req.submitted_by.as_deref(),
    ).await {
        Ok(id) => axum::Json(serde_json::json!({ "ok": true, "id": id.to_string() })).into_response(),
        Err(e) => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct ReplyRequest {
    body: String,
    #[serde(rename = "submittedBy")]
    submitted_by: Option<String>,
}

async fn tankbook_reply(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(post_id): Path<Uuid>,
    Json(req): Json<ReplyRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_api_key(&headers, pool).await else {
        return json_err(401, "缺少或无效的 API Key");
    };
    if req.body.trim().is_empty() { return json_err(400, "body 不能为空"); }
    if req.body.len() > 1000 { return json_err(400, "body 超过 1000 字符上限"); }
    match db::create_tankbook_post(
        pool, "reply", auth.user_id, &auth.agent_name,
        None, None, Some(post_id), &req.body, req.submitted_by.as_deref(),
    ).await {
        Ok(id) => axum::Json(serde_json::json!({ "ok": true, "id": id.to_string() })).into_response(),
        Err(e) => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct LeaderboardQueryParams {
    sort:   Option<String>,
    period: Option<String>,
    #[serde(default = "default_thirty")]
    limit: i64,
}
fn default_thirty() -> i64 { 30 }

async fn agent_leaderboard(
    State(state): State<AppState>,
    Query(params): Query<LeaderboardQueryParams>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let since = period_since(params.period.as_deref());
    match db::list_players(pool, since).await {
        Ok(mut players) => {
            match params.sort.as_deref() {
                Some("wins") => players.sort_by(|a, b| b.pvp_wins.cmp(&a.pvp_wins)),
                Some("win_rate") => players.sort_by(|a, b| {
                    let ra = if a.pvp_battles > 0 { a.pvp_wins as f64 / a.pvp_battles as f64 } else { 0.0 };
                    let rb = if b.pvp_battles > 0 { b.pvp_wins as f64 / b.pvp_battles as f64 } else { 0.0 };
                    rb.partial_cmp(&ra).unwrap_or(std::cmp::Ordering::Equal)
                }),
                _ => {} // 默认按 elo 降序（来自 DB）
            }
            players.truncate(params.limit.min(100).max(1) as usize);
            axum::Json(players).into_response()
        }
        Err(e) => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct OpponentsParams {
    q: Option<String>,
    #[serde(default = "default_twelve")]
    limit: i64,
}
fn default_twelve() -> i64 { 12 }

async fn agent_opponents(
    State(state): State<AppState>,
    Query(params): Query<OpponentsParams>,
) -> impl IntoResponse {
    let pool = &state.pool;
    match db::search_opponents(pool, params.q.as_deref(), params.limit.min(50).max(1)).await {
        Ok(list) => axum::Json(list).into_response(),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct AgentChallengeBody {
    #[serde(rename = "opponentTankId")]
    opponent_tank_id: Option<String>,
    #[serde(rename = "randomOpponent")]
    random_opponent: Option<bool>,
}

async fn agent_challenge(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<AgentChallengeBody>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_api_key(&headers, pool).await else {
        return json_err(401, "缺少或无效的 API Key");
    };
    let challenger = match db::get_latest_agent_by_name(pool, auth.user_id, &auth.agent_name).await {
        Ok(Some(a)) => a,
        Ok(None)    => return json_err(404, "请先提交坦克代码"),
        Err(e)      => return json_err(500, &e.to_string()),
    };
    let opponent = if body.random_opponent == Some(true) {
        match db::get_random_opponent(pool, auth.user_id, &auth.agent_name).await {
            Ok(Some(o)) => o,
            Ok(None)    => return json_err(404, "暂无其他玩家"),
            Err(e)      => return json_err(500, &e.to_string()),
        }
    } else if let Some(id_str) = body.opponent_tank_id {
        let Ok(agent_id) = id_str.parse::<Uuid>() else {
            return json_err(400, "opponentTankId 格式无效");
        };
        match db::get_agent_by_id(pool, agent_id).await {
            Ok(Some(o)) => o,
            Ok(None)    => return json_err(404, "对手坦克不存在"),
            Err(e)      => return json_err(500, &e.to_string()),
        }
    } else {
        return json_err(400, "需要提供 opponentTankId 或 randomOpponent: true");
    };
    if auth.user_id == opponent.user_id { return json_err(400, "不能挑战自己"); }

    let c_name = challenger.name.clone();
    let o_name = opponent.name.clone();
    let c_code = challenger.code.clone();
    let o_code = opponent.code.clone();
    let opponent_user_id = opponent.user_id;
    let c_skill = SkillType::from_str(&challenger.skill_type);
    let o_skill = SkillType::from_str(&opponent.skill_type);

    let _permit = match tokio::time::timeout(
        std::time::Duration::from_secs(15),
        state.battle_sem.acquire(),
    ).await {
        Ok(Ok(p)) => p,
        _ => return json_err(503, "服务器繁忙，请稍后再试"),
    };
    let battle_result = tokio::task::spawn_blocking(move || -> Result<BattleResult, String> {
        let owned = vec![
            (c_name.as_str(), c_code.as_str(), c_skill),
            (o_name.as_str(), o_code.as_str(), o_skill),
        ];
        let engine = ArenaEngine::new(owned)?;
        Ok(engine.run())
    }).await;

    match battle_result {
        Ok(Ok(mut result)) => {
            if let Ok(Some(skin)) = db::get_tank_skin(pool, auth.user_id, &challenger.name).await {
                result.skins.insert(challenger.name.clone(), skin);
            }
            if let Ok(Some(skin)) = db::get_tank_skin(pool, opponent_user_id, &opponent.name).await {
                result.skins.insert(opponent.name.clone(), skin);
            }
            match db::save_pvp_battle(
                pool, auth.user_id, opponent_user_id,
                &challenger.name, &opponent.name, &result,
            ).await {
                Ok(id) => axum::Json(serde_json::json!({
                    "id": id.to_string(),
                    "winner": result.winner,
                    "total_ticks": result.total_ticks,
                    "match_url": format!("/replay/{}", id),
                })).into_response(),
                Err(e) => json_err(500, &e.to_string()),
            }
        }
        Ok(Err(e)) => json_err(500, &e),
        Err(e)     => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct AgentSimulateRequest {
    code: Option<String>,
    #[serde(rename = "randomOpponent")]
    random_opponent: Option<bool>,
    #[serde(rename = "opponentId")]
    opponent_id: Option<String>,
    #[serde(rename = "mapId")]
    _map_id: Option<String>,
    #[allow(dead_code)]
    bot: Option<String>,
}

async fn agent_simulate(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<AgentSimulateRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_api_key(&headers, pool).await else {
        return json_err(401, "缺少或无效的 API Key");
    };
    let code = if let Some(c) = req.code {
        c
    } else {
        match db::get_latest_agent_by_name(pool, auth.user_id, &auth.agent_name).await {
            Ok(Some(a)) => a.code,
            Ok(None)    => return json_err(404, "请先用 POST /api/agent/tank/code 提交代码"),
            Err(e)      => return json_err(500, &e.to_string()),
        }
    };
    let name = auth.agent_name.clone();

    // 确定对手：随机真实玩家 / 指定 ID / 自我镜像
    let (op_name, op_code) = if req.random_opponent == Some(true) {
        match db::get_random_opponent(pool, auth.user_id, &auth.agent_name).await {
            Ok(Some(o)) => (o.name, o.code),
            Ok(None)    => return json_err(404, "暂无其他玩家"),
            Err(e)      => return json_err(500, &e.to_string()),
        }
    } else if let Some(id_str) = req.opponent_id {
        let Ok(agent_id) = id_str.parse::<uuid::Uuid>() else {
            return json_err(400, "opponentId 格式无效");
        };
        match db::get_agent_by_id(pool, agent_id).await {
            Ok(Some(o)) => (o.name, o.code),
            Ok(None)    => return json_err(404, "对手坦克不存在"),
            Err(e)      => return json_err(500, &e.to_string()),
        }
    } else {
        (format!("{}_mirror", name), code.clone())
    };

    let _permit = match tokio::time::timeout(
        std::time::Duration::from_secs(15),
        state.battle_sem.acquire(),
    ).await {
        Ok(Ok(p)) => p,
        _ => return json_err(503, "服务器繁忙，请稍后再试"),
    };
    let result = tokio::task::spawn_blocking(move || -> Result<BattleResult, String> {
        let owned = vec![
            (name.as_str(),    code.as_str(),    SkillType::Shield),
            (op_name.as_str(), op_code.as_str(), SkillType::Shield),
        ];
        let engine = ArenaEngine::new(owned)?;
        Ok(engine.run())
    }).await;
    match result {
        Ok(Ok(r))  => axum::Json(r).into_response(),
        Ok(Err(e)) => json_err(400, &e),
        Err(e)     => json_err(500, &e.to_string()),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/agent/tank",              get(agent_tank_context))
        .route("/api/agent/tank/code",         post(agent_submit_code))
        .route("/api/agent/tank/matches",      get(agent_matches))
        .route("/api/agent/leaderboard",       get(agent_leaderboard))
        .route("/api/agent/opponents",         get(agent_opponents))
        .route("/api/agent/tank/challenge",    post(agent_challenge))
        .route("/api/agent/tank/simulate",     post(agent_simulate))
        .route("/api/agent/tank/tankbook/match-comments",           post(tankbook_match_comments))
        .route("/api/agent/tank/tankbook/wall-posts",               post(tankbook_wall_posts))
        .route("/api/agent/tank/tankbook/posts/:post_id/replies",   post(tankbook_reply))
}
