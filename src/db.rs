/// PostgreSQL 数据持久层

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::battle::BattleResult;

pub async fn create_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPool::connect(database_url).await?;
    init_schema(&pool).await?;
    Ok(pool)
}

async fn init_schema(pool: &PgPool) -> Result<(), sqlx::Error> {
    ensure_users_table(pool).await?;
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS battles (
            id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_name  TEXT        NOT NULL,
            agent_code  TEXT        NOT NULL,
            opponent    TEXT        NOT NULL,
            winner      TEXT        NOT NULL,
            total_ticks INT         NOT NULL,
            arena       JSONB       NOT NULL,
            telemetry   JSONB       NOT NULL,
            battle_log  JSONB       NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
    )
    .execute(pool)
    .await?;
    // 迁移：添加 js_stats 列（老库自动补列，新库 CREATE TABLE 已包含）
    sqlx::query(
        "ALTER TABLE battles ADD COLUMN IF NOT EXISTS js_stats JSONB"
    )
    .execute(pool)
    .await?;
    ensure_email_verification_tokens_table(pool).await?;
    ensure_agents_table(pool).await?;
    ensure_api_keys_table(pool).await?;
    ensure_tankbook_posts_table(pool).await?;
    Ok(())
}

pub async fn save_battle(
    pool: &PgPool,
    agent_name: &str,
    agent_code: &str,
    opponent: &str,
    result: &BattleResult,
    user_id: Option<uuid::Uuid>,
) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::new_v4();
    let arena_json      = serde_json::to_value(&result.arena).unwrap_or_default();
    let telemetry_json  = serde_json::to_value(&result.telemetry).unwrap_or_default();
    let battle_log_json = serde_json::to_value(&result.battle_log).unwrap_or_default();
    let js_stats_json   = serde_json::to_value(&result.js_stats).unwrap_or_default();

    // 写入 challenger_id，使得 get_battle 的 LEFT JOIN tank_skins 能正确关联皮肤
    sqlx::query(
        r#"INSERT INTO battles
           (id, agent_name, agent_code, opponent, winner, total_ticks, arena, telemetry, battle_log, js_stats, challenger_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
    )
    .bind(id)
    .bind(agent_name)
    .bind(agent_code)
    .bind(opponent)
    .bind(&result.winner)
    .bind(result.total_ticks as i32)
    .bind(arena_json)
    .bind(telemetry_json)
    .bind(battle_log_json)
    .bind(js_stats_json)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(id)
}

#[derive(Debug, Serialize)]
pub struct BattleRecord {
    pub id: Uuid,
    pub agent_name: String,
    pub opponent: String,
    pub winner: String,
    pub total_ticks: i32,
    pub arena: serde_json::Value,
    pub telemetry: serde_json::Value,
    pub battle_log: serde_json::Value,
    pub skins: serde_json::Value,
    pub js_stats: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

pub async fn get_battle(pool: &PgPool, id: Uuid) -> Result<Option<BattleRecord>, sqlx::Error> {
    use sqlx::Row;
    // 同时 JOIN tank_skins 拿到双方"当前"皮肤；如果坦克战斗后才生成皮肤，老回放也能立刻用上。
    // battles.skins 里若有历史快照则作为底子，再用当前皮肤覆盖（皮肤是装饰，最新版更有展示性）。
    let row = sqlx::query(
        r#"SELECT
            b.id, b.agent_name, b.opponent, b.winner, b.total_ticks,
            b.arena, b.telemetry, b.battle_log, b.skins, b.js_stats, b.created_at,
            ts_c.skin AS challenger_skin,
            ts_o.skin AS opponent_skin
        FROM battles b
        LEFT JOIN tank_skins ts_c
          ON ts_c.user_id = b.challenger_id AND ts_c.agent_name = b.agent_name
        LEFT JOIN tank_skins ts_o
          ON ts_o.user_id = b.opponent_id   AND ts_o.agent_name = b.opponent
        WHERE b.id = $1"#
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| {
        let agent_name: String = r.get("agent_name");
        let opponent:   String = r.get("opponent");
        let mut skins:  serde_json::Value = r.get("skins");
        let c_skin: Option<serde_json::Value> = r.get("challenger_skin");
        let o_skin: Option<serde_json::Value> = r.get("opponent_skin");
        if !skins.is_object() { skins = serde_json::json!({}); }
        if let Some(map) = skins.as_object_mut() {
            if let Some(v) = c_skin { map.insert(agent_name.clone(), v); }
            if let Some(v) = o_skin { map.insert(opponent.clone(),   v); }
        }
        BattleRecord {
            id:          r.get("id"),
            agent_name,
            opponent,
            winner:      r.get("winner"),
            total_ticks: r.get("total_ticks"),
            arena:       r.get("arena"),
            telemetry:   r.get("telemetry"),
            battle_log:  r.get("battle_log"),
            skins,
            js_stats:    r.try_get("js_stats").unwrap_or(serde_json::Value::Null),
            created_at:  r.get("created_at"),
        }
    }))
}

#[derive(Debug, Serialize)]
pub struct LeaderboardEntry {
    pub agent_name: String,
    pub total_battles: i64,
    pub wins: i64,
    pub losses: i64,
    pub win_rate: f64,
    pub last_battle: DateTime<Utc>,
}

// ── 用户 ─────────────────────────────────────────────────────────────────────

pub async fn ensure_users_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS users (
            id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            username      TEXT        NOT NULL UNIQUE,
            email         TEXT        NOT NULL UNIQUE,
            password_hash TEXT        NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE"
    )
    .execute(pool)
    .await?;
    // 管理员权限与封禁状态列（迁移：老库自动补列）
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false"
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false"
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn ensure_email_verification_tokens_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS email_verification_tokens (
            token      TEXT        PRIMARY KEY,
            user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TIMESTAMPTZ NOT NULL
        )"#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub struct NewUser<'a> {
    pub username: &'a str,
    pub email: &'a str,
    pub password_hash: &'a str,
}

#[derive(Debug)]
pub struct UserRow {
    pub id: Uuid,
    pub username: String,
    pub password_hash: String,
    pub email_verified: bool,
    pub is_admin: bool,
    pub banned: bool,
}

/// 返回 None 表示用户名或邮箱已存在
pub async fn create_user(pool: &PgPool, user: NewUser<'_>) -> Result<Option<UserRow>, sqlx::Error> {
    let row = sqlx::query(
        r#"INSERT INTO users (username, email, password_hash)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING
           RETURNING id, username, password_hash, email_verified, is_admin, banned"#,
    )
    .bind(user.username)
    .bind(user.email)
    .bind(user.password_hash)
    .fetch_optional(pool)
    .await?;

    use sqlx::Row;
    Ok(row.map(|r| UserRow {
        id: r.get("id"),
        username: r.get("username"),
        password_hash: r.get("password_hash"),
        email_verified: r.get("email_verified"),
        is_admin: r.get("is_admin"),
        banned: r.get("banned"),
    }))
}

