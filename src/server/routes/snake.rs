use axum::{
    extract::{Json, Path, Query, State},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::snake::{SnakeEngine, SnakeResult};
use crate::{db, server::{AppState, json_err, extract_user_id}};

// ── 上下文 ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct NameParam { name: Option<String> }

async fn handle_context(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(q): Query<NameParam>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录").into_response();
    };
    let snakes = match db::get_user_snakes(pool, user_id).await {
        Ok(s)  => s,
        Err(e) => return json_err(500, &e.to_string()).into_response(),
    };
    let current_name = q.name.as_deref()
        .or_else(|| snakes.first().map(|s| s.agent_name.as_str()))
        .map(|s| s.to_string());
    let (code, version) = if let Some(ref name) = current_name {
        match db::get_latest_snake_agent(pool, user_id, name).await {
            Ok(Some(a)) => {
                let v = db::get_snake_agent_version(pool, user_id, name, a.id).await.unwrap_or(1);
                (Some(a.code), v)
            }
            _ => (None, 0),
        }
    } else {
        (None, 0)
    };
    axum::Json(serde_json::json!({
        "snakes": snakes,
        "current_name": current_name,
        "code": code,
        "version": version,
    })).into_response()
}

// ── 提交代码 ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SubmitCodeRequest {
    name: String,
    code: String,
}

async fn handle_submit_code(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<SubmitCodeRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录").into_response();
    };
    if req.name.trim().is_empty() || req.name.len() > 64 {
        return json_err(400, "蛇的名称无效（1-64 字符）").into_response();
    }
    if req.code.len() > 65_536 {
        return json_err(400, "代码超过 64KB 上限").into_response();
    }
    match db::create_snake_agent(pool, user_id, &req.name, &req.code).await {
        Ok(id) => {
            let version = db::get_snake_agent_version(pool, user_id, &req.name, id).await.unwrap_or(1);
            axum::Json(serde_json::json!({ "ok": true, "agent_id": id.to_string(), "version": version })).into_response()
        }
        Err(e) => json_err(500, &e.to_string()).into_response(),
    }
}

// ── 对战历史 ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct MatchesQuery {
    name:   String,
    #[serde(default = "default_20")]
    limit:  i64,
    #[serde(default)]
    offset: i64,
}
fn default_20() -> i64 { 20 }

async fn handle_matches(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Query(q): Query<MatchesQuery>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录").into_response();
    };
    match db::get_snake_matches(pool, user_id, &q.name, q.limit.min(50).max(1), q.offset.max(0)).await {
        Ok(matches) => axum::Json(matches).into_response(),
        Err(e)      => json_err(500, &e.to_string()).into_response(),
    }
}

// ── 玩家列表 ──────────────────────────────────────────────────────────────────

async fn handle_players(State(state): State<AppState>) -> impl IntoResponse {
    match db::list_snake_players(&state.pool).await {
        Ok(list) => axum::Json(list).into_response(),
        Err(e)   => json_err(500, &e.to_string()).into_response(),
    }
}

// ── 模拟对战（保存 + 返回回放 ID）─────────────────────────────────────────────

#[derive(Deserialize)]
struct SimulateRequest {
    name:            String,
    code:            Option<String>,
    opponent_id:     Option<String>,
    random_opponent: Option<bool>,
}

async fn handle_simulate(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<SimulateRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录").into_response();
    };
    if req.name.trim().is_empty() || req.name.len() > 64 {
        return json_err(400, "蛇名称无效").into_response();
    }

    // 确定挑战方代码
    let my_code = if let Some(c) = req.code.clone() {
        if c.len() > 65_536 { return json_err(400, "代码超过 64KB").into_response(); }
        c
    } else {
        match db::get_latest_snake_agent(pool, user_id, &req.name).await {
            Ok(Some(a)) => a.code,
            Ok(None)    => return json_err(404, "请先提交蛇代码").into_response(),
            Err(e)      => return json_err(500, &e.to_string()).into_response(),
        }
    };

    // 确定对手
    let (op_id, op_name, op_code) = if req.random_opponent == Some(true) {
        match db::get_random_snake_opponent(pool, user_id, &req.name).await {
            Ok(Some(o)) => (o.user_id, o.name, o.code),
            Ok(None)    => return json_err(404, "暂无其他玩家").into_response(),
            Err(e)      => return json_err(500, &e.to_string()).into_response(),
        }
    } else if let Some(id_str) = req.opponent_id.clone() {
        let Ok(aid) = id_str.parse::<Uuid>() else {
            return json_err(400, "opponent_id 格式无效").into_response();
        };
        match db::get_snake_agent_by_id(pool, aid).await {
            Ok(Some(o)) => (o.user_id, o.name, o.code),
            Ok(None)    => return json_err(404, "对手不存在").into_response(),
            Err(e)      => return json_err(500, &e.to_string()).into_response(),
        }
    } else {
        // 自我镜像
        (user_id, format!("{}_mirror", req.name), my_code.clone())
    };

    let _permit = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        state.battle_sem.acquire(),
    ).await {
        Ok(Ok(p)) => p,
        _ => return json_err(503, "服务器繁忙，请稍后再试").into_response(),
    };

    let my_name  = req.name.clone();
    let my_code2 = my_code.clone();
    let op_name2 = op_name.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<SnakeResult, String> {
        let engine = SnakeEngine::new(vec![
            (my_name.as_str(),  my_code2.as_str()),
            (op_name2.as_str(), op_code.as_str()),
        ])?;
        Ok(engine.run())
    }).await;

    match result {
        Ok(Ok(snake_result)) => {
            match db::save_snake_pvp_battle(
                pool, user_id, op_id, &req.name, &op_name, &snake_result,
            ).await {
                Ok(id) => axum::Json(serde_json::json!({
                    "id":           id.to_string(),
                    "winner":       snake_result.winner,
                    "winner_label": snake_result.winner_label,
                    "total_ticks":  snake_result.total_ticks,
                    "replay_url":   format!("/snake/replay/{}", id),
                })).into_response(),
                Err(e) => json_err(500, &e.to_string()).into_response(),
            }
        }
        Ok(Err(e)) => json_err(500, &e).into_response(),
        Err(e)     => json_err(500, &e.to_string()).into_response(),
    }
}

