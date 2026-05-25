use axum::{
    extract::{Json, Path, Query, State},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{battle::ArenaEngine, db, physics::SkillType};
use crate::server::{
    AppState, json_err, extract_user_id, resolve_auth, AuthCtx,
    period_since, validate_svg, TANK_SVG_SYSTEM_PROMPT,
};

async fn submit_agent(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(auth) = resolve_auth(&headers, pool, &state.jwt_secret).await else {
        return json_err(401, "未登录或 API Key 无效");
    };

    let (user_id, name) = match auth {
        AuthCtx::ApiKey { user_id, agent_name } => (user_id, agent_name),
        AuthCtx::Jwt(user_id) => {
            let Some(n) = body.get("name").and_then(|v| v.as_str()) else {
                return json_err(400, "缺少 name 字段");
            };
            (user_id, n.to_string())
        }
    };

    let code = match body.get("code").and_then(|v| v.as_str()) {
        Some(c) => c.to_string(),
        None    => return json_err(400, "缺少 code 字段"),
    };
    let submitted_by = body.get("submitted_by").and_then(|v| v.as_str()).map(|s| s.to_string());
    let notes        = body.get("notes").and_then(|v| v.as_str()).map(|s| s.to_string());

    // 第一个坦克免费，后续每个消耗 NEW_TANK_COST 积分
    let tank_count = match db::count_user_tanks(pool, user_id).await {
        Ok(n)  => n,
        Err(e) => return json_err(500, &e.to_string()),
    };
    let mut credits_after: Option<i32> = None;
    if tank_count > 0 {
        match db::deduct_credits(pool, user_id, NEW_TANK_COST).await {
            Ok(c)  => { credits_after = Some(c); }
            Err(sqlx::Error::RowNotFound) => return json_err(400, &format!("积分不足，创建新坦克需要 {} 积分", NEW_TANK_COST)),
            Err(e) => return json_err(500, &e.to_string()),
        }
    }

    // 随机分配技能（创建时不允许用户自选）
    let skill_type = {
        let idx = (uuid::Uuid::new_v4().as_u128() % SKILL_POOL.len() as u128) as usize;
        SKILL_POOL[idx]
    };

    let is_first_time = matches!(
        db::get_latest_agent_by_name(pool, user_id, &name).await,
        Ok(None)
    );

    let agent_id = match db::create_agent(pool, user_id, &name, &code, submitted_by.as_deref(), &skill_type, notes.as_deref()).await {
        Ok(id) => id.to_string(),
        Err(e) => return json_err(500, &e.to_string()),
    };

    // 首次创建坦克 → 自动生成 API Key（失败不阻塞响应）
    let api_key = if is_first_time {
        match db::create_api_key(pool, user_id, &name).await {
            Ok(entry) => Some(entry),
            Err(e)    => { eprintln!("auto create_api_key failed: {e}"); None }
        }
    } else {
        None
    };

    axum::Json(serde_json::json!({
        "ok":         true,
        "agent_id":   agent_id,
        "skill_type": skill_type,
        "results":    [],
        "api_key":    api_key,
        "credits":    credits_after,
    })).into_response()
}

async fn get_my_agent(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let pool = &state.pool;
    let key = match headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        Some(k) => k.to_string(),
        None    => return json_err(401, "缺少 X-API-Key"),
    };
    let auth = match db::find_user_by_api_key(pool, &key).await {
        Ok(Some(a)) => a,
        Ok(None)    => return json_err(401, "API Key 无效"),
        Err(e)      => return json_err(500, &e.to_string()),
    };
    match db::get_latest_agent_by_name(pool, auth.user_id, &auth.agent_name).await {
        Ok(Some(agent)) => axum::Json(serde_json::json!({
            "agent_name": agent.name,
            "code": agent.code,
        })).into_response(),
        Ok(None) => json_err(404, "该坦克尚未提交过代码，请先用 POST /api/agent 提交"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

async fn list_my_tanks(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    match db::get_user_tanks(pool, user_id).await {
        Ok(tanks) => axum::Json(tanks).into_response(),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

async fn get_tank(
    State(state): State<AppState>,
    Path(agent_id): Path<Uuid>,
) -> impl IntoResponse {
    let pool = &state.pool;
    match db::get_tank_detail(pool, agent_id).await {
        Ok(Some(detail)) => axum::Json(detail).into_response(),
        Ok(None) => json_err(404, "坦克不存在"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

async fn delete_tank(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(agent_id): Path<Uuid>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    match db::delete_tank(pool, agent_id, user_id).await {
        Ok(Some(true))  => axum::Json(serde_json::json!({"ok": true})).into_response(),
        Ok(Some(false)) => json_err(403, "无权删除该坦克"),
        Ok(None)        => json_err(404, "坦克不存在"),
        Err(e)          => json_err(500, &e.to_string()),
    }
}

async fn get_tank_versions(
    State(state): State<AppState>,
    Path(agent_id): Path<Uuid>,
) -> impl IntoResponse {
    let pool = &state.pool;
    match db::get_tank_versions(pool, agent_id).await {
        Ok(Some(versions)) => axum::Json(versions).into_response(),
        Ok(None) => json_err(404, "坦克不存在"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct PlayersQuery {
    /// "today" = 过去 24h；"week" = 过去 7 天；其它/缺省 = 全部历史
    period: Option<String>,
}

async fn list_players(
    State(state): State<AppState>,
    Query(params): Query<PlayersQuery>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let since = period_since(params.period.as_deref());
    match db::list_players(pool, since).await {
        Ok(players) => axum::Json(players).into_response(),
        Err(e)      => json_err(500, &e.to_string()),
    }
}

async fn handle_challenge(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(opponent_agent_id): Path<Uuid>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(challenger_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };

    let (challenger, opponent) = match tokio::try_join!(
        db::get_latest_agent_by_user_id(pool, challenger_id),
        db::get_agent_by_id(pool, opponent_agent_id),
    ) {
        Ok(pair) => pair,
        Err(e)   => return json_err(500, &e.to_string()),
    };

    let Some(challenger) = challenger else { return json_err(404, "请先提交坦克"); };
    let Some(opponent)   = opponent   else { return json_err(404, "对手坦克不存在"); };

    if challenger_id == opponent.user_id { return json_err(400, "不能挑战自己"); }

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
    let battle_result = tokio::task::spawn_blocking(move || -> Result<crate::battle::BattleResult, String> {
        let owned = vec![
            (c_name.as_str(), c_code.as_str(), c_skill),
            (o_name.as_str(), o_code.as_str(), o_skill),
        ];
        let engine = ArenaEngine::new(owned)?;
        Ok(engine.run())
    }).await;

    match battle_result {
        Ok(Ok(mut result)) => {
            let c_name = challenger.name.clone();
            let o_name = opponent.name.clone();
            if let Ok(Some(skin)) = db::get_tank_skin(pool, challenger_id, &c_name).await {
                result.skins.insert(c_name.clone(), skin);
            }
            if let Ok(Some(skin)) = db::get_tank_skin(pool, opponent_user_id, &o_name).await {
                result.skins.insert(o_name.clone(), skin);
            }
            match db::save_pvp_battle(pool, challenger_id, opponent_user_id, &c_name, &o_name, &result).await {
                Ok(id) => axum::Json(serde_json::json!({ "id": id.to_string(), "winner": result.winner })).into_response(),
                Err(e) => json_err(500, &e.to_string()),
            }
        }
        Ok(Err(e)) => json_err(500, &e),
        Err(e)     => json_err(500, &e.to_string()),
    }
}

async fn handle_matchmake(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(challenger_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };

    let challenger = match db::get_latest_agent_by_user_id(pool, challenger_id).await {
        Ok(Some(a)) => a,
        Ok(None)    => return json_err(404, "请先提交坦克"),
        Err(e)      => return json_err(500, &e.to_string()),
    };
    let opponent = match db::get_random_opponent(pool, challenger_id, &challenger.name).await {
        Ok(Some(a)) => a,
        Ok(None)    => return json_err(404, "暂无其他玩家，快邀请好友来战吧"),
        Err(e)      => return json_err(500, &e.to_string()),
    };

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
    let battle_result = tokio::task::spawn_blocking(move || -> Result<crate::battle::BattleResult, String> {
        let owned = vec![
            (c_name.as_str(), c_code.as_str(), c_skill),
            (o_name.as_str(), o_code.as_str(), o_skill),
        ];
        let engine = ArenaEngine::new(owned)?;
        Ok(engine.run())
    }).await;

    match battle_result {
        Ok(Ok(mut result)) => {
            let c_name = challenger.name.clone();
            let o_name = opponent.name.clone();
            if let Ok(Some(skin)) = db::get_tank_skin(pool, challenger_id, &c_name).await {
                result.skins.insert(c_name.clone(), skin);
            }
            if let Ok(Some(skin)) = db::get_tank_skin(pool, opponent_user_id, &o_name).await {
                result.skins.insert(o_name.clone(), skin);
            }
            match db::save_pvp_battle(pool, challenger_id, opponent_user_id, &c_name, &o_name, &result).await {
                Ok(id) => axum::Json(serde_json::json!({
                    "id": id.to_string(),
                    "opponent": o_name,
                    "winner": result.winner,
                })).into_response(),
                Err(e) => json_err(500, &e.to_string()),
            }
        }
        Ok(Err(e)) => json_err(500, &e),
        Err(e)     => json_err(500, &e.to_string()),
    }
}

async fn handle_matchmake_2v2(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(challenger_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };

    // 取玩家最新坦克
    let challenger = match db::get_latest_agent_by_user_id(pool, challenger_id).await {
        Ok(Some(a)) => a,
        Ok(None)    => return json_err(404, "请先提交坦克"),
        Err(e)      => return json_err(500, &e.to_string()),
    };

    // 随机抽取 3 个其他玩家坦克
    let others = match db::get_random_agents(pool, challenger_id, 3).await {
        Ok(v) if v.len() >= 3 => v,
        Ok(_)                  => return json_err(400, "对手不足，暂无法匹配 2v2"),
        Err(e)                 => return json_err(500, &e.to_string()),
    };

    // 队伍分配：id=0(team0) 玩家 + id=2(team0) 随机A  vs  id=1(team1) 随机B + id=3(team1) 随机C
    let c_name  = challenger.name.clone();
    let c_code  = challenger.code.clone();
    let a_name  = others[0].name.clone();
    let a_code  = others[0].code.clone();
    let b_name  = others[1].name.clone();
    let b_code  = others[1].code.clone();
    let cc_name = others[2].name.clone();
    let cc_code = others[2].code.clone();

    let ally_user_id   = others[0].user_id;
    let enemy1_user_id = others[1].user_id;
    let enemy2_user_id = others[2].user_id;
    let c_skill  = SkillType::from_str(&challenger.skill_type);
    let a_skill  = SkillType::from_str(&others[0].skill_type);
    let b_skill  = SkillType::from_str(&others[1].skill_type);
    let cc_skill = SkillType::from_str(&others[2].skill_type);
    let _permit = match tokio::time::timeout(
        std::time::Duration::from_secs(15),
        state.battle_sem.acquire(),
    ).await {
        Ok(Ok(p)) => p,
        _ => return json_err(503, "服务器繁忙，请稍后再试"),
    };
    let battle_result = tokio::task::spawn_blocking(move || -> Result<crate::battle::BattleResult, String> {
        // 顺序：[0]=挑战者(team0), [1]=随机B(team1), [2]=随机A(team0), [3]=随机C(team1)
        // ArenaEngine 按 id%2 分队：偶数=team0, 奇数=team1
        let owned = vec![
            (c_name.as_str(),  c_code.as_str(),  c_skill),   // id=0, team0
            (b_name.as_str(),  b_code.as_str(),  b_skill),   // id=1, team1
            (a_name.as_str(),  a_code.as_str(),  a_skill),   // id=2, team0
            (cc_name.as_str(), cc_code.as_str(), cc_skill),  // id=3, team1
        ];
        let engine = ArenaEngine::new(owned)?;
        Ok(engine.run())
    }).await;

    match battle_result {
        Ok(Ok(mut result)) => {
            let c_name  = challenger.name.clone();
            let a_name  = others[0].name.clone();
            let b_name  = others[1].name.clone();
            let cc_name = others[2].name.clone();

            // 载入皮肤
            if let Ok(Some(skin)) = db::get_tank_skin(pool, challenger_id, &c_name).await {
                result.skins.insert(c_name.clone(), skin);
            }
            if let Ok(Some(skin)) = db::get_tank_skin(pool, ally_user_id, &a_name).await {
                result.skins.insert(a_name.clone(), skin);
            }
            if let Ok(Some(skin)) = db::get_tank_skin(pool, enemy1_user_id, &b_name).await {
                result.skins.insert(b_name.clone(), skin);
            }
            if let Ok(Some(skin)) = db::get_tank_skin(pool, enemy2_user_id, &cc_name).await {
                result.skins.insert(cc_name.clone(), skin);
            }

            // 以挑战者 vs 第一个敌方为主场记录（兼容现有 save_pvp_battle 签名）
            let battle_id = match db::save_pvp_battle(pool, challenger_id, enemy1_user_id, &c_name, &b_name, &result).await {
                Ok(id) => id,
                Err(e) => return json_err(500, &e.to_string()),
            };

            // 补存盟友 vs 第二个敌方，确保 ally 和 enemy2 的 Elo 也被更新
            if ally_user_id != challenger_id {
                let _ = db::save_pvp_battle(pool, ally_user_id, enemy2_user_id, &a_name, &cc_name, &result).await;
            }

            axum::Json(serde_json::json!({
                "id": battle_id.to_string(),
                "winner": result.winner,
                "winner_team": if result.winner.is_empty() { serde_json::Value::Null }
                               else { serde_json::Value::String(result.winner.clone()) },
            })).into_response()
        }
        Ok(Err(e)) => json_err(500, &e),
        Err(e)     => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct GenerateSkinRequest { description: String }

async fn generate_skin(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<GenerateSkinRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };

    let Ok(Some((owner_id, agent_name, _))) = db::get_skin_by_agent_id(pool, id).await else {
        return json_err(404, "坦克不存在");
    };
    if owner_id != user_id { return json_err(403, "无权操作"); }

    let description = req.description.trim().to_string();
    if description.is_empty() { return json_err(400, "描述不能为空"); }

    let api_key = std::env::var("DEEPSEEK_API_KEY").unwrap_or_default();
    if api_key.is_empty() { return json_err(500, "未配置 DEEPSEEK_API_KEY"); }

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            { "role": "system", "content": TANK_SVG_SYSTEM_PROMPT },
            { "role": "user", "content": description }
        ],
        "temperature": 0.7,
        "max_tokens": 2048,
        "response_format": { "type": "json_object" }
    });

    let resp = match client
        .post("https://api.deepseek.com/v1/chat/completions")
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
    {
        Ok(r)  => r,
        Err(e) => return json_err(502, &format!("DeepSeek 请求失败: {}", e)),
    };

    let resp_json: serde_json::Value = match resp.json().await {
        Ok(j)  => j,
        Err(e) => return json_err(502, &format!("DeepSeek 响应解析失败: {}", e)),
    };

    let svg_content = resp_json
        .get("choices").and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|s| s.as_str())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|j| j.get("svg").and_then(|v| v.as_str()).map(|s| s.to_string()));

    let Some(svg) = svg_content else {
        return json_err(502, "DeepSeek 返回格式异常");
    };

    if !validate_svg(&svg) {
        return json_err(400, "SVG 包含不允许的内容");
    }

    let skin = db::TankSkin { svg: Some(svg), description: Some(description), bullet_style: None };
    match db::set_tank_skin(pool, user_id, &agent_name, &skin).await {
        Ok(_)  => axum::Json(skin).into_response(),
        Err(e) => json_err(500, &e.to_string()),
    }
}

async fn get_skin(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    let pool = &state.pool;
    match db::get_skin_by_agent_id(pool, id).await {
        Ok(Some((_, _, skin))) => axum::Json(skin).into_response(),
        Ok(None) => json_err(404, "坦克不存在"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

async fn put_skin(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<Uuid>,
    Json(skin): Json<db::TankSkin>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    if let Some(ref svg) = skin.svg {
        if !validate_svg(svg) {
            return json_err(400, "SVG 包含不允许的内容");
        }
    }
    match db::get_skin_by_agent_id(pool, id).await {
        Ok(Some((owner_id, agent_name, _))) => {
            if owner_id != user_id { return json_err(403, "无权修改"); }
            match db::set_tank_skin(pool, user_id, &agent_name, &skin).await {
                Ok(_)  => axum::Json(skin).into_response(),
                Err(e) => json_err(500, &e.to_string()),
            }
        }
        Ok(None) => json_err(404, "坦克不存在"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

const SKILL_POOL: &[&str] = &["shield","freeze","stun","overload","cloak","poison","teleport","boost"];
const REROLL_COST: i32    = 100;
const NEW_TANK_COST: i32  = 200;

async fn reroll_skill(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };

    // 校验所有权
    let row = match db::get_skin_by_agent_id(pool, id).await {
        Ok(Some((owner, _, _))) => owner,
        Ok(None) => return json_err(404, "坦克不存在"),
        Err(e)   => return json_err(500, &e.to_string()),
    };
    if row != user_id { return json_err(403, "无权操作"); }

    // 查当前技能
    use sqlx::Row as _;
    let current_skill: String = match sqlx::query("SELECT skill_type FROM agents WHERE id = $1")
        .bind(id)
        .fetch_optional(pool).await
    {
        Ok(Some(r)) => r.get("skill_type"),
        _           => "shield".into(),
    };

    // 扣除积分
    let new_credits = match db::deduct_credits(pool, user_id, REROLL_COST).await {
        Ok(c)  => c,
        Err(sqlx::Error::RowNotFound) => return json_err(400, "积分不足"),
        Err(e) => return json_err(500, &e.to_string()),
    };

    // 随机新技能（保证不同于当前）
    let new_skill = {
        let current_idx = SKILL_POOL.iter().position(|&s| s == current_skill).unwrap_or(0);
        let offset = (uuid::Uuid::new_v4().as_u128() % (SKILL_POOL.len() as u128 - 1) + 1) as usize;
        SKILL_POOL[(current_idx + offset) % SKILL_POOL.len()]
    };

    if let Err(e) = db::update_agent_skill(pool, id, new_skill).await {
        return json_err(500, &e.to_string());
    }

    axum::Json(serde_json::json!({
        "ok":         true,
        "skill_type": new_skill,
        "credits":    new_credits,
    })).into_response()
}

async fn get_leaderboard(State(state): State<AppState>) -> impl IntoResponse {
    let pool = &state.pool;
    match db::get_leaderboard(pool).await {
        Ok(entries) => axum::Json(entries).into_response(),
        Err(e)      => json_err(500, &e.to_string()),
    }
}

// ── 商店 ─────────────────────────────────────────────────────────────────────

fn shop_item_price(item_type: &str, item_id: &str) -> Option<i32> {
    match (item_type, item_id) {
        ("bullet", "default")        => Some(0),
        ("bullet", "fire")           => Some(80),
        ("bullet", "plasma")         => Some(80),
        ("bullet", "void")           => Some(120),
        ("bullet", "gold")           => Some(200),
        ("name_color", "white")      => Some(0),
        ("name_color", "magenta")    => Some(60),
        ("name_color", "cyan")       => Some(60),
        ("name_color", "yellow")     => Some(60),
        ("name_color", "orange")     => Some(100),
        ("name_color", "purple")     => Some(150),
        _ => None,
    }
}

#[derive(Deserialize)]
struct ShopBuyRequest {
    item_type: String,
    item_id:   String,
}

async fn shop_inventory(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    match db::get_shop_inventory(pool, user_id).await {
        Ok(items) => axum::Json(serde_json::json!({
            "items": items.iter().map(|i| serde_json::json!({
                "item_type": i.item_type,
                "item_id":   i.item_id,
                "equipped":  i.equipped,
            })).collect::<Vec<_>>()
        })).into_response(),
        Err(e) => json_err(500, &e.to_string()),
    }
}

async fn shop_buy(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ShopBuyRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    let price = match shop_item_price(&req.item_type, &req.item_id) {
        Some(p) => p,
        None    => return json_err(400, "商品不存在"),
    };
    if price == 0 {
        return json_err(400, "免费道具无需购买");
    }
    match db::buy_shop_item(pool, user_id, &req.item_type, &req.item_id, price).await {
        Ok(new_credits) => axum::Json(serde_json::json!({
            "ok":      true,
            "credits": new_credits,
        })).into_response(),
        Err(sqlx::Error::RowNotFound) => json_err(400, "积分不足"),
        Err(e) => json_err(500, &e.to_string()),
    }
}

async fn shop_equip(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ShopBuyRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    if shop_item_price(&req.item_type, &req.item_id).is_none() {
        return json_err(400, "商品不存在");
    }
    match db::equip_shop_item(pool, user_id, &req.item_type, &req.item_id).await {
        Ok(_)  => axum::Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => json_err(500, &e.to_string()),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/agent",                   get(get_my_agent).post(submit_agent))
        .route("/api/my-tanks",                get(list_my_tanks))
        .route("/api/tanks/:id",               get(get_tank).delete(delete_tank))
        .route("/api/tanks/:id/versions",      get(get_tank_versions))
        .route("/api/tanks/:id/skin",          get(get_skin).put(put_skin))
        .route("/api/tanks/:id/skin/generate", axum::routing::post(generate_skin))
        .route("/api/tanks/:id/skill/reroll",  axum::routing::post(reroll_skill))
        .route("/api/players",                 get(list_players))
        .route("/api/challenge/:agent_id",     post(handle_challenge))
        .route("/api/matchmake",               post(handle_matchmake))
        .route("/api/matchmake/2v2",           post(handle_matchmake_2v2))
        .route("/api/leaderboard",             get(get_leaderboard))
        .route("/api/shop/inventory",          get(shop_inventory))
        .route("/api/shop/buy",                post(shop_buy))
        .route("/api/shop/equip",              post(shop_equip))
}