pub struct UserProfile {
    pub id:         Uuid,
    pub username:   String,
    pub email:      String,
    pub tank_count: i64,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub is_admin:   bool,
    pub banned:     bool,
}

pub async fn get_user_profile(pool: &PgPool, user_id: Uuid) -> Result<Option<UserProfile>, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query(r#"
        SELECT u.id, u.username, u.email, u.created_at, u.is_admin, u.banned,
               COUNT(DISTINCT a.name) AS tank_count
        FROM users u
        LEFT JOIN agents a ON a.user_id = u.id
        WHERE u.id = $1
        GROUP BY u.id, u.username, u.email, u.created_at, u.is_admin, u.banned
    "#)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| UserProfile {
        id:          r.get("id"),
        username:    r.get("username"),
        email:       r.get("email"),
        tank_count:  r.get("tank_count"),
        created_at:  r.get("created_at"),
        is_admin:    r.get("is_admin"),
        banned:      r.get("banned"),
    }))
}

pub async fn find_user_by_email(pool: &PgPool, email: &str) -> Result<Option<UserRow>, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT id, username, password_hash, email_verified, is_admin, banned FROM users WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| UserRow {
        id: r.get("id"),
        username: r.get("username"),
        password_hash: r.get("password_hash"),
        email_verified: r.get("email_verified"),
        is_admin: r.get("is_admin"),
        banned: r.get("banned"),
    }))
}

pub async fn get_leaderboard(pool: &PgPool) -> Result<Vec<LeaderboardEntry>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT
               agent_name,
               COUNT(*)                                                AS total_battles,
               COUNT(*) FILTER (WHERE winner = agent_name)            AS wins,
               COUNT(*) FILTER (WHERE winner != agent_name)           AS losses,
               MAX(created_at)                                         AS last_battle
           FROM battles
           WHERE challenger_id IS NOT NULL
           GROUP BY agent_name
           ORDER BY wins DESC, total_battles DESC
           LIMIT 50"#,
    )
    .fetch_all(pool)
    .await?;

    use sqlx::Row;
    Ok(rows
        .iter()
        .map(|row| {
            let total: i64 = row.get("total_battles");
            let wins: i64 = row.get("wins");
            let losses: i64 = row.get("losses");
            LeaderboardEntry {
                agent_name: row.get("agent_name"),
                total_battles: total,
                wins,
                losses,
                win_rate: if total > 0 { wins as f64 / total as f64 } else { 0.0 },
                last_battle: row.get("last_battle"),
            }
        })
        .collect())
}

// ── Agent 提交 ───────────────────────────────────────────────────────────────

pub async fn ensure_api_keys_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS api_keys (
            id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key        TEXT        NOT NULL UNIQUE,
            name       TEXT        NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    "#).execute(pool).await?;
    // name 列 = 绑定的坦克名，每个用户每个坦克名只允许一个密钥
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS api_keys_user_tank ON api_keys (user_id, name)"
    ).execute(pool).await?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ApiKeyEntry {
    pub id: String,
    pub agent_name: String,
    pub key: String,
    pub created_at: DateTime<Utc>,
}

/// 为指定坦克名生成（或轮换）密钥
pub async fn create_api_key(pool: &PgPool, user_id: Uuid, agent_name: &str) -> Result<ApiKeyEntry, sqlx::Error> {
    use sqlx::Row;
    let key = format!("csk_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
    let row = sqlx::query(r#"
        INSERT INTO api_keys (user_id, key, name) VALUES ($1, $2, $3)
        ON CONFLICT (user_id, name) DO UPDATE SET key = EXCLUDED.key, created_at = NOW()
        RETURNING id::text, key, name AS agent_name, created_at
    "#)
    .bind(user_id).bind(&key).bind(agent_name)
    .fetch_one(pool).await?;
    Ok(ApiKeyEntry {
        id: row.get("id"),
        agent_name: row.get("agent_name"),
        key: row.get("key"),
        created_at: row.get("created_at"),
    })
}

pub async fn list_api_keys(pool: &PgPool, user_id: Uuid) -> Result<Vec<ApiKeyEntry>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(
        "SELECT id::text, name AS agent_name, key, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC"
    )
    .bind(user_id).fetch_all(pool).await?;
    Ok(rows.iter().map(|r| ApiKeyEntry {
        id: r.get("id"),
        agent_name: r.get("agent_name"),
        key: r.get("key"),
        created_at: r.get("created_at"),
    }).collect())
}

pub struct ApiKeyAuth {
    pub user_id: Uuid,
    pub agent_name: String,
}

pub async fn find_user_by_api_key(pool: &PgPool, key: &str) -> Result<Option<ApiKeyAuth>, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT u.id, k.name AS agent_name FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key = $1"
    )
    .bind(key).fetch_optional(pool).await?;
    Ok(row.map(|r| ApiKeyAuth {
        user_id: r.get("id"),
        agent_name: r.get("agent_name"),
    }))
}

pub async fn delete_api_key(pool: &PgPool, key_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "DELETE FROM api_keys WHERE id = $1 AND user_id = $2"
    )
    .bind(key_id).bind(user_id)
    .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

// ── 我的坦克列表 ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct UserTankEntry {
    pub agent_id: String,
    pub agent_name: String,
    pub created_at: DateTime<Utc>,
    pub key_id: Option<String>,
    pub api_key: Option<String>,
    pub pvp_battles: i64,
    pub pvp_wins: i64,
    pub pvp_losses: i64,
    pub elo: f64,
    pub skin: TankSkin,
    pub version: i64,
}

/// 每个坦克名取最新提交，附带绑定的密钥、PvP 聚合（战绩 + Elo）与皮肤
pub async fn get_user_tanks(pool: &PgPool, user_id: Uuid) -> Result<Vec<UserTankEntry>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(r#"
        SELECT sub.agent_id, sub.agent_name, sub.created_at,
               k.id::text AS key_id, k.key AS api_key,
               COUNT(b.id)                                    AS pvp_battles,
               COUNT(b.id) FILTER (WHERE b.winner = sub.agent_name)  AS pvp_wins,
               COUNT(b.id) FILTER (WHERE b.winner != sub.agent_name) AS pvp_losses,
               COALESCE(er.elo, 1000.0)                       AS elo,
               COALESCE(ts.skin, '{}'::jsonb)                 AS skin,
               sub.version                                    AS version
        FROM (
            SELECT DISTINCT ON (name)
                id::text AS agent_id, name AS agent_name, created_at, user_id,
                (SELECT COUNT(*) FROM agents a2 WHERE a2.user_id = $1 AND a2.name = agents.name) AS version
            FROM agents
            WHERE user_id = $1
            ORDER BY name, created_at DESC
        ) sub
        LEFT JOIN api_keys k ON k.user_id = sub.user_id AND k.name = sub.agent_name
        LEFT JOIN battles b ON b.challenger_id IS NOT NULL AND (
            (b.challenger_id = sub.user_id AND b.agent_name = sub.agent_name)
            OR
            (b.opponent_id  = sub.user_id AND b.opponent   = sub.agent_name)
        )
        LEFT JOIN elo_ratings er ON er.user_id = sub.user_id AND er.agent_name = sub.agent_name
        LEFT JOIN tank_skins  ts ON ts.user_id = sub.user_id AND ts.agent_name = sub.agent_name
        GROUP BY sub.agent_id, sub.agent_name, sub.created_at, k.id, k.key, er.elo, ts.skin, sub.version
        ORDER BY sub.created_at DESC
    "#).bind(user_id).fetch_all(pool).await?;
    Ok(rows.iter().map(|r| {
        let skin_json: serde_json::Value = r.get("skin");
        let skin: TankSkin = serde_json::from_value(skin_json).unwrap_or_default();
        UserTankEntry {
            agent_id:    r.get("agent_id"),
            agent_name:  r.get("agent_name"),
            created_at:  r.get("created_at"),
            key_id:      r.get("key_id"),
            api_key:     r.get("api_key"),
            pvp_battles: r.get("pvp_battles"),
            pvp_wins:    r.get("pvp_wins"),
            pvp_losses:  r.get("pvp_losses"),
            elo:         r.get("elo"),
            skin,
            version:     r.get("version"),
        }
    }).collect())
}

