/// HTTP API 服务器（Axum）

mod routes;

use axum::{
    extract::State,
    http::Method,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::{auth, db};

// ── 应用状态 ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) pool:           PgPool,
    pub(crate) jwt_secret:     String,
    pub(crate) resend_api_key: String,
    pub(crate) app_url:        String,
    pub(crate) from_email:     String,
    pub(crate) battle_sem:     Arc<Semaphore>,
}

// ── 共享辅助 ─────────────────────────────────────────────────────────────────

pub(crate) fn json_err(status: u16, msg: &str) -> axum::response::Response {
    axum::response::Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(serde_json::json!({"error": msg}).to_string()))
        .unwrap()
}

pub(crate) fn extract_bearer_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

pub(crate) fn extract_user_id(headers: &axum::http::HeaderMap, jwt_secret: &str) -> Option<Uuid> {
    let token = extract_bearer_token(headers)?;
    let claims = auth::verify_token(token, jwt_secret)?;
    Uuid::parse_str(&claims.sub).ok()
}

/// 认证上下文：JWT 只有 user_id，API Key 还携带绑定的坦克名
pub(crate) enum AuthCtx {
    Jwt(Uuid),
    ApiKey { user_id: Uuid, agent_name: String },
}

pub(crate) async fn resolve_auth(
    headers: &axum::http::HeaderMap,
    pool: &PgPool,
    jwt_secret: &str,
) -> Option<AuthCtx> {
    if let Some(token) = extract_bearer_token(headers) {
        if let Some(claims) = auth::verify_token(token, jwt_secret) {
            if let Ok(id) = Uuid::parse_str(&claims.sub) {
                return Some(AuthCtx::Jwt(id));
            }
        }
        // JWT 验证失败时，尝试作为 API Key
        if let Ok(Some(a)) = db::find_user_by_api_key(pool, token).await {
            return Some(AuthCtx::ApiKey { user_id: a.user_id, agent_name: a.agent_name });
        }
    }
    if let Some(key) = headers.get("x-api-key").and_then(|v| v.to_str().ok()) {
        if let Ok(Some(a)) = db::find_user_by_api_key(pool, key).await {
            return Some(AuthCtx::ApiKey { user_id: a.user_id, agent_name: a.agent_name });
        }
    }
    None
}

pub(crate) async fn resolve_api_key(
    headers: &axum::http::HeaderMap,
    pool: &PgPool,
) -> Option<db::ApiKeyAuth> {
    let key = extract_bearer_token(headers)
        .or_else(|| headers.get("x-api-key").and_then(|v| v.to_str().ok()))?;
    db::find_user_by_api_key(pool, key).await.ok().flatten()
}

/// 提取并校验管理员身份，返回 user_id；非管理员或未登录则返回 None
pub(crate) async fn extract_admin_user_id(
    headers: &axum::http::HeaderMap,
    pool: &PgPool,
    jwt_secret: &str,
) -> Option<Uuid> {
    let user_id = extract_user_id(headers, jwt_secret)?;
    let user = db::get_user_profile(pool, user_id).await.ok()??;
    if !user.is_admin { return None; }
    Some(user_id)
}

pub(crate) fn period_since(period: Option<&str>) -> DateTime<Utc> {
    match period {
        Some("today") => Utc::now() - Duration::days(1),
        Some("week")  => Utc::now() - Duration::days(7),
        // PostgreSQL TIMESTAMPTZ 下限是 4713 BC，DateTime::MIN_UTC 超界会被 sqlx 拒绝；
        // 用 Unix 纪元当作"全部历史"的下界足以覆盖所有真实数据。
        _             => DateTime::<Utc>::from_timestamp(0, 0).unwrap_or_else(Utc::now),
    }
}

// ── SVG 安全校验 ──────────────────────────────────────────────────────────────

pub(crate) const TANK_SVG_SYSTEM_PROMPT: &str = r#"你是一名专业的 SVG 坦克设计师。根据用户的描述，设计一辆坦克的俯视图 SVG。

规则：
- 坐标系：以 (0,0) 为坦克中心，坦克默认朝向 +X 轴（即向右）
- 画布范围：x ∈ [-20, 20]，y ∈ [-14, 14]（单位：任意）
- 只能使用以下 SVG 元素：rect, circle, ellipse, path, polygon, polyline, line, g
- 不得使用：script, image, foreignObject, use, style, animate 及任何外部引用
- 颜色用 fill 和 stroke 属性直接指定（十六进制颜色值）
- 输出纯 SVG 内部元素，不包含 <svg> 标签本身
- 设计要有层次感：履带（车体两侧）、装甲（主体）、炮塔（圆形底座+炮管朝右）
- 炮管从 (0,0) 延伸到约 (18, 0) 方向

