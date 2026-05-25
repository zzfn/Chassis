use axum::{
    extract::{Json, Path, Query, State},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{battle::ArenaEngine, db};
use crate::server::{
    AppState, BOTS, json_err, extract_user_id, resolve_auth, AuthCtx,
    run_test_battles, period_since, validate_svg, TANK_SVG_SYSTEM_PROMPT,
};

async fn list_bots() -> impl IntoResponse {
    axum::Json(BOTS)
}

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

    let results = match run_test_battles(&name, &code).await {
        Ok(r)     => r,
        Err(resp) => return resp,
    };

    let is_first_time = matches!(
        db::get_latest_agent_by_name(pool, user_id, &name).await,
        Ok(None)
    );

    let agent_id = match db::create_agent(pool, user_id, &name, &code, submitted_by.as_deref()).await {
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
        "ok": true,
        "agent_id": agent_id,
        "results": results,
        "api_key": api_key,
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

    let battle_result = tokio::task::spawn_blocking(move || -> Result<crate::battle::BattleResult, String> {
        let owned = vec![(c_name.as_str(), c_code.as_str()), (o_name.as_str(), o_code.as_str())];
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
    let opponent = match db::get_random_opponent(pool, challenger_id).await {
        Ok(Some(a)) => a,
        Ok(None)    => return json_err(404, "暂无其他玩家，快邀请好友来战吧"),
        Err(e)      => return json_err(500, &e.to_string()),
    };

    let c_name = challenger.name.clone();
    let o_name = opponent.name.clone();
    let c_code = challenger.code.clone();
    let o_code = opponent.code.clone();
    let opponent_user_id = opponent.user_id;

    let battle_result = tokio::task::spawn_blocking(move || -> Result<crate::battle::BattleResult, String> {
        let owned = vec![(c_name.as_str(), c_code.as_str()), (o_name.as_str(), o_code.as_str())];
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

async fn get_leaderboard(State(state): State<AppState>) -> impl IntoResponse {
    let pool = &state.pool;
    match db::get_leaderboard(pool).await {
        Ok(entries) => axum::Json(entries).into_response(),
        Err(e)      => json_err(500, &e.to_string()),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/bots",                    get(list_bots))
        .route("/api/agent",                   get(get_my_agent).post(submit_agent))
        .route("/api/my-tanks",                get(list_my_tanks))
        .route("/api/tanks/:id",               get(get_tank).delete(delete_tank))
        .route("/api/tanks/:id/versions",      get(get_tank_versions))
        .route("/api/tanks/:id/skin",          get(get_skin).put(put_skin))
        .route("/api/tanks/:id/skin/generate", axum::routing::post(generate_skin))
        .route("/api/players",                 get(list_players))
        .route("/api/challenge/:agent_id",     post(handle_challenge))
        .route("/api/matchmake",               post(handle_matchmake))
        .route("/api/leaderboard",             get(get_leaderboard))
}