// ── 挑战特定玩家 ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ChallengeRequest {
    snake_name:   String,
    opponent_id:  String,
}

async fn handle_challenge(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ChallengeRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录").into_response();
    };
    let challenger = match db::get_latest_snake_agent(pool, user_id, &req.snake_name).await {
        Ok(Some(a)) => a,
        Ok(None)    => return json_err(404, "请先提交蛇代码").into_response(),
        Err(e)      => return json_err(500, &e.to_string()).into_response(),
    };
    let Ok(op_agent_id) = req.opponent_id.parse::<Uuid>() else {
        return json_err(400, "opponent_id 格式无效").into_response();
    };
    let opponent = match db::get_snake_agent_by_id(pool, op_agent_id).await {
        Ok(Some(o)) => o,
        Ok(None)    => return json_err(404, "对手不存在").into_response(),
        Err(e)      => return json_err(500, &e.to_string()).into_response(),
    };
    if user_id == opponent.user_id { return json_err(400, "不能挑战自己").into_response(); }

    let _permit = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        state.battle_sem.acquire(),
    ).await {
        Ok(Ok(p)) => p,
        _ => return json_err(503, "服务器繁忙，请稍后再试").into_response(),
    };

    let c_name = challenger.name.clone();
    let c_code = challenger.code.clone();
    let o_name = opponent.name.clone();
    let o_code = opponent.code.clone();
    let op_uid = opponent.user_id;

    let result = tokio::task::spawn_blocking(move || -> Result<SnakeResult, String> {
        let engine = SnakeEngine::new(vec![
            (c_name.as_str(), c_code.as_str()),
            (o_name.as_str(), o_code.as_str()),
        ])?;
        Ok(engine.run())
    }).await;

    match result {
        Ok(Ok(r)) => {
            match db::save_snake_pvp_battle(
                pool, user_id, op_uid, &challenger.name, &opponent.name, &r,
            ).await {
                Ok(id) => axum::Json(serde_json::json!({
                    "id":           id.to_string(),
                    "winner":       r.winner,
                    "winner_label": r.winner_label,
                    "total_ticks":  r.total_ticks,
                    "replay_url":   format!("/snake/replay/{}", id),
                })).into_response(),
                Err(e) => json_err(500, &e.to_string()).into_response(),
            }
        }
        Ok(Err(e)) => json_err(500, &e).into_response(),
        Err(e)     => json_err(500, &e.to_string()).into_response(),
    }
}

// ── 删除蛇 ────────────────────────────────────────────────────────────────────

async fn handle_delete_snake(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(name): Path<String>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录").into_response();
    };
    if name.trim().is_empty() {
        return json_err(400, "蛇名无效").into_response();
    }
    match db::delete_snake_agent(pool, user_id, &name).await {
        Ok(()) => axum::Json(serde_json::json!({ "ok": true })).into_response(),
        Err(e) => json_err(500, &e.to_string()).into_response(),
    }
}

// ── 回放 ──────────────────────────────────────────────────────────────────────

async fn handle_replay(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    match db::get_snake_battle(&state.pool, id).await {
        Ok(Some(record)) => {
            let body = serde_json::to_string(&record).unwrap_or_default();
            axum::response::Response::builder()
                .status(200)
                .header("Content-Type", "application/json")
                .body(axum::body::Body::from(body))
                .unwrap()
        }
        Ok(None) => json_err(404, "回放不存在").into_response(),
        Err(e)   => json_err(500, &e.to_string()).into_response(),
    }
}

// ── Router ────────────────────────────────────────────────────────────────────

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/snake/context",   get(handle_context))
        .route("/api/snake/code",      post(handle_submit_code))
        .route("/api/snake/matches",   get(handle_matches))
        .route("/api/snake/players",   get(handle_players))
        .route("/api/snake/simulate",  post(handle_simulate))
        .route("/api/snake/challenge", post(handle_challenge))
        .route("/api/snake/replay/:id", get(handle_replay))
        .route("/api/snake/:name",     axum::routing::delete(handle_delete_snake))
}