输出格式必须是合法 JSON，只输出 JSON，不要有其他文字：
{"svg": "<rect .../>..."}"#;

pub(crate) fn validate_svg(svg: &str) -> bool {
    let lower = svg.to_lowercase();
    // 拒绝任何事件属性（on*=）、javascript:、外部引用、危险标签
    let blocked = [
        "javascript:", "data:", "xlink:href", "href=", " on",
        "<script", "<use", "<image", "<foreignobject", "<iframe",
        "<embed", "<object", "<set", "<animate", "<!entity", "<!doctype",
        "expression(", "url(",
    ];
    if blocked.iter().any(|p| lower.contains(p)) {
        return false;
    }
    // 只允许纯绘图标签
    let allowed_tags = [
        "rect", "circle", "ellipse", "line", "polyline", "polygon",
        "path", "g", "defs", "lineargradient", "radialgradient", "stop",
        "clippath", "mask", "text", "tspan", "title",
    ];
    // 提取所有 <tagname 或 </tagname，验证每个都在白名单里
    let mut i = 0;
    let bytes = lower.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'<' {
            i += 1;
            // 跳过结束斜杠
            if i < bytes.len() && bytes[i] == b'/' { i += 1; }
            // 跳过注释 <!--
            if lower[i.saturating_sub(1)..].starts_with("!--") {
                i += 3;
                continue;
            }
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b':') {
                i += 1;
            }
            let tag = &lower[start..i];
            if tag.is_empty() { continue; }
            if !allowed_tags.contains(&tag) {
                return false;
            }
        } else {
            i += 1;
        }
    }
    true
}

// ── 邮件发送（Resend）────────────────────────────────────────────────────────

