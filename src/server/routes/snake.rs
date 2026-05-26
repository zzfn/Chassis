use axum::{extract::{Json, State}, response::IntoResponse, routing::post, Router};
use serde::Deserialize;

use crate::snake::{SnakeEngine, SnakeResult};
use crate::server::{AppState, json_err};

#[derive(Deserialize)]
struct SnakeBattleRequest {
    name: String,
    code: String,
}

const BOT_CODE: &str = include_str!("../../../agents/snake_bot.js");

async fn handle_snake_battle(
    State(state): State<AppState>,
    Json(req): Json<SnakeBattleRequest>,
) -> impl IntoResponse {
    let _permit = match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        state.battle_sem.acquire(),
    ).await {
        Ok(Ok(p)) => p,
        _ => return json_err(503, "服务器繁忙，请稍后再试").into_response(),
    };

    if req.code.len() > 65_536 {
        return json_err(400, "代码长度不能超过 64 KB").into_response();
    }
    if req.name.trim().is_empty() || req.name.len() > 64 {
        return json_err(400, "名称无效").into_response();
    }

    let name = req.name.clone();
    let code = req.code.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<SnakeResult, String> {
        let engine = SnakeEngine::new(vec![
            (name.as_str(), code.as_str()),
            ("snake_bot",   BOT_CODE),
        ])?;
        Ok(engine.run())
    }).await;

    match result {
        Ok(Ok(r)) => {
            let body = serde_json::to_string(&r).unwrap_or_default();
            axum::response::Response::builder()
                .status(200)
                .header("Content-Type", "application/json")
                .body(axum::body::Body::from(body))
                .unwrap()
        }
        Ok(Err(e)) => json_err(500, &e).into_response(),
        Err(e)     => json_err(500, &e.to_string()).into_response(),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/snake/battle", post(handle_snake_battle))
}
