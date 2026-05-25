/// HTTP API 服务器（Axum）

mod routes;

use axum::{
    http::{HeaderValue, Method},
    Router,
};
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use crate::{auth, battle::ArenaEngine, db};

pub(crate) const RUSHER_JS:  &str = include_str!("../../agents/rusher.js");
pub(crate) const CIRCLER_JS: &str = include_str!("../../agents/circler.js");
pub(crate) const SNIPER_JS:  &str = include_str!("../../agents/sniper.js");
pub(crate) const CAMPER_JS:  &str = include_str!("../../agents/camper.js");

// ── 应用状态 ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) pool:       PgPool,
    pub(crate) jwt_secret: String,
}

// ── Bot 元数据 ────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub(crate) struct BotInfo {
    pub(crate) name:        &'static str,
    pub(crate) label:       &'static str,
    pub(crate) description: &'static str,
    pub(crate) difficulty:  &'static str,
}

pub(crate) const BOTS: &[BotInfo] = &[
    BotInfo { name: "rusher",  label: "冲锋者", description: "全速冲向敌人，激进近战，不顾防御",         difficulty: "中等" },
    BotInfo { name: "circler", label: "侧翼手", description: "交替从左右夹击，利用射击冷却空档冲刺",     difficulty: "中等" },
    BotInfo { name: "sniper",  label: "狙击手", description: "冲刺射击后立刻侧移撤退，打完就跑",         difficulty: "较难" },
    BotInfo { name: "camper",  label: "守门员", description: "蜗居角落等待时机，炮塔精准瞄准后点射",     difficulty: "简单" },
];

// ── 共享辅助 ─────────────────────────────────────────────────────────────────

pub(crate) fn json_err(status: u16, msg: &str) -> axum::response::Response {
    axum::response::Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(format!("{{\"error\":\"{}\"}}", msg)))
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

pub(crate) fn period_since(period: Option<&str>) -> DateTime<Utc> {
    match period {
        Some("today") => Utc::now() - Duration::days(1),
        Some("week")  => Utc::now() - Duration::days(7),
        // PostgreSQL TIMESTAMPTZ 下限是 4713 BC，DateTime::MIN_UTC 超界会被 sqlx 拒绝；
        // 用 Unix 纪元当作"全部历史"的下界足以覆盖所有真实数据。
        _             => DateTime::<Utc>::from_timestamp(0, 0).unwrap_or_else(Utc::now),
    }
}

// ── 测试对战 ─────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub(crate) struct TestResult {
    pub(crate) opponent: String,
    pub(crate) winner:   String,
    pub(crate) ticks:    u32,
}

pub(crate) async fn run_test_battles(
    name: &str,
    code: &str,
) -> Result<Vec<TestResult>, axum::response::Response> {
    let test_bots: &[(&str, &str)] = &[
        ("rusher",  RUSHER_JS),
        ("circler", CIRCLER_JS),
        ("sniper",  SNIPER_JS),
    ];
    let mut results = Vec::new();
    for &(bot_name, bot_code) in test_bots {
        let (n, c, bn, bc) = (
            name.to_string(), code.to_string(),
            bot_name.to_string(), bot_code.to_string(),
        );
        let r = tokio::task::spawn_blocking(move || {
            let owned = vec![(n.as_str(), c.as_str()), (bn.as_str(), bc.as_str())];
            let engine = ArenaEngine::new(owned)?;
            Ok::<_, String>(engine.run())
        }).await;
        match r {
            Ok(Ok(battle)) => results.push(TestResult {
                opponent: bot_name.to_string(),
                winner:   battle.winner,
                ticks:    battle.total_ticks,
            }),
            Ok(Err(e)) => return Err(json_err(400, &format!("代码错误：{}", e))),
            Err(e)     => return Err(json_err(500, &e.to_string())),
        }
    }
    Ok(results)
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
    let dangerous = [
        "<script", "</script", "javascript:", "onerror=", "onload=",
        "<image", "<foreignobject", "<use", "xlink:href", "data:text/html",
        "<!entity", "<!doctype",
    ];
    !dangerous.iter().any(|p| lower.contains(p))
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

    let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| "chassis-secret".to_string());
    let state = AppState { pool, jwt_secret };

    let cors = CorsLayer::new()
        .allow_origin([
            "http://localhost:3000".parse::<HeaderValue>().unwrap(),
            "http://localhost:3001".parse::<HeaderValue>().unwrap(),
        ])
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any);

    let app = Router::new()
        .merge(routes::battle::router())
        .merge(routes::auth::router())
        .merge(routes::tank::router())
        .merge(routes::agent::router())
        .with_state(state)
        .layer(cors);

    let addr = format!("0.0.0.0:{}", port);
    println!("[API] 监听 http://{}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