// ── 坦克详情 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct TankBattleRecord {
    pub id: String,
    pub challenger: String,
    pub opponent: String,
    pub winner: String,
    pub total_ticks: i32,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct TankDetail {
    pub agent_id: String,
    pub agent_name: String,
    pub owner: String,
    pub code: String,
    pub created_at: DateTime<Utc>,
    pub elo: f64,
    pub pvp_wins: i64,
    pub pvp_losses: i64,
    pub pvp_battles: i64,
    pub battles: Vec<TankBattleRecord>,
}

/// 删除当前用户的坦克：清理同名的全部 agents 版本、皮肤、Elo、绑定密钥。
/// battles 历史记录保留（winner / opponent 是名字字符串，删了会破坏对方战绩）。
/// 返回 None=坦克不存在；Some(false)=非当前用户拥有；Some(true)=已删除。
pub async fn delete_tank(pool: &PgPool, agent_id: Uuid, user_id: Uuid) -> Result<Option<bool>, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query("SELECT user_id, name FROM agents WHERE id = $1 LIMIT 1")
        .bind(agent_id)
        .fetch_optional(pool).await?;
    let Some(r) = row else { return Ok(None); };
    let owner: Uuid = r.get("user_id");
    let name: String = r.get("name");
    if owner != user_id { return Ok(Some(false)); }

    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM api_keys   WHERE user_id = $1 AND name       = $2")
        .bind(user_id).bind(&name).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM tank_skins WHERE user_id = $1 AND agent_name = $2")
        .bind(user_id).bind(&name).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM elo_ratings WHERE user_id = $1 AND agent_name = $2")
        .bind(user_id).bind(&name).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM agents     WHERE user_id = $1 AND name       = $2")
        .bind(user_id).bind(&name).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Some(true))
}

pub async fn get_tank_detail(pool: &PgPool, agent_id: Uuid) -> Result<Option<TankDetail>, sqlx::Error> {
    use sqlx::Row;

    let Some(a) = sqlx::query(
        "SELECT a.id::text, a.name, a.code, a.created_at, a.user_id, u.username FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1"
    ).bind(agent_id).fetch_optional(pool).await? else { return Ok(None) };

    let user_id: Uuid = a.get("user_id");
    let agent_name: String = a.get("name");

    let battle_rows = sqlx::query(r#"
        SELECT b.id::text, b.agent_name AS challenger, b.opponent, b.winner, b.total_ticks, b.created_at
        FROM battles b
        WHERE b.challenger_id IS NOT NULL
          AND (
            (b.challenger_id = $1 AND b.agent_name = $2)
            OR (b.opponent_id = $1 AND b.opponent  = $2)
          )
        ORDER BY b.created_at DESC
        LIMIT 30
    "#).bind(user_id).bind(&agent_name).fetch_all(pool).await?;

    let battles: Vec<TankBattleRecord> = battle_rows.iter().map(|r| TankBattleRecord {
        id: r.get("id"),
        challenger: r.get("challenger"),
        opponent: r.get("opponent"),
        winner: r.get("winner"),
        total_ticks: r.get("total_ticks"),
        created_at: r.get("created_at"),
    }).collect();

    let pvp_wins   = battles.iter().filter(|b| b.winner == agent_name).count() as i64;
    let pvp_losses = battles.iter().filter(|b| b.winner != agent_name).count() as i64;

    let elo: f64 = sqlx::query(
        "SELECT elo FROM elo_ratings WHERE user_id = $1 AND agent_name = $2 LIMIT 1"
    ).bind(user_id).bind(&agent_name).fetch_optional(pool).await?
        .map(|r| r.get::<f64, _>("elo")).unwrap_or(1000.0);

    Ok(Some(TankDetail {
        agent_id: a.get("id"),
        agent_name,
        owner: a.get("username"),
        code: a.get("code"),
        created_at: a.get("created_at"),
        elo,
        pvp_wins,
        pvp_losses,
        pvp_battles: pvp_wins + pvp_losses,
        battles,
    }))
}

// ── 版本历史 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AgentVersion {
    pub version: i64,
    pub agent_id: String,
    pub code: String,
    pub submitted_by: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn get_tank_versions(pool: &PgPool, agent_id: Uuid) -> Result<Option<Vec<AgentVersion>>, sqlx::Error> {
    use sqlx::Row;
    // 先找该 agent 的 user_id 和 name
    let Some(row) = sqlx::query(
        "SELECT user_id, name FROM agents WHERE id = $1"
    ).bind(agent_id).fetch_optional(pool).await? else { return Ok(None) };

    let user_id: Uuid = row.get("user_id");
    let name: String = row.get("name");

    let rows = sqlx::query(r#"
        SELECT id::text AS agent_id, code, submitted_by, created_at,
               ROW_NUMBER() OVER (ORDER BY created_at ASC) AS version
        FROM agents
        WHERE user_id = $1 AND name = $2
        ORDER BY created_at DESC
    "#).bind(user_id).bind(&name).fetch_all(pool).await?;

    Ok(Some(rows.iter().map(|r| AgentVersion {
        version: r.get("version"),
        agent_id: r.get("agent_id"),
        code: r.get("code"),
        submitted_by: r.get("submitted_by"),
        created_at: r.get("created_at"),
    }).collect()))
}

pub async fn get_agent_version_number(pool: &PgPool, user_id: Uuid, name: &str, agent_id: Uuid) -> Result<i64, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query(r#"
        SELECT version FROM (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS version
            FROM agents WHERE user_id = $1 AND name = $2
        ) v WHERE id = $3
    "#)
    .bind(user_id).bind(name).bind(agent_id)
    .fetch_optional(pool).await?;
    Ok(row.map(|r| r.get::<i64, _>("version")).unwrap_or(1))
}

pub async fn ensure_agents_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    // 若旧表存在（user_id 为主键），先删掉重建
    sqlx::query(r#"
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_name='agents' AND constraint_type='PRIMARY KEY'
              AND constraint_name='agents_pkey'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='agents' AND column_name='id'
          ) THEN
            DROP TABLE agents CASCADE;
          END IF;
        END $$
    "#).execute(pool).await?;

    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS agents (
            id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID        NOT NULL REFERENCES users(id),
            name       TEXT        NOT NULL,
            code       TEXT        NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    "#).execute(pool).await?;

    sqlx::query("ALTER TABLE battles ADD COLUMN IF NOT EXISTS challenger_id UUID")
        .execute(pool).await?;
    sqlx::query("ALTER TABLE battles ADD COLUMN IF NOT EXISTS opponent_id UUID")
        .execute(pool).await?;
    sqlx::query("ALTER TABLE agents ADD COLUMN IF NOT EXISTS submitted_by TEXT")
        .execute(pool).await?;
    sqlx::query("ALTER TABLE battles ADD COLUMN IF NOT EXISTS skins JSONB NOT NULL DEFAULT '{}'")
        .execute(pool).await?;
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS tank_skins (
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            agent_name TEXT NOT NULL,
            skin       JSONB NOT NULL DEFAULT '{}',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, agent_name)
        )
    "#).execute(pool).await?;
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS elo_ratings (
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            agent_name TEXT NOT NULL,
            elo        DOUBLE PRECISION NOT NULL DEFAULT 1000,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, agent_name)
        )
    "#).execute(pool).await?;
    sqlx::query("ALTER TABLE elo_ratings ADD COLUMN IF NOT EXISTS rd         DOUBLE PRECISION NOT NULL DEFAULT 350")
        .execute(pool).await?;
    sqlx::query("ALTER TABLE elo_ratings ADD COLUMN IF NOT EXISTS volatility DOUBLE PRECISION NOT NULL DEFAULT 0.06")
        .execute(pool).await?;
    Ok(())
}

