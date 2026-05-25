use axum::{
    extract::{Json, Path, Query, State},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{battle::{ArenaEngine, BattleResult}, db};
use crate::server::{AppState, json_err, extract_user_id};

#[derive(Deserialize)]
struct BattleRequest {
    name:          String,
    code:          String,
    opponent:      String,
    opponent_code: String,
}

#[derive(Serialize)]
struct BattleResponse {
    id: String,
    #[serde(flatten)]
    result: BattleResult,
}

async fn handle_battle(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<BattleRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;

    if req.code.len() > 65_536 {
        return json_err(400, "代码长度不能超过 64 KB").into_response();
    }
    if req.name.trim().is_empty() || req.name.len() > 64 {
        return json_err(400, "坦克名称无效").into_response();
    }

    if req.opponent_code.len() > 65_536 {
        return json_err(400, "对手代码长度不能超过 64 KB").into_response();
    }

    let user_id       = extract_user_id(&headers, &state.jwt_secret);
    let name          = req.name.clone();
    let code          = req.code.clone();
    let opponent      = req.opponent.clone();
    let opponent_code = req.opponent_code.clone();

    let result = tokio::task::spawn_blocking({
        let name          = name.clone();
        let code          = code.clone();
        let opponent      = opponent.clone();
        let opponent_code = opponent_code.clone();
        move || -> Result<BattleResult, String> {
            let owned = vec![
                (name.as_str(),     code.as_str()),
                (opponent.as_str(), opponent_code.as_str()),
            ];
            let engine = ArenaEngine::new(owned)?;
            Ok(engine.run())
        }
    })
    .await;

    match result {
        Ok(Ok(battle_result)) => {
            let id = match db::save_battle(pool, &name, &code, &opponent, &battle_result, user_id).await {
                Ok(id) => id.to_string(),
                Err(e) => {
                    eprintln!("[DB] 保存对战失败: {}", e);
                    Uuid::nil().to_string()
                }
            };
            let body = serde_json::to_string(&BattleResponse { id, result: battle_result })
                .unwrap_or_default();
            axum::response::Response::builder()
                .status(200)
                .header("Content-Type", "application/json")
                .body(axum::body::Body::from(body))
                .unwrap()
        }
        Ok(Err(e)) => axum::response::Response::builder()
            .status(500)
            .body(axum::body::Body::from(format!("{{\"error\":\"{}\"}}", e)))
            .unwrap(),
        Err(e) => axum::response::Response::builder()
            .status(500)
            .body(axum::body::Body::from(format!("{{\"error\":\"{}\"}}", e)))
            .unwrap(),
    }
}

async fn get_replay(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    let pool = &state.pool;
    match db::get_battle(pool, id).await {
        Ok(Some(record)) => {
            let body = serde_json::to_string(&record).unwrap_or_default();
            axum::response::Response::builder()
                .status(200)
                .header("Content-Type", "application/json")
                .body(axum::body::Body::from(body))
                .unwrap()
        }
        Ok(None) => axum::response::Response::builder()
            .status(404)
            .body(axum::body::Body::from("{\"error\":\"not found\"}"))
            .unwrap(),
        Err(e) => axum::response::Response::builder()
            .status(500)
            .body(axum::body::Body::from(format!("{{\"error\":\"{}\"}}", e)))
            .unwrap(),
    }
}

#[derive(Deserialize)]
struct MatchViewParams {
    view: Option<String>,
}

async fn get_match_agent_json(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(params): Query<MatchViewParams>,
) -> impl IntoResponse {
    let pool = &state.pool;
    match db::get_battle(pool, id).await {
        Ok(Some(mut record)) => {
            if matches!(params.view.as_deref(), Some("raw") | Some("events")) {
                axum::Json(serde_json::to_value(&record).unwrap_or_default()).into_response()
            } else {
                // 紧凑模式：去掉遥测，只返回元数据
                record.telemetry = serde_json::Value::Null;
                axum::Json(serde_json::to_value(&record).unwrap_or_default()).into_response()
            }
        }
        Ok(None) => json_err(404, "not found"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct FramesParams {
    #[serde(default)]
    from: usize,
    to:   Option<usize>,
}

async fn get_match_frames(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(params): Query<FramesParams>,
) -> impl IntoResponse {
    let pool = &state.pool;
    match db::get_battle(pool, id).await {
        Ok(Some(record)) => {
            let frames = match record.telemetry.as_array() {
                Some(arr) => {
                    let to = params.to.unwrap_or(params.from + 49).min(params.from + 49);
                    arr.get(params.from..=to.min(arr.len().saturating_sub(1)))
                        .map(|s| s.to_vec())
                        .unwrap_or_default()
                }
                None => vec![],
            };
            axum::Json(serde_json::json!({ "frames": frames })).into_response()
        }
        Ok(None) => json_err(404, "not found"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/battle",                   post(handle_battle))
        .route("/api/replay/:id",               get(get_replay))
        .route("/api/matches/:id/agent.json",   get(get_match_agent_json))
        .route("/api/matches/:id/agent/frames", get(get_match_frames))
}
