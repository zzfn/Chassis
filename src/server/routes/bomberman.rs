use axum::{extract::{Json, State}, response::IntoResponse, routing::post, Router};
use serde::Deserialize;
use crate::bomberman::{BombermanEngine, BombermanResult, RANDOM_BOT_JS, CHASER_BOT_JS};
use crate::server::{AppState, json_err};

#[derive(Deserialize)]
struct SimulateRequest {
    player_name: String,
    player_code: String,
    /// "random" | "chaser" | "mirror"
    opponent: Option<String>,
}

async fn handle_simulate(
    State(state): State<AppState>,
    Json(req): Json<SimulateRequest>,
) -> impl IntoResponse {
    if req.player_name.trim().is_empty() || req.player_name.len() > 64 {
        return json_err(400, "玩家名称无效").into_response();
    }
    if req.player_code.len() > 65_536 {
        return json_err(400, "代码超过 64KB").into_response();
    }

    let (op_name, op_code) = match req.opponent.as_deref().unwrap_or("random") {
        "chaser" => ("chaser_bot".to_string(), CHASER_BOT_JS.to_string()),
        "mirror" => (format!("{}_mirror", req.player_name), req.player_code.clone()),
        _ => ("random_bot".to_string(), RANDOM_BOT_JS.to_string()),
    };

    let _permit = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        state.battle_sem.acquire(),
    ).await {
        Ok(Ok(p)) => p,
        _ => return json_err(503, "服务器繁忙，请稍后再试").into_response(),
    };

    let name1 = req.player_name.clone();
    let code1 = req.player_code.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<BombermanResult, String> {
        let engine = BombermanEngine::new(vec![
            (name1.as_str(), code1.as_str()),
            (op_name.as_str(), op_code.as_str()),
        ])?;
        Ok(engine.run())
    }).await;

    match result {
        Ok(Ok(r)) => axum::Json(r).into_response(),
        Ok(Err(e)) => json_err(500, &e).into_response(),
        Err(e) => json_err(500, &e.to_string()).into_response(),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/bomberman/simulate", post(handle_simulate))
}