pub(crate) async fn send_verification_email(
    resend_api_key: &str,
    from_email: &str,
    to_email: &str,
    username: &str,
    app_url: &str,
    token: &str,
) -> Result<(), String> {
    let verify_url = format!("{}/verify-email?token={}", app_url, token);
    let html = format!(r#"
<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#08080f;font-family:'Segoe UI',system-ui,sans-serif">
  <div style="max-width:520px;margin:40px auto;padding:0 16px">

    <!-- 外框 -->
    <div style="border:3px solid #7B2FFF;border-radius:20px;overflow:hidden;box-shadow:6px 6px 0 #00F5D4,12px 12px 0 #FF3AF2">

      <!-- 顶部渐变条 -->
      <div style="height:4px;background:linear-gradient(90deg,#7B2FFF,#FF3AF2,#00F5D4,#FFE600)"></div>

      <!-- Header -->
      <div style="background:#0d0d1a;padding:32px 36px 24px;border-bottom:3px solid #00F5D4">
        <div style="display:inline-block;background:linear-gradient(135deg,rgba(0,245,212,0.15),rgba(123,47,255,0.15));border:3px solid #00F5D4;border-radius:50%;width:60px;height:60px;line-height:60px;text-align:center;font-size:28px;box-shadow:0 0 20px rgba(0,245,212,0.3)">✉️</div>
        <h1 style="font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:2px;margin:16px 0 6px;color:#fff;text-shadow:2px 2px 0 #00F5D4">验证邮箱</h1>
        <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0">完成验证，投入 AI 坦克战场</p>
      </div>

      <!-- Body -->
      <div style="background:rgba(45,27,78,0.6);padding:28px 36px">
        <p style="color:rgba(255,255,255,0.75);font-size:15px;margin:0 0 20px">
          你好 <strong style="color:#FFE600">{username}</strong>，欢迎加入 DeepTank！<br>
          点击下方按钮完成邮箱验证。
        </p>

        <!-- CTA 按钮 -->
        <div style="text-align:center;margin:24px 0">
          <a href="{verify_url}"
             style="display:inline-block;background:linear-gradient(135deg,#7B2FFF,#FF3AF2);color:#fff;font-weight:900;font-size:15px;text-transform:uppercase;letter-spacing:2px;padding:14px 36px;border-radius:100px;text-decoration:none;border:3px solid #FFE600;box-shadow:0 0 20px rgba(123,47,255,0.5),4px 4px 0 #FFE600">
            验证邮箱 →
          </a>
        </div>

        <!-- 链接备用 -->
        <div style="background:rgba(0,245,212,0.06);border:2px dashed rgba(0,245,212,0.3);border-radius:12px;padding:14px 18px;margin-top:20px">
          <p style="color:rgba(0,245,212,0.7);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 6px">按钮无效？复制链接到浏览器</p>
          <p style="color:rgba(255,255,255,0.5);font-size:11px;word-break:break-all;margin:0">{verify_url}</p>
        </div>

        <p style="color:rgba(255,255,255,0.25);font-size:11px;margin:20px 0 0;text-align:center">
          链接 24 小时内有效 · 若非本人操作，忽略即可
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#0d0d1a;padding:16px 36px;border-top:2px dashed rgba(123,47,255,0.4);text-align:center">
        <p style="color:rgba(255,255,255,0.2);font-size:11px;margin:0">© DeepTank · AI 坦克竞技场</p>
      </div>

    </div>
  </div>
</body>
</html>
"#, username = username, verify_url = verify_url);

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {}", resend_api_key))
        .json(&serde_json::json!({
            "from": from_email,
            "to":   [to_email],
            "subject": "验证你的 DeepTank 账户",
            "html": html,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        Ok(())
    } else {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        Err(format!("Resend {} {}", status, body))
    }
}

// ── 全局统计接口 ─────────────────────────────────────────────────────────────

async fn handle_stats(State(state): State<AppState>) -> axum::response::Response {
    match db::get_platform_stats(&state.pool).await {
        Ok(stats) => axum::Json(stats).into_response(),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

// ── TankBook 公开流 ──────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct TankbookPageQuery {
    #[serde(default)]
    page: i64,
}

async fn handle_list_tankbook(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<TankbookPageQuery>,
) -> axum::response::Response {
    let limit  = 20_i64;
    let offset = q.page.max(0) * limit;
    match db::list_tankbook_posts(&state.pool, limit, offset).await {
        Ok(posts) => axum::Json(posts).into_response(),
        Err(e)    => json_err(500, &e.to_string()),
    }
}

#[derive(serde::Deserialize)]
struct CreateTankbookPostRequest {
    body: String,
}

async fn handle_create_tankbook(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum::Json(req): axum::Json<CreateTankbookPostRequest>,
) -> axum::response::Response {
    let pool = &state.pool;
    let Some(user_id) = extract_user_id(&headers, &state.jwt_secret) else {
        return json_err(401, "未登录");
    };
    if req.body.trim().is_empty() { return json_err(400, "内容不能为空"); }
    if req.body.len() > 2000      { return json_err(400, "内容超过 2000 字符上限"); }

    // 查询用户名（用于 author_name）
    let author_name = match db::get_user_profile(pool, user_id).await {
        Ok(Some(p)) => p.username,
        _           => return json_err(500, "获取用户信息失败"),
    };

    match db::create_tankbook_post(
        pool, "post", user_id, &author_name,
        None, None, None, req.body.trim(), None,
    ).await {
        Ok(id) => axum::Json(serde_json::json!({ "ok": true, "id": id.to_string() })).into_response(),
        Err(e) => json_err(500, &e.to_string()),
    }
}

// ── 启动 ─────────────────────────────────────────────────────────────────────

pub async fn serve(port: u16) {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://chassis:chassis@localhost:5432/chassis".to_string());

    let pool = db::create_pool(&database_url).await.unwrap_or_else(|e| {
        eprintln!("[DB] 连接失败: {}（DATABASE_URL={}）", e, database_url);
        std::process::exit(1);
    });
    println!("[DB] 已连接 PostgreSQL");

    let jwt_secret     = std::env::var("JWT_SECRET").unwrap_or_else(|_| "chassis-secret".to_string());
    let resend_api_key = std::env::var("RESEND_API_KEY").unwrap_or_default();
    let app_url        = std::env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3000".to_string());
    let from_email     = std::env::var("FROM_EMAIL").unwrap_or_else(|_| "noreply@deeptank.xyz".to_string());
    let concurrency = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(8);
    let battle_sem  = Arc::new(Semaphore::new(concurrency));
    let state = AppState { pool, jwt_secret, resend_api_key, app_url, from_email, battle_sem };

    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        .route("/", get(|| async { Json(serde_json::json!({ "name": "DeepTank API", "status": "ok" })) }))
        // 全局统计（公开）
        .route("/api/stats",    get(handle_stats))
        // TankBook 公开流
        .route("/api/tankbook", get(handle_list_tankbook).post(handle_create_tankbook))
        .merge(routes::battle::router())
        .merge(routes::auth::router())
        .merge(routes::tank::router())
        .merge(routes::agent::router())
        .merge(routes::admin::router())
        .merge(routes::play::router())
        .with_state(state)
        .layer(cors);

    let addr = format!("0.0.0.0:{}", port);
    println!("[API] 监听 http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