// ── 坦克皮肤 ─────────────────────────────────────────────────────────────────

pub use crate::battle::TankSkin;

pub async fn get_tank_skin(pool: &PgPool, user_id: Uuid, agent_name: &str) -> Result<Option<TankSkin>, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query(
        "SELECT skin FROM tank_skins WHERE user_id = $1 AND agent_name = $2"
    )
    .bind(user_id).bind(agent_name)
    .fetch_optional(pool).await?;
    Ok(row.map(|r| {
        let v: serde_json::Value = r.get("skin");
        serde_json::from_value(v).unwrap_or_default()
    }))
}

pub async fn set_tank_skin(pool: &PgPool, user_id: Uuid, agent_name: &str, skin: &TankSkin) -> Result<(), sqlx::Error> {
    let skin_json = serde_json::to_value(skin).unwrap_or_default();
    sqlx::query(r#"
        INSERT INTO tank_skins (user_id, agent_name, skin, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id, agent_name)
        DO UPDATE SET skin = EXCLUDED.skin, updated_at = NOW()
    "#)
    .bind(user_id).bind(agent_name).bind(skin_json)
    .execute(pool).await?;
    Ok(())
}

/// 按 agent_id 查该坦克的 owner user_id、坦克名和当前皮肤
pub async fn get_skin_by_agent_id(pool: &PgPool, agent_id: Uuid) -> Result<Option<(Uuid, String, TankSkin)>, sqlx::Error> {
    use sqlx::Row;
    let Some(row) = sqlx::query(
        "SELECT user_id, name FROM agents WHERE id = $1"
    ).bind(agent_id).fetch_optional(pool).await? else { return Ok(None) };
    let user_id: Uuid = row.get("user_id");
    let name: String = row.get("name");
    let skin = get_tank_skin(pool, user_id, &name).await?.unwrap_or_default();
    Ok(Some((user_id, name, skin)))
}

pub async fn create_agent(pool: &PgPool, user_id: Uuid, name: &str, code: &str, submitted_by: Option<&str>) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO agents (id, user_id, name, code, submitted_by) VALUES ($1, $2, $3, $4, $5)"
    )
    .bind(id).bind(user_id).bind(name).bind(code).bind(submitted_by)
    .execute(pool).await?;
    Ok(id)
}

pub struct AgentRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub code: String,
}

fn row_to_agent(r: &sqlx::postgres::PgRow) -> AgentRow {
    use sqlx::Row;
    AgentRow {
        id: r.get("id"),
        user_id: r.get("user_id"),
        name: r.get("name"),
        code: r.get("code"),
    }
}

pub async fn get_latest_agent_by_name(pool: &PgPool, user_id: Uuid, name: &str) -> Result<Option<AgentRow>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, user_id, name, code FROM agents WHERE user_id = $1 AND name = $2 ORDER BY created_at DESC LIMIT 1"
    )
    .bind(user_id).bind(name)
    .fetch_optional(pool).await?;
    Ok(row.as_ref().map(row_to_agent))
}

pub async fn get_latest_agent_by_user_id(pool: &PgPool, user_id: Uuid) -> Result<Option<AgentRow>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT a.id, a.user_id, a.name, a.code FROM agents a WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 1"
    )
    .bind(user_id)
    .fetch_optional(pool).await?;
    Ok(row.as_ref().map(row_to_agent))
}

pub async fn get_agent_by_id(pool: &PgPool, agent_id: Uuid) -> Result<Option<AgentRow>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT a.id, a.user_id, a.name, a.code FROM agents a WHERE a.id = $1"
    )
    .bind(agent_id)
    .fetch_optional(pool).await?;
    Ok(row.as_ref().map(row_to_agent))
}

