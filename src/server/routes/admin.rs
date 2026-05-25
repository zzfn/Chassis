/// 管理员后台路由 —— 所有接口均要求 JWT + is_admin=true
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::{delete, get, post},
    Router,
};
use uuid::Uuid;

use crate::db;
use crate::server::{AppState, json_err, extract_admin_user_id};

/// GET /api/admin/users — 列出所有用户
async fn list_users(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if extract_admin_user_id(&headers, &state.pool, &state.jwt_secret).await.is_none() {
        return json_err(403, "需要管理员权限");
    }
    match db::admin_list_users(&state.pool).await {
        Ok(users) => axum::Json(users).into_response(),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

/// POST /api/admin/users/:id/ban — 封禁用户
async fn ban_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    if extract_admin_user_id(&headers, &state.pool, &state.jwt_secret).await.is_none() {
        return json_err(403, "需要管理员权限");
    }
    match db::admin_set_banned(&state.pool, user_id, true).await {
        Ok(true)  => axum::Json(serde_json::json!({"ok": true})).into_response(),
        Ok(false) => json_err(404, "用户不存在"),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

/// POST /api/admin/users/:id/unban — 解封用户
async fn unban_user(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(user_id): Path<Uuid>,
) -> impl IntoResponse {
    if extract_admin_user_id(&headers, &state.pool, &state.jwt_secret).await.is_none() {
        return json_err(403, "需要管理员权限");
    }
    match db::admin_set_banned(&state.pool, user_id, false).await {
        Ok(true)  => axum::Json(serde_json::json!({"ok": true})).into_response(),
        Ok(false) => json_err(404, "用户不存在"),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

/// GET /api/admin/tanks — 列出最近 50 个 agent
async fn list_tanks(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if extract_admin_user_id(&headers, &state.pool, &state.jwt_secret).await.is_none() {
        return json_err(403, "需要管理员权限");
    }
    match db::admin_list_tanks(&state.pool).await {
        Ok(tanks) => axum::Json(tanks).into_response(),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

/// DELETE /api/admin/tanks/:id — 删除坦克（仅 agents 表，保留战斗记录）
async fn delete_tank(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(agent_id): Path<Uuid>,
) -> impl IntoResponse {
    if extract_admin_user_id(&headers, &state.pool, &state.jwt_secret).await.is_none() {
        return json_err(403, "需要管理员权限");
    }
    match db::admin_delete_tank(&state.pool, agent_id).await {
        Ok(true)  => axum::Json(serde_json::json!({"ok": true})).into_response(),
        Ok(false) => json_err(404, "坦克不存在"),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

/// GET /api/admin/stats — 系统指标
async fn system_stats(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if extract_admin_user_id(&headers, &state.pool, &state.jwt_secret).await.is_none() {
        return json_err(403, "需要管理员权限");
    }
    match db::admin_system_stats(&state.pool).await {
        Ok(stats) => axum::Json(stats).into_response(),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

/// GET /api/admin/battles — 列出最近 50 场 PvP 对战
async fn list_battles(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    if extract_admin_user_id(&headers, &state.pool, &state.jwt_secret).await.is_none() {
        return json_err(403, "需要管理员权限");
    }
    match db::admin_list_recent_battles(&state.pool, 50).await {
        Ok(battles) => axum::Json(battles).into_response(),
        Err(e)      => json_err(500, &e.to_string()),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/admin/users",           get(list_users))
        .route("/api/admin/users/:id/ban",   post(ban_user))
        .route("/api/admin/users/:id/unban", post(unban_user))
        .route("/api/admin/tanks",           get(list_tanks))
        .route("/api/admin/tanks/:id",       delete(delete_tank))
        .route("/api/admin/stats",           get(system_stats))
        .route("/api/admin/battles",         get(list_battles))
}
