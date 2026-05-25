/// WebSocket 实时对战端点 GET /api/play
/// 玩家通过键盘命令操控自己的坦克，与内置 Rusher bot 实时对战。

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router,
};
use serde::Serialize;
use tokio::sync::mpsc;

use crate::{battle, physics};
use crate::sandbox::QuickJsSandbox;
use crate::server::AppState;

// ── 内置 bot JS 代码 ──────────────────────────────────────────────────────────

const RUSHER_JS: &str = include_str!("../../../agents/rusher.js");

// ── 路由注册 ─────────────────────────────────────────────────────────────────

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/api/play", get(ws_play_upgrade))
}

// ── WebSocket 升级入口 ────────────────────────────────────────────────────────

async fn ws_play_upgrade(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(play_game)
}

// ── WebSocket 主处理器 ────────────────────────────────────────────────────────

async fn play_game(mut socket: WebSocket) {
    // cmd_tx：前端 → 游戏（TankCommand），缓冲 5 条
    let (cmd_tx, cmd_rx) = mpsc::channel::<physics::TankCommand>(5);
    // frame_tx：游戏 → 前端（JSON 字符串），缓冲 16 帧防卡顿
    let (frame_tx, mut frame_rx) = mpsc::channel::<String>(16);

    // 在 spawn_blocking 里启动游戏循环（QuickJsSandbox 不是 Send，但在内部创建没问题）
    let game_handle = tokio::task::spawn_blocking(move || {
        run_game_loop(cmd_rx, frame_tx);
    });

    // 同时：转发游戏帧给前端 + 接收键盘命令发给游戏
    loop {
        tokio::select! {
            // 游戏 → 前端
            maybe_frame = frame_rx.recv() => {
                match maybe_frame {
                    Some(json) => {
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            // 连接断开，退出
                            break;
                        }
                    }
                    None => {
                        // 游戏结束（channel 关闭），退出
                        break;
                    }
                }
            }
            // 前端 → 游戏
            maybe_msg = socket.recv() => {
                match maybe_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Some(cmd) = parse_command(&text) {
                            // 忽略发送失败（游戏可能已结束）
                            let _ = cmd_tx.try_send(cmd);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        // 客户端断开
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    // 等待游戏线程退出（忽略错误）
    let _ = game_handle.await;
}

// ── 命令解析 ─────────────────────────────────────────────────────────────────

fn parse_command(text: &str) -> Option<physics::TankCommand> {
    // {"cmd": "move"} | {"cmd": "turnLeft"} | {"cmd": "turnRight"} | {"cmd": "fire"}
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let cmd = v.get("cmd")?.as_str()?;
    match cmd {
        "move"      => Some(physics::TankCommand::Move),
        "turnLeft"  => Some(physics::TankCommand::TurnLeft),
        "turnRight" => Some(physics::TankCommand::TurnRight),
        "fire"      => Some(physics::TankCommand::Fire),
        _           => None,
    }
}

// ── 游戏内部状态 ─────────────────────────────────────────────────────────────

struct GameState {
    /// 索引 0 = 玩家，索引 1 = Rusher bot
    tanks:     Vec<physics::TankState>,
    /// 沙箱：玩家为 None，AI 为 Some
    sandboxes: Vec<Option<QuickJsSandbox>>,
    bullets:   Vec<physics::Bullet>,
    map:       physics::Map,
    stars:     Vec<physics::Star>,
    rng:       u64,
    next_bullet_id: u32,
    tick:      u32,
}

impl GameState {
    fn next_rand(&mut self) -> f64 {
        self.rng = self.rng
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.rng >> 33) as f64 / u32::MAX as f64
    }

    fn try_spawn_star(&mut self) {
        if self.stars.len() >= physics::STAR_MAX { return; }
        let margin = 2usize;
        let x = margin + (self.next_rand() * (physics::GRID_W - margin * 2) as f64) as usize;
        let y = margin + (self.next_rand() * (physics::GRID_H - margin * 2) as f64) as usize;
        if self.map[y][x] == physics::Tile::Floor
            && !self.tanks.iter().any(|t| t.alive && t.x == x && t.y == y)
        {
            self.stars.push(physics::Star { x, y });
        }
    }
}

// ── 初始化消息类型 ────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct InitArena {
    map:    Vec<String>,
    width:  usize,
    height: usize,
}

#[derive(Serialize)]
struct InitMessage {
    #[serde(rename = "type")]
    msg_type: &'static str,
    arena: InitArena,
}

#[derive(Serialize)]
struct FrameMessage {
    #[serde(rename = "type")]
    msg_type: &'static str,
    tick:    u32,
    tanks:   Vec<battle::TankSnapshot>,
    bullets: Vec<battle::BulletSnapshot>,
    stars:   Vec<battle::StarSnapshot>,
}

#[derive(Serialize)]
struct EndMessage {
    #[serde(rename = "type")]
    msg_type:    &'static str,
    winner:      String,
    winner_label: String,
    timed_out:   bool,
    total_ticks: u32,
}

// ── 游戏循环（在 spawn_blocking 线程中运行）──────────────────────────────────

fn run_game_loop(
    mut cmd_rx: mpsc::Receiver<physics::TankCommand>,
    frame_tx:   mpsc::Sender<String>,
) {
    // ── 初始化地图和坦克 ──────────────────────────────────────────────────────
    let map = physics::init_map();

    let (px, py, pf) = physics::start_positions(0); // 玩家：(1,1,East)
    let (rx, ry, rf) = physics::start_positions(1); // Rusher：(18,18,West)

    // 玩家 id=0 → team_id=0；Rusher id=1 → team_id=1
    let player_tank = physics::TankState::new(0, "玩家", px, py, pf, 0, physics::SkillType::Shield);
    let rusher_tank = physics::TankState::new(1, "Rusher", rx, ry, rf, 1, physics::SkillType::Shield);

    // 初始化 Rusher 沙箱（只在此线程内创建，不跨线程传递）
    let rusher_sandbox = match QuickJsSandbox::new("Rusher", RUSHER_JS) {
        Ok(s)  => s,
        Err(e) => {
            eprintln!("[play] Rusher 沙箱初始化失败: {}", e);
            return;
        }
    };

    let mut state = GameState {
        tanks:          vec![player_tank, rusher_tank],
        sandboxes:      vec![None, Some(rusher_sandbox)],
        bullets:        Vec::new(),
        map,
        stars:          Vec::new(),
        rng:            12345678901234567,
        next_bullet_id: 0,
        tick:           0,
    };

    // ── 发送初始化消息 ────────────────────────────────────────────────────────
    let init_msg = InitMessage {
        msg_type: "init",
        arena: InitArena {
            map:    physics::map_to_strings(&state.map),
            width:  physics::GRID_W,
            height: physics::GRID_H,
        },
    };
    if let Ok(json) = serde_json::to_string(&init_msg) {
        if frame_tx.blocking_send(json).is_err() { return; }
    }

    // ── 主循环 ────────────────────────────────────────────────────────────────
    let mut winner       = String::new();
    let mut winner_label = String::new();
    let mut timed_out    = false;

    'sim: for tick in 0..physics::MAX_TURNS {
        state.tick = tick;

        // 每帧延迟 200ms
        std::thread::sleep(std::time::Duration::from_millis(200));

        // ── 1. 星星刷新 ───────────────────────────────────────────────────────
        if tick % physics::STAR_SPAWN_INTERVAL == 0 {
            state.try_spawn_star();
        }

        // ── 2 & 3. 收集各坦克命令（先收集，避免借用冲突） ─────────────────────
        let summaries: Vec<physics::TankSummary> = state.tanks.iter()
            .map(|t| t.as_summary())
            .collect();

        let mut new_cmds: Vec<(usize, Vec<physics::TankCommand>)> = Vec::new();

        for i in 0..state.tanks.len() {
            if !state.tanks[i].alive || !state.tanks[i].command_queue.is_empty() {
                continue;
            }
            if let Some(sandbox) = &state.sandboxes[i] {
                // AI 坦克：调用沙箱
                let others: Vec<physics::TankSummary> = summaries.iter()
                    .filter(|s| s.id != state.tanks[i].id)
                    .cloned()
                    .collect();
                let sensors = physics::compute_sensors(
                    &summaries[i],
                    &others,
                    &state.map,
                    &state.stars,
                    tick,
                    &state.bullets,
                );
                let (cmds, _logs) = sandbox.act(&sensors);
                if !cmds.is_empty() {
                    new_cmds.push((i, cmds));
                }
            } else {
                // 玩家坦克：从 cmd_rx 取最多 1 条命令
                if let Ok(cmd) = cmd_rx.try_recv() {
                    new_cmds.push((i, vec![cmd]));
                }
            }
        }

        // 统一应用新命令
        for (i, cmds) in new_cmds {
            state.tanks[i].command_queue.extend(cmds);
        }

        // ── 4. 消费命令队列（每帧一条）────────────────────────────────────────
        let this_turn_cmds: Vec<Option<physics::TankCommand>> = state.tanks.iter_mut()
            .map(|t| if t.alive { t.command_queue.pop_front() } else { None })
            .collect();

        // 4a. 计算预期新位置（同时解算，消除处理顺序影响）
        let mut intended: Vec<Option<(usize, usize)>> = state.tanks.iter()
            .zip(this_turn_cmds.iter())
            .map(|(tank, cmd)| {
                if !tank.alive { return None; }
                if matches!(cmd, Some(physics::TankCommand::Move)) {
                    physics::step_forward(tank.x, tank.y, tank.facing)
                        .filter(|&(nx, ny)| state.map[ny][nx].is_passable())
                } else {
                    None
                }
            })
            .collect();

        // 冲突检测：两辆坦克想去同一格，或目标格已有存活坦克 → 均不动
        let n = state.tanks.len();
        for i in 0..n {
            if let Some(pos_i) = intended[i] {
                let conflict = (0..n).any(|j| {
                    if j == i { return false; }
                    let tj = &state.tanks[j];
                    (tj.alive && tj.x == pos_i.0 && tj.y == pos_i.1)
                        || intended[j] == Some(pos_i)
                });
                if conflict { intended[i] = None; }
            }
        }

        // 应用转向 & 移动
        for (i, tank) in state.tanks.iter_mut().enumerate() {
            if !tank.alive { continue; }
            match &this_turn_cmds[i] {
                Some(physics::TankCommand::TurnLeft)  => { tank.facing = tank.facing.turn_left(); }
                Some(physics::TankCommand::TurnRight) => { tank.facing = tank.facing.turn_right(); }
                _ => {}
            }
            if let Some((nx, ny)) = intended[i] {
                tank.x = nx;
                tank.y = ny;
            }
        }

        // ── 5. 射击 ───────────────────────────────────────────────────────────
        let mut new_bullets: Vec<physics::Bullet> = Vec::new();
        for (i, tank) in state.tanks.iter_mut().enumerate() {
            if !tank.alive { continue; }
            if matches!(&this_turn_cmds[i], Some(physics::TankCommand::Fire))
                && tank.shoot_cooldown == 0
            {
                tank.shoot_cooldown = 1; // 子弹在飞，禁止再射
                new_bullets.push(physics::Bullet {
                    id:     state.next_bullet_id,
                    x:      tank.x,
                    y:      tank.y,
                    facing: tank.facing,
                    owner:  tank.id,
                    active: true,
                });
                state.next_bullet_id += 1;
            }
        }
        state.bullets.extend(new_bullets);

        // ── 6. 推进子弹（每颗前进 BULLET_SPEED 格）────────────────────────────
        // (id, x, y, alive, team_id)
        let tank_pos: Vec<(usize, usize, usize, bool, usize)> = state.tanks.iter()
            .map(|t| (t.id, t.x, t.y, t.alive, t.team_id))
            .collect();

        let mut hit_events: Vec<(usize, usize)> = Vec::new();

        for _ in 0..physics::BULLET_SPEED {
            for bullet in state.bullets.iter_mut().filter(|b| b.active) {
                let Some((nx, ny)) = physics::step_forward(bullet.x, bullet.y, bullet.facing)
                    else { bullet.active = false; continue; };

                match &state.map[ny][nx] {
                    physics::Tile::Wall => { bullet.active = false; continue; }
                    physics::Tile::Mound => {
                        state.map[ny][nx] = physics::Tile::Floor;
                        bullet.active = false;
                        continue;
                    }
                    _ => {}
                }

                bullet.x = nx;
                bullet.y = ny;

                // 获取子弹拥有者的 team_id
                let owner_team = tank_pos.iter()
                    .find(|&&(id, ..)| id == bullet.owner)
                    .map(|&(.., team_id)| team_id)
                    .unwrap_or(usize::MAX);

                if let Some(&(victim_id, ..)) = tank_pos.iter().find(|&&(id, x, y, alive, team_id)| {
                    alive && id != bullet.owner && team_id != owner_team && x == nx && y == ny
                }) {
                    hit_events.push((bullet.owner, victim_id));
                    bullet.active = false;
                }
            }
        }

        // ── 7. 子弹消灭后解锁 owner 射击冷却 & 应用伤害 ───────────────────────
        for bullet in state.bullets.iter().filter(|b| !b.active) {
            if let Some(tank) = state.tanks.get_mut(bullet.owner) {
                tank.shoot_cooldown = 0;
            }
        }
        state.bullets.retain(|b| b.active);

        for (_owner_id, victim_id) in hit_events {
            let tank = &mut state.tanks[victim_id];
            tank.hp -= physics::BULLET_DAMAGE;
            if tank.hp <= 0 {
                tank.hp    = 0;
                tank.alive = false;
            }
        }

        // ── 8. 捡星星 ─────────────────────────────────────────────────────────
        let mut si = state.stars.len();
        while si > 0 {
            si -= 1;
            let (sx, sy) = (state.stars[si].x, state.stars[si].y);
            if let Some(tank) = state.tanks.iter_mut()
                .find(|t| t.alive && t.x == sx && t.y == sy)
            {
                state.stars.remove(si);
                tank.score += 1;
            }
        }

        // ── 9. 记录帧并发送 ───────────────────────────────────────────────────
        let frame_msg = FrameMessage {
            msg_type: "frame",
            tick,
            tanks: state.tanks.iter().map(|t| battle::TankSnapshot {
                id:           t.id,
                name:         t.name.clone(),
                x:            t.pixel_x(),
                y:            t.pixel_y(),
                body_angle:   t.facing.to_angle(),
                turret_angle: t.facing.to_angle(),
                hp:           t.hp,
                alive:        t.alive,
                score:        t.score,
                team_id:      t.team_id,
                skill_type:   t.skill_type.as_str().to_string(),
                skill_cooldown: t.skill_cooldown,
                shielded:     t.status.shielded   > 0,
                frozen:       t.status.frozen     > 0,
                stunned:      t.status.stunned    > 0,
                overloaded:   t.status.overloaded,
                cloaked:      t.status.cloaked    > 0,
                poisoned:     t.status.poisoned   > 0,
                boosted:      t.status.boosted    > 0,
            }).collect(),
            bullets: state.bullets.iter().filter(|b| b.active).map(|b| battle::BulletSnapshot {
                id:       b.id,
                x:        b.pixel_x(),
                y:        b.pixel_y(),
                owner_id: b.owner,
            }).collect(),
            stars: state.stars.iter().map(|s| battle::StarSnapshot {
                x: s.x as f64 * physics::TILE_SIZE + physics::TILE_SIZE / 2.0,
                y: s.y as f64 * physics::TILE_SIZE + physics::TILE_SIZE / 2.0,
            }).collect(),
        };

        if let Ok(json) = serde_json::to_string(&frame_msg) {
            if frame_tx.blocking_send(json).is_err() {
                // WebSocket 已断开，停止游戏
                return;
            }
        }

        // ── 10. 胜负判断 ──────────────────────────────────────────────────────
        let alive: Vec<&physics::TankState> = state.tanks.iter()
            .filter(|t| t.alive)
            .collect();

        if alive.len() <= 1 {
            timed_out = false;
            if let Some(t) = alive.first() {
                winner       = t.name.clone();
                winner_label = format!("{} 🏆", t.name);
            } else {
                // 同归于尽：取得分/HP 最高者
                if let Some(t) = state.tanks.iter()
                    .max_by_key(|t| (t.score, t.hp))
                {
                    winner       = t.name.clone();
                    winner_label = format!("{} (同归于尽·最高分)", t.name);
                } else {
                    winner       = "无".into();
                    winner_label = "无".into();
                }
            }
            break 'sim;
        }
    }

    // 超时判定
    if winner.is_empty() {
        timed_out = true;
        if let Some(t) = state.tanks.iter()
            .filter(|t| t.alive)
            .max_by_key(|t| (t.score, t.hp))
        {
            winner       = t.name.clone();
            winner_label = format!("{} (时间到·最高分)", t.name);
        } else {
            winner       = "无".into();
            winner_label = "无".into();
        }
    }

    // ── 发送游戏结束消息 ──────────────────────────────────────────────────────
    let end_msg = EndMessage {
        msg_type:     "end",
        winner:       winner.clone(),
        winner_label: winner_label.clone(),
        timed_out,
        total_ticks:  state.tick + 1,
    };
    if let Ok(json) = serde_json::to_string(&end_msg) {
        let _ = frame_tx.blocking_send(json);
    }
}
