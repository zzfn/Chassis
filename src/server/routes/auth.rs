use axum::{
    extract::{Json, Path, State},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth, db};
use crate::server::{AppState, json_err, extract_user_id};

#[derive(Deserialize)]
struct RegisterRequest {
    username: String,
    email:    String,
    password: String,
}

#[derive(Deserialize)]
struct LoginRequest {
    email:    String,
    password: String,
}

#[derive(Serialize)]
struct AuthResponse {
    token:    String,
    username: String,
}

async fn handle_register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    if req.username.trim().is_empty() || req.email.trim().is_empty() || req.password.len() < 8 {
        return json_err(400, "用户名和邮箱不能为空，密码至少 8 位");
    }
    let hash = match auth::hash_password(&req.password) {
        Ok(h)  => h,
        Err(_) => return json_err(500, "密码处理失败"),
    };
    match db::create_user(pool, db::NewUser {
        username:      req.username.trim(),
        email:         req.email.trim(),
        password_hash: &hash,
    }).await {
        Ok(Some(user)) => {
            let token = auth::create_token(&user.id.to_string(), &user.username, &state.jwt_secret);
            axum::Json(AuthResponse { token, username: user.username }).into_response()
        }
        Ok(None) => json_err(409, "用户名或邮箱已被注册"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

async fn handle_login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let user = match db::find_user_by_email(pool, req.email.trim()).await {
        Ok(Some(u)) => u,
        Ok(None)    => return json_err(401, "邮箱或密码错误"),
        Err(e)      => return json_err(500, &e.to_string()),
    };
    if !auth::verify_password(&req.password, &user.password_hash) {
        return json_err(401, "邮箱或密码错误");
    }
    let token = auth::create_token(&user.id.to_string(), &user.username, &state.jwt_secret);
    axum::Json(AuthResponse { token, username: user.username }).into_response()
}

#[derive(Deserialize)]
struct CreateKeyRequest { agent_name: String }

async fn create_key(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<CreateKeyRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    let agent_name = req.agent_name.trim().to_string();
    if agent_name.is_empty() { return json_err(400, "坦克名称不能为空"); }
    match db::create_api_key(pool, user_id, &agent_name).await {
        Ok(entry) => axum::Json(entry).into_response(),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

async fn list_keys(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    match db::list_api_keys(pool, user_id).await {
        Ok(keys) => axum::Json(keys).into_response(),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

async fn delete_key(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(key_id): Path<Uuid>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    match db::delete_api_key(pool, key_id, user_id).await {
        Ok(true)  => axum::Json(serde_json::json!({"ok": true})).into_response(),
        Ok(false) => json_err(404, "密钥不存在"),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/register", post(handle_register))
        .route("/api/login",    post(handle_login))
        .route("/api/keys",     get(list_keys).post(create_key))
        .route("/api/keys/:id", axum::routing::delete(delete_key))
}
