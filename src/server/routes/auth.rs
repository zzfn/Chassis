use axum::{
    extract::{Json, Path, Query, State},
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{auth, db};
use crate::server::{AppState, json_err, extract_user_id, send_verification_email};

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
    user_id:  String,
}

async fn handle_register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    if req.username.trim().is_empty() || req.email.trim().is_empty()
        || req.password.len() < 8 || req.password.len() > 128 {
        return json_err(400, "用户名和邮箱不能为空，密码长度 8-128 位");
    }
    let hash = match auth::hash_password(&req.password) {
        Ok(h)  => h,
        Err(_) => return json_err(500, "密码处理失败"),
    };
    let user = match db::create_user(pool, db::NewUser {
        username:      req.username.trim(),
        email:         req.email.trim(),
        password_hash: &hash,
    }).await {
        Ok(Some(u)) => u,
        Ok(None)    => return json_err(409, "用户名或邮箱已被注册"),
        Err(e)      => return json_err(500, &e.to_string()),
    };

    let token = match db::create_verification_token(pool, user.id).await {
        Ok(t)  => t,
        Err(e) => return json_err(500, &e.to_string()),
    };

    if !state.resend_api_key.is_empty() {
        if let Err(e) = send_verification_email(
            &state.resend_api_key,
            &state.from_email,
            req.email.trim(),
            &user.username,
            &state.app_url,
            &token,
        ).await {
            eprintln!("[Email] 发送失败: {}", e);
        }
    } else {
        // 未配置 Resend 时打印验证链接，方便本地调试
        println!("[Email] 验证链接: {}/verify-email?token={}", state.app_url, token);
    }

    axum::Json(serde_json::json!({ "message": "请查收验证邮件" })).into_response()
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
    if user.banned {
        return json_err(403, "账户已被封禁");
    }
    if !user.email_verified {
        return json_err(403, "请先验证邮箱，检查你的收件箱");
    }
    let token = auth::create_token(&user.id.to_string(), &user.username, &state.jwt_secret);
    axum::Json(AuthResponse { token, username: user.username, user_id: user.id.to_string() }).into_response()
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

#[derive(Deserialize)]
struct VerifyEmailQuery { token: String }

#[derive(Deserialize)]
struct ResendRequest { email: String }

async fn handle_resend_verification(
    State(state): State<AppState>,
    Json(req): Json<ResendRequest>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let user = match db::find_user_by_email(pool, req.email.trim()).await {
        Ok(Some(u)) => u,
        Ok(None)    => return axum::Json(serde_json::json!({ "message": "若邮箱存在，验证邮件已发送" })).into_response(),
        Err(e)      => return json_err(500, &e.to_string()),
    };
    if user.email_verified {
        return json_err(400, "邮箱已验证，请直接登录");
    }
    if user.banned {
        return json_err(403, "账户已被封禁");
    }
    let token = match db::create_verification_token(pool, user.id).await {
        Ok(t)  => t,
        Err(e) => return json_err(500, &e.to_string()),
    };
    if !state.resend_api_key.is_empty() {
        if let Err(e) = send_verification_email(
            &state.resend_api_key,
            &state.from_email,
            req.email.trim(),
            &user.username,
            &state.app_url,
            &token,
        ).await {
            eprintln!("[Email] 重发失败: {}", e);
        }
    } else {
        println!("[Email] 重发链接: {}/verify-email?token={}", state.app_url, token);
    }
    axum::Json(serde_json::json!({ "message": "验证邮件已重新发送" })).into_response()
}

async fn handle_verify_email(
    State(state): State<AppState>,
    Query(q): Query<VerifyEmailQuery>,
) -> impl IntoResponse {
    let pool = &state.pool;
    match db::consume_verification_token(pool, &q.token).await {
        Ok(Some(user)) => {
            if user.banned {
                return json_err(403, "账户已被封禁").into_response();
            }
            let token = auth::create_token(&user.id.to_string(), &user.username, &state.jwt_secret);
            axum::Json(AuthResponse { token, username: user.username, user_id: user.id.to_string() }).into_response()
        }
        Ok(None) => json_err(400, "验证链接无效或已过期"),
        Err(e)   => json_err(500, &e.to_string()),
    }
}

async fn handle_me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    match db::get_user_profile(pool, user_id).await {
        Ok(Some(p)) => axum::Json(serde_json::json!({
            "id":          p.id.to_string(),
            "username":    p.username,
            "email":       p.email,
            "tank_count":  p.tank_count,
            "created_at":  p.created_at,
            "credits":     p.credits,
        })).into_response(),
        Ok(None)    => json_err(404, "用户不存在"),
        Err(e)      => json_err(500, &e.to_string()),
    }
}

#[derive(Deserialize)]
struct UpdateMeReq {
    username: String,
}

async fn handle_update_me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(req): Json<UpdateMeReq>,
) -> impl IntoResponse {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    let username = req.username.trim().to_string();
    if username.len() < 2 || username.len() > 20 {
        return json_err(400, "用户名长度需在 2~20 字符之间");
    }
    if !username.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return json_err(400, "用户名只能包含字母、数字、下划线和连字符");
    }
    match db::update_username(pool, user_id, &username).await {
        Ok(true)  => axum::Json(serde_json::json!({ "username": username })).into_response(),
        Ok(false) => json_err(404, "用户不存在"),
        Err(e) if e.to_string().contains("duplicate") || e.to_string().contains("unique") => {
            json_err(409, "用户名已被占用")
        }
        Err(e)    => json_err(500, &e.to_string()),
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/register",     post(handle_register))
        .route("/api/login",        post(handle_login))
        .route("/api/verify-email",        get(handle_verify_email))
        .route("/api/resend-verification", post(handle_resend_verification))
        .route("/api/me",           get(handle_me).patch(handle_update_me))
        .route("/api/keys",         get(list_keys).post(create_key))
        .route("/api/keys/:id",     axum::routing::delete(delete_key))
}