// 按 ELO 距离最近匹配对手（每个用户取最新提交的 agent）
pub async fn get_random_opponent(pool: &PgPool, exclude_user_id: Uuid, agent_name: &str) -> Result<Option<AgentRow>, sqlx::Error> {
    let row = sqlx::query(r#"
        SELECT id, user_id, name, code FROM (
            SELECT DISTINCT ON (a.user_id) a.id, a.user_id, a.name, a.code
            FROM agents a
            WHERE a.user_id != $1
            ORDER BY a.user_id, a.created_at DESC
        ) latest
        ORDER BY ABS(
            COALESCE((SELECT elo FROM elo_ratings WHERE user_id = latest.user_id AND agent_name = latest.name), 1000.0)
            - COALESCE((SELECT elo FROM elo_ratings WHERE user_id = $1   AND agent_name = $2),                  1000.0)
        ), RANDOM()
        LIMIT 1
    "#)
    .bind(exclude_user_id)
    .bind(agent_name)
    .fetch_optional(pool).await?;
    Ok(row.as_ref().map(row_to_agent))
}

#[derive(Debug, Serialize)]
pub struct PlayerEntry {
    pub agent_id: String,
    pub agent_name: String,
    pub owner: String,
    pub pvp_battles: i64,
    pub pvp_wins: i64,
    pub pvp_losses: i64,
    pub elo: f64,
    pub version: i64,
}

pub async fn list_players(pool: &PgPool, since: DateTime<Utc>) -> Result<Vec<PlayerEntry>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(r#"
        SELECT
            la.id::text                                         AS agent_id,
            la.name                                             AS agent_name,
            u.username                                          AS owner,
            COUNT(b.id)                                         AS pvp_battles,
            COUNT(b.id) FILTER (WHERE b.winner = la.name)      AS pvp_wins,
            COUNT(b.id) FILTER (WHERE b.winner != la.name)     AS pvp_losses,
            COALESCE(er.elo, 1000.0)                            AS elo,
            la.version                                          AS version
        FROM (
            SELECT DISTINCT ON (user_id, name) id, user_id, name,
                (SELECT COUNT(*) FROM agents a2 WHERE a2.user_id = agents.user_id AND a2.name = agents.name) AS version
            FROM agents
            ORDER BY user_id, name, created_at DESC
        ) la
        JOIN users u ON u.id = la.user_id
        LEFT JOIN battles b ON b.challenger_id IS NOT NULL
          AND b.created_at >= $1
          AND (
            (b.challenger_id = la.user_id AND b.agent_name = la.name)
            OR
            (b.opponent_id  = la.user_id AND b.opponent   = la.name)
          )
        LEFT JOIN elo_ratings er ON er.user_id = la.user_id AND er.agent_name = la.name
        GROUP BY la.id, la.name, u.username, er.elo, la.version
        ORDER BY elo DESC, pvp_wins DESC, pvp_battles DESC
    "#).bind(since).fetch_all(pool).await?;
    Ok(rows.iter().map(|r| PlayerEntry {
        agent_id:    r.get("agent_id"),
        agent_name:  r.get("agent_name"),
        owner:       r.get("owner"),
        pvp_battles: r.get("pvp_battles"),
        pvp_wins:    r.get("pvp_wins"),
        pvp_losses:  r.get("pvp_losses"),
        elo:         r.get("elo"),
        version:     r.get("version"),
    }).collect())
}

pub async fn get_recent_matches(
    pool: &PgPool,
    user_id: Uuid,
    agent_name: &str,
    limit: i64,
    offset: i64,
) -> Result<Vec<TankBattleRecord>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(r#"
        SELECT b.id::text, b.agent_name AS challenger, b.opponent, b.winner, b.total_ticks, b.created_at
        FROM battles b
        WHERE b.challenger_id IS NOT NULL
          AND (
            (b.challenger_id = $1 AND b.agent_name = $2)
            OR (b.opponent_id = $1 AND b.opponent  = $2)
          )
        ORDER BY b.created_at DESC
        LIMIT $3 OFFSET $4
    "#)
    .bind(user_id).bind(agent_name).bind(limit).bind(offset)
    .fetch_all(pool).await?;
    Ok(rows.iter().map(|r| TankBattleRecord {
        id: r.get("id"),
        challenger: r.get("challenger"),
        opponent: r.get("opponent"),
        winner: r.get("winner"),
        total_ticks: r.get("total_ticks"),
        created_at: r.get("created_at"),
    }).collect())
}

pub async fn search_opponents(
    pool: &PgPool,
    q: Option<&str>,
    limit: i64,
) -> Result<Vec<PlayerEntry>, sqlx::Error> {
    use sqlx::Row;
    let pattern = q.map(|s| format!("%{}%", s.to_lowercase()));
    let rows = sqlx::query(r#"
        SELECT la.id::text AS agent_id, la.name AS agent_name, u.username AS owner,
               COUNT(b.id) AS pvp_battles,
               COUNT(b.id) FILTER (WHERE b.winner = la.name) AS pvp_wins,
               COUNT(b.id) FILTER (WHERE b.winner != la.name) AS pvp_losses,
               COALESCE(er.elo, 1000.0) AS elo,
               la.version AS version
        FROM (
            SELECT DISTINCT ON (user_id, name) id, user_id, name,
                (SELECT COUNT(*) FROM agents a2 WHERE a2.user_id = agents.user_id AND a2.name = agents.name) AS version
            FROM agents ORDER BY user_id, name, created_at DESC
        ) la
        JOIN users u ON u.id = la.user_id
        LEFT JOIN battles b ON b.challenger_id IS NOT NULL AND (
            (b.challenger_id = la.user_id AND b.agent_name = la.name)
            OR (b.opponent_id = la.user_id AND b.opponent = la.name))
        LEFT JOIN elo_ratings er ON er.user_id = la.user_id AND er.agent_name = la.name
        WHERE ($1::text IS NULL OR LOWER(la.name) LIKE $1 OR LOWER(u.username) LIKE $1)
        GROUP BY la.id, la.name, u.username, er.elo, la.version
        ORDER BY elo DESC LIMIT $2
    "#).bind(pattern).bind(limit).fetch_all(pool).await?;
    Ok(rows.iter().map(|r| PlayerEntry {
        agent_id:    r.get("agent_id"),
        agent_name:  r.get("agent_name"),
        owner:       r.get("owner"),
        pvp_battles: r.get("pvp_battles"),
        pvp_wins:    r.get("pvp_wins"),
        pvp_losses:  r.get("pvp_losses"),
        elo:         r.get("elo"),
        version:     r.get("version"),
    }).collect())
}

// ── Glicko-2 ─────────────────────────────────────────────────────────────────

const GLICKO_SCALE: f64 = 173.7178;
const GLICKO_BASE:  f64 = 1000.0;
const GLICKO_TAU:   f64 = 0.5;    // 系统波动约束，越小越稳
const GLICKO_EPS:   f64 = 1e-6;

struct Glicko2 { rating: f64, rd: f64, volatility: f64 }

impl Glicko2 {
    fn new_player() -> Self { Self { rating: GLICKO_BASE, rd: 350.0, volatility: 0.06 } }

    /// 单场对战后更新分数（score: 1=赢 0=输）
    fn update(&self, opp: &Glicko2, score: f64) -> Glicko2 {
        let mu    = (self.rating - GLICKO_BASE) / GLICKO_SCALE;
        let phi   = self.rd / GLICKO_SCALE;
        let mu_j  = (opp.rating - GLICKO_BASE) / GLICKO_SCALE;
        let phi_j = opp.rd / GLICKO_SCALE;

        let g  = 1.0 / (1.0 + 3.0 * phi_j * phi_j / (std::f64::consts::PI * std::f64::consts::PI)).sqrt();
        let e  = 1.0 / (1.0 + (-g * (mu - mu_j)).exp());
        let v  = 1.0 / (g * g * e * (1.0 - e));
        let delta = v * g * (score - e);

        // Illinois 算法求新波动率 σ'
        let a = self.volatility.ln();
        let f = |x: f64| -> f64 {
            let ex  = x.exp();
            let top = ex * (delta * delta - phi * phi - v - ex);
            let bot = 2.0 * (phi * phi + v + ex).powi(2);
            top / bot - (x - a) / (GLICKO_TAU * GLICKO_TAU)
        };
        let mut big_a = a;
        let mut big_b = if delta * delta > phi * phi + v {
            (delta * delta - phi * phi - v).ln()
        } else {
            let mut k = 1.0_f64;
            while f(a - k * GLICKO_TAU) < 0.0 { k += 1.0; }
            a - k * GLICKO_TAU
        };
        let (mut fa, mut fb) = (f(big_a), f(big_b));
        while (big_b - big_a).abs() > GLICKO_EPS {
            let big_c = big_a + (big_a - big_b) * fa / (fb - fa);
            let fc = f(big_c);
            if fc * fb <= 0.0 { big_a = big_b; fa = fb; } else { fa /= 2.0; }
            big_b = big_c; fb = fc;
        }
        let new_vol = big_a.exp(); // a = ln(σ)，故 σ' = e^A（非 e^(A/2)）

        let phi_star = (phi * phi + new_vol * new_vol).sqrt();
        let new_phi  = 1.0 / (1.0 / (phi_star * phi_star) + 1.0 / v).sqrt();
        let new_mu   = mu + new_phi * new_phi * g * (score - e);

        Glicko2 {
            rating:     (GLICKO_SCALE * new_mu + GLICKO_BASE).max(100.0),
            rd:         (GLICKO_SCALE * new_phi).clamp(30.0, 350.0),
            volatility: new_vol,
        }
    }
}

async fn upsert_elo(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: Uuid,
    agent_name: &str,
    g: &Glicko2,
) -> Result<(), sqlx::Error> {
    sqlx::query(r#"
        INSERT INTO elo_ratings (user_id, agent_name, elo, rd, volatility, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (user_id, agent_name) DO UPDATE
            SET elo = EXCLUDED.elo, rd = EXCLUDED.rd, volatility = EXCLUDED.volatility, updated_at = NOW()
    "#)
    .bind(user_id).bind(agent_name).bind(g.rating).bind(g.rd).bind(g.volatility)
    .execute(&mut **tx).await?;
    Ok(())
}

pub async fn save_pvp_battle(
    pool: &PgPool,
    challenger_id: Uuid,
    opponent_id: Uuid,
    challenger_name: &str,
    opponent_name: &str,
    result: &crate::battle::BattleResult,
) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::new_v4();
    let arena_json      = serde_json::to_value(&result.arena).unwrap_or_default();
    let telemetry_json  = serde_json::to_value(&result.telemetry).unwrap_or_default();
    let battle_log_json = serde_json::to_value(&result.battle_log).unwrap_or_default();
    let skins_json      = serde_json::to_value(&result.skins).unwrap_or_default();
    let js_stats_json   = serde_json::to_value(&result.js_stats).unwrap_or_default();

    // ── 使用事务保证 INSERT + 双方 Elo UPSERT 的原子性 ──────────────────────
    let mut tx = pool.begin().await?;

    sqlx::query(r#"
        INSERT INTO battles
        (id, agent_name, agent_code, opponent, winner, total_ticks, arena, telemetry, battle_log, skins, js_stats, challenger_id, opponent_id)
        VALUES ($1,$2,'',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    "#)
    .bind(id)
    .bind(challenger_name)
    .bind(opponent_name)
    .bind(&result.winner)
    .bind(result.total_ticks as i32)
    .bind(arena_json)
    .bind(telemetry_json)
    .bind(battle_log_json)
    .bind(skins_json)
    .bind(js_stats_json)
    .bind(challenger_id)
    .bind(opponent_id)
    .execute(&mut *tx).await?;

    // ── Glicko-2 更新 ─────────────────────────────────────────────────────────
    use sqlx::Row as _;
    let load_glicko = |row: Option<sqlx::postgres::PgRow>| -> Glicko2 {
        match row {
            Some(r) => Glicko2 {
                rating:     r.get("elo"),
                rd:         r.get("rd"),
                volatility: r.get("volatility"),
            },
            None => Glicko2::new_player(),
        }
    };

    // FOR UPDATE：锁定行，防止并发对战覆盖彼此的 Glicko 更新
    let ga = load_glicko(sqlx::query(
        "SELECT elo, rd, volatility FROM elo_ratings WHERE user_id = $1 AND agent_name = $2 FOR UPDATE"
    ).bind(challenger_id).bind(challenger_name).fetch_optional(&mut *tx).await?);

    let gb = load_glicko(sqlx::query(
        "SELECT elo, rd, volatility FROM elo_ratings WHERE user_id = $1 AND agent_name = $2 FOR UPDATE"
    ).bind(opponent_id).bind(opponent_name).fetch_optional(&mut *tx).await?);

    let (sa, sb) = if result.winner == challenger_name {
        (1.0_f64, 0.0_f64)
    } else if result.winner == opponent_name {
        (0.0_f64, 1.0_f64)
    } else {
        // 双方同帧互杀（"无"）：用 JS 执行效率决定胜负
        // 指标：错误次数优先，其次平均执行耗时（越低越好）
        let stat = |name: &str| result.js_stats.iter().find(|s| s.tank_name == name);
        let score_of = |name: &str| -> (u32, u64) {
            stat(name).map(|s| (s.error_count, s.avg_exec_us)).unwrap_or((u32::MAX, u64::MAX))
        };
        let ca = score_of(challenger_name);
        let cb = score_of(opponent_name);
        match ca.cmp(&cb) {
            std::cmp::Ordering::Less    => (1.0, 0.0), // 挑战方效率更好
            std::cmp::Ordering::Greater => (0.0, 1.0), // 对手效率更好
            std::cmp::Ordering::Equal   => (0.5, 0.5), // 完全一致才平局
        }
    };
    let new_ga = ga.update(&gb, sa);
    let new_gb = gb.update(&ga, sb);

    upsert_elo(&mut tx, challenger_id, challenger_name, &new_ga).await?;
    upsert_elo(&mut tx, opponent_id,   opponent_name,   &new_gb).await?;

    tx.commit().await?;

    Ok(id)
}

// ── TankBook 社交墙 ──────────────────────────────────────────────────────────

pub async fn ensure_tankbook_posts_table(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(r#"
        CREATE TABLE IF NOT EXISTS tankbook_posts (
            id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            post_type      TEXT        NOT NULL,
            author_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            author_name    TEXT        NOT NULL,
            match_id       UUID,
            target_tank_id UUID,
            parent_id      UUID        REFERENCES tankbook_posts(id) ON DELETE CASCADE,
            body           TEXT        NOT NULL,
            submitted_by   TEXT,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    "#).execute(pool).await?;
    Ok(())
}

/// 创建一条 TankBook 动态，返回新记录的 id
pub async fn create_tankbook_post(
    pool: &PgPool,
    post_type: &str,
    author_id: Uuid,
    author_name: &str,
    match_id: Option<Uuid>,
    target_tank_id: Option<Uuid>,
    parent_id: Option<Uuid>,
    body: &str,
    submitted_by: Option<&str>,
) -> Result<Uuid, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query(r#"
        INSERT INTO tankbook_posts
            (post_type, author_id, author_name, match_id, target_tank_id, parent_id, body, submitted_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
    "#)
    .bind(post_type)
    .bind(author_id)
    .bind(author_name)
    .bind(match_id)
    .bind(target_tank_id)
    .bind(parent_id)
    .bind(body)
    .bind(submitted_by)
    .fetch_one(pool).await?;
    Ok(row.get("id"))
}

// ── 全局平台统计 ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct PlatformStats {
    pub total_users:      i64,
    pub total_agents:     i64,
    pub total_battles:    i64,
    pub total_pvp_battles: i64,
    pub battles_today:    i64,
    pub top_players:      Vec<TopPlayer>,
    pub elo_distribution: EloDistribution,
}

#[derive(Debug, Serialize)]
pub struct TopPlayer {
    pub username:    String,
    pub elo:         f64,
    pub pvp_battles: i64,
}

#[derive(Debug, Serialize)]
pub struct EloDistribution {
    pub bronze:   i64,
    pub silver:   i64,
    pub gold:     i64,
    pub platinum: i64,
    pub diamond:  i64,
}

pub async fn get_platform_stats(pool: &PgPool) -> Result<PlatformStats, sqlx::Error> {
    use sqlx::Row;

    // 聚合基础计数
    let counts = sqlx::query(r#"
        SELECT
            (SELECT COUNT(*) FROM users)                                    AS total_users,
            (SELECT COUNT(DISTINCT name || user_id::text) FROM agents)      AS total_agents,
            (SELECT COUNT(*) FROM battles)                                  AS total_battles,
            (SELECT COUNT(*) FROM battles WHERE challenger_id IS NOT NULL AND opponent_id IS NOT NULL) AS total_pvp_battles,
            (SELECT COUNT(*) FROM battles WHERE created_at >= NOW() - INTERVAL '1 day') AS battles_today
    "#).fetch_one(pool).await?;

    let total_users:       i64 = counts.get("total_users");
    let total_agents:      i64 = counts.get("total_agents");
    let total_battles:     i64 = counts.get("total_battles");
    let total_pvp_battles: i64 = counts.get("total_pvp_battles");
    let battles_today:     i64 = counts.get("battles_today");

    // Top 5 玩家（按 Elo 最高）
    let top_rows = sqlx::query(r#"
        SELECT u.username, er.elo,
               COUNT(b.id) AS pvp_battles
        FROM elo_ratings er
        JOIN users u ON u.id = er.user_id
        LEFT JOIN battles b ON b.challenger_id IS NOT NULL
          AND ((b.challenger_id = er.user_id AND b.agent_name = er.agent_name)
            OR (b.opponent_id  = er.user_id AND b.opponent   = er.agent_name))
        GROUP BY u.username, er.elo
        ORDER BY er.elo DESC
        LIMIT 5
    "#).fetch_all(pool).await?;
    let top_players: Vec<TopPlayer> = top_rows.iter().map(|r| TopPlayer {
        username:    r.get("username"),
        elo:         r.get("elo"),
        pvp_battles: r.get("pvp_battles"),
    }).collect();

    // Elo 分布：bronze<1100, silver<1300, gold<1500, platinum<1800, diamond>=1800
    let dist_row = sqlx::query(r#"
        SELECT
            COUNT(*) FILTER (WHERE elo <  1100) AS bronze,
            COUNT(*) FILTER (WHERE elo >= 1100 AND elo < 1300) AS silver,
            COUNT(*) FILTER (WHERE elo >= 1300 AND elo < 1500) AS gold,
            COUNT(*) FILTER (WHERE elo >= 1500 AND elo < 1800) AS platinum,
            COUNT(*) FILTER (WHERE elo >= 1800) AS diamond
        FROM elo_ratings
    "#).fetch_one(pool).await?;
    let elo_distribution = EloDistribution {
        bronze:   dist_row.get("bronze"),
        silver:   dist_row.get("silver"),
        gold:     dist_row.get("gold"),
        platinum: dist_row.get("platinum"),
        diamond:  dist_row.get("diamond"),
    };

    Ok(PlatformStats {
        total_users,
        total_agents,
        total_battles,
        total_pvp_battles,
        battles_today,
        top_players,
        elo_distribution,
    })
}

// ── TankBook 公开流 ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct TankbookPostEntry {
    pub id:          String,
    pub post_type:   String,
    pub author_name: String,
    pub body:        String,
    pub match_id:    Option<String>,
    pub created_at:  DateTime<Utc>,
    /// 对战关联信息（winner, total_ticks, opponent）
    pub battle_winner:      Option<String>,
    pub battle_total_ticks: Option<i32>,
    pub battle_opponent:    Option<String>,
}

/// 列出最近帖子（含对战关联信息）
pub async fn list_tankbook_posts(pool: &PgPool, limit: i64, offset: i64) -> Result<Vec<TankbookPostEntry>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(r#"
        SELECT
            p.id::text, p.post_type, p.author_name, p.body,
            p.match_id::text AS match_id, p.created_at,
            b.winner AS battle_winner, b.total_ticks AS battle_total_ticks, b.opponent AS battle_opponent
        FROM tankbook_posts p
        LEFT JOIN battles b ON b.id = p.match_id
        ORDER BY p.created_at DESC
        LIMIT $1 OFFSET $2
    "#)
    .bind(limit).bind(offset)
    .fetch_all(pool).await?;
    Ok(rows.iter().map(|r| TankbookPostEntry {
        id:          r.get("id"),
        post_type:   r.get("post_type"),
        author_name: r.get("author_name"),
        body:        r.get("body"),
        match_id:    r.get("match_id"),
        created_at:  r.get("created_at"),
        battle_winner:      r.try_get("battle_winner").unwrap_or(None),
        battle_total_ticks: r.try_get("battle_total_ticks").unwrap_or(None),
        battle_opponent:    r.try_get("battle_opponent").unwrap_or(None),
    }).collect())
}

// ── Admin 管理接口 ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AdminUserEntry {
    pub id:          String,
    pub username:    String,
    pub email:       String,
    pub is_admin:    bool,
    pub banned:      bool,
    pub created_at:  DateTime<Utc>,
    pub agent_count: i64,
}

/// 列出所有用户（管理员用）
pub async fn admin_list_users(pool: &PgPool) -> Result<Vec<AdminUserEntry>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(r#"
        SELECT u.id::text, u.username, u.email, u.is_admin, u.banned, u.created_at,
               COUNT(DISTINCT a.name) AS agent_count
        FROM users u
        LEFT JOIN agents a ON a.user_id = u.id
        GROUP BY u.id, u.username, u.email, u.is_admin, u.banned, u.created_at
        ORDER BY u.created_at DESC
    "#).fetch_all(pool).await?;
    Ok(rows.iter().map(|r| AdminUserEntry {
        id:          r.get("id"),
        username:    r.get("username"),
        email:       r.get("email"),
        is_admin:    r.get("is_admin"),
        banned:      r.get("banned"),
        created_at:  r.get("created_at"),
        agent_count: r.get("agent_count"),
    }).collect())
}

/// 封禁 / 解封用户
pub async fn admin_set_banned(pool: &PgPool, user_id: Uuid, banned: bool) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE users SET banned = $1 WHERE id = $2")
        .bind(banned).bind(user_id)
        .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

#[derive(Debug, Serialize)]
pub struct AdminTankEntry {
    pub agent_id:       String,
    pub name:           String,
    pub owner_username: String,
    pub elo:            f64,
    pub pvp_battles:    i64,
    pub created_at:     DateTime<Utc>,
}

/// 列出最近 50 个 agent（管理员用）
pub async fn admin_list_tanks(pool: &PgPool) -> Result<Vec<AdminTankEntry>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(r#"
        SELECT sub.agent_id, sub.name, u.username AS owner_username,
               COALESCE(er.elo, 1000.0) AS elo,
               COUNT(b.id)              AS pvp_battles,
               sub.created_at
        FROM (
            SELECT DISTINCT ON (user_id, name) id::text AS agent_id, user_id, name, created_at
            FROM agents
            ORDER BY user_id, name, created_at DESC
        ) sub
        JOIN users u ON u.id = sub.user_id
        LEFT JOIN elo_ratings er ON er.user_id = sub.user_id AND er.agent_name = sub.name
        LEFT JOIN battles b ON b.challenger_id IS NOT NULL AND (
            (b.challenger_id = sub.user_id AND b.agent_name = sub.name)
            OR (b.opponent_id = sub.user_id AND b.opponent  = sub.name)
        )
        GROUP BY sub.agent_id, sub.name, u.username, er.elo, sub.created_at
        ORDER BY sub.created_at DESC
        LIMIT 50
    "#).fetch_all(pool).await?;
    Ok(rows.iter().map(|r| AdminTankEntry {
        agent_id:       r.get("agent_id"),
        name:           r.get("name"),
        owner_username: r.get("owner_username"),
        elo:            r.get("elo"),
        pvp_battles:    r.get("pvp_battles"),
        created_at:     r.get("created_at"),
    }).collect())
}

/// 管理员删除坦克（仅 agents 表，保留战斗记录）
pub async fn admin_delete_tank(pool: &PgPool, agent_id: Uuid) -> Result<bool, sqlx::Error> {
    use sqlx::Row;
    // 先找 user_id 和 name
    let Some(row) = sqlx::query("SELECT user_id, name FROM agents WHERE id = $1 LIMIT 1")
        .bind(agent_id).fetch_optional(pool).await? else { return Ok(false) };
    let user_id: Uuid = row.get("user_id");
    let name: String  = row.get("name");

    let mut tx = pool.begin().await?;
    // 删除同名所有版本、附属数据
    sqlx::query("DELETE FROM api_keys   WHERE user_id = $1 AND name       = $2")
        .bind(user_id).bind(&name).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM tank_skins WHERE user_id = $1 AND agent_name = $2")
        .bind(user_id).bind(&name).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM elo_ratings WHERE user_id = $1 AND agent_name = $2")
        .bind(user_id).bind(&name).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM agents     WHERE user_id = $1 AND name       = $2")
        .bind(user_id).bind(&name).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(true)
}

#[derive(Debug, Serialize)]
pub struct AdminSystemStats {
    pub total_users:         i64,
    pub total_agents:        i64,
    pub total_battles:       i64,
    pub battles_last_24h:    i64,
}

/// 列出最近 N 场对战（管理员用）
pub async fn admin_list_recent_battles(pool: &PgPool, limit: i64) -> Result<Vec<TankBattleRecord>, sqlx::Error> {
    use sqlx::Row;
    let rows = sqlx::query(r#"
        SELECT b.id::text, b.agent_name AS challenger, b.opponent, b.winner, b.total_ticks, b.created_at
        FROM battles b
        WHERE b.challenger_id IS NOT NULL
        ORDER BY b.created_at DESC
        LIMIT $1
    "#)
    .bind(limit)
    .fetch_all(pool).await?;
    Ok(rows.iter().map(|r| TankBattleRecord {
        id: r.get("id"),
        challenger: r.get("challenger"),
        opponent: r.get("opponent"),
        winner: r.get("winner"),
        total_ticks: r.get("total_ticks"),
        created_at: r.get("created_at"),
    }).collect())
}

/// 系统指标（管理员用）
pub async fn admin_system_stats(pool: &PgPool) -> Result<AdminSystemStats, sqlx::Error> {
    use sqlx::Row;
    let row = sqlx::query(r#"
        SELECT
            (SELECT COUNT(*) FROM users)                                          AS total_users,
            (SELECT COUNT(DISTINCT name || user_id::text) FROM agents)            AS total_agents,
            (SELECT COUNT(*) FROM battles)                                        AS total_battles,
            (SELECT COUNT(*) FROM battles WHERE created_at >= NOW() - INTERVAL '1 day') AS battles_last_24h
    "#).fetch_one(pool).await?;
    Ok(AdminSystemStats {
        total_users:      row.get("total_users"),
        total_agents:     row.get("total_agents"),
        total_battles:    row.get("total_battles"),
        battles_last_24h: row.get("battles_last_24h"),
    })
}

pub async fn create_verification_token(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<String, sqlx::Error> {
    let token = Uuid::new_v4().to_string().replace('-', "");
    let expires_at = chrono::Utc::now() + chrono::Duration::hours(24);
    sqlx::query(
        "INSERT INTO email_verification_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)",
    )
    .bind(&token)
    .bind(user_id)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(token)
}

pub async fn consume_verification_token(
    pool: &PgPool,
    token: &str,
) -> Result<Option<UserRow>, sqlx::Error> {
    use sqlx::Row;
    // 原子性：删除 token 并返回对应用户（过期的不删）
    let row = sqlx::query(
        r#"DELETE FROM email_verification_tokens
           WHERE token = $1 AND expires_at > NOW()
           RETURNING user_id"#,
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else { return Ok(None) };
    let user_id: Uuid = row.get("user_id");

    // 标记邮箱已验证
    sqlx::query("UPDATE users SET email_verified = TRUE WHERE id = $1")
        .bind(user_id)
        .execute(pool)
        .await?;

    // 返回用户信息用于签发 JWT
    let user = sqlx::query(
        "SELECT id, username, password_hash, email_verified, is_admin, banned FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(user.map(|r| UserRow {
        id:             r.get("id"),
        username:       r.get("username"),
        password_hash:  r.get("password_hash"),
        email_verified: r.get("email_verified"),
        is_admin:       r.get("is_admin"),
        banned:         r.get("banned"),
    }))
}
