/// 坦克竞技场仿真主循环（格子 + 回合制）

use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use crate::physics::{self, TankCommand, TankState};
use crate::sandbox::{JsExecStats, QuickJsSandbox};

// ─── 遥测数据结构（保持前端兼容：x/y 为像素中心，body_angle 为弧度）─────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TankSnapshot {
    pub id: usize,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub body_angle: f64,
    pub turret_angle: f64,
    pub hp: i32,
    pub alive: bool,
    pub score: u32,
    pub team_id: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulletSnapshot {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub owner_id: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StarSnapshot {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameData {
    pub tick: u32,
    pub tanks: Vec<TankSnapshot>,
    pub bullets: Vec<BulletSnapshot>,
    pub stars: Vec<StarSnapshot>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ArenaConfig {
    pub width: usize,
    pub height: usize,
    pub map: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TankSkin {
    /// DeepSeek 生成的完整坦克 SVG 内部元素（不含 <svg> 标签）
    pub svg: Option<String>,
    /// 用户的描述文字（存档用）
    pub description: Option<String>,
    /// 子弹皮肤样式（default/fire/plasma/void/gold）
    pub bullet_style: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BattleResult {
    /// 纯名字，用于 Elo 计算等程序比较
    pub winner: String,
    /// 带装饰的展示字符串（如 "Alice 🏆" 或 "Alice (时间到·最高分)"）
    pub winner_label: String,
    pub total_ticks: u32,
    /// 是否因超时（达到 MAX_TURNS）结束，而非正常击败
    pub timed_out: bool,
    pub arena: ArenaConfig,
    pub telemetry: Vec<FrameData>,
    pub battle_log: Vec<String>,
    pub skins: HashMap<String, TankSkin>,
    /// 每辆坦克的 JS 执行统计
    pub js_stats: Vec<JsExecStats>,
    /// 胜利队伍 ID，None 表示平局/同归于尽（或单人模式）
    pub winner_team: Option<usize>,
}

// ─── Arena Engine ────────────────────────────────────────────────────────

pub struct ArenaEngine {
    agents:     Vec<(TankState, QuickJsSandbox)>,
    bullets:    Vec<physics::Bullet>,
    map:        physics::Map,
    stars:      Vec<physics::Star>,
    rng:        u64,
    next_bullet_id: u32,
}

impl ArenaEngine {
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
            && !self.agents.iter().any(|(t, _)| t.alive && t.x == x && t.y == y)
        {
            self.stars.push(physics::Star { x, y });
        }
    }
}

impl ArenaEngine {
    pub fn new(specs: Vec<(&str, &str)>) -> Result<Self, String> {
        let map = physics::init_map();
        let agents = specs
            .into_iter()
            .enumerate()
            .map(|(id, (name, code))| {
                let (sx, sy, sf) = physics::start_positions(id);
                // team_id = id % 2：id=0,2 → team 0；id=1,3 → team 1
                let team_id = id % 2;
                let state = TankState::new(id, name, sx, sy, sf, team_id);
                let sandbox = QuickJsSandbox::new(name, code)?;
                Ok((state, sandbox))
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(Self {
            agents,
            bullets: Vec::new(),
            map,
            stars: Vec::new(),
            rng: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64,
            next_bullet_id: 0,
        })
    }

    pub fn run(mut self) -> BattleResult {
        let mut telemetry:  Vec<FrameData> = Vec::new();
        let mut battle_log: Vec<String>    = Vec::new();
        let names: Vec<String> = self.agents.iter().map(|(t, _)| t.name.clone()).collect();

        battle_log.push(format!(
            "═══ Chassis 坦克竞技场（格子回合制）开始，共 {} 辆坦克 ═══",
            self.agents.len()
        ));
        for (t, _) in &self.agents {
            battle_log.push(format!(
                "  [{}] 出生于 tile ({},{}) 朝向 {}", t.name, t.x, t.y, t.facing.as_str()
            ));
        }

        let arena_config = ArenaConfig {
            width:  physics::GRID_W,
            height: physics::GRID_H,
            map:    physics::map_to_strings(&self.map),
        };

        let mut winner       = String::new();
        let mut winner_label = String::new();
        let mut winner_team: Option<usize> = None;
        let mut final_tick   = physics::MAX_TURNS;
        let mut timed_out    = false;

        'sim: for turn in 0..physics::MAX_TURNS {

            // ── 1. 冷却由子弹存活状态驱动，此处无需倒计时 ───────────────

            // ── 2. 刷新星星 ──────────────────────────────────────────────
            if turn % physics::STAR_SPAWN_INTERVAL == 0 {
                self.try_spawn_star();
            }

            // ── 3. 队列空时调用 onIdle 填充命令 ──────────────────────────
            let summaries: Vec<physics::TankSummary> = self.agents.iter()
                .map(|(t, _)| t.as_summary())
                .collect();

            for (tank, sandbox) in self.agents.iter_mut() {
                if !tank.alive || !tank.command_queue.is_empty() { continue; }

                let others: Vec<physics::TankSummary> = summaries.iter()
                    .filter(|s| s.id != tank.id)
                    .cloned()
                    .collect();
                let sensors = physics::compute_sensors(
                    &tank.as_summary(), &others, &self.map, &self.stars, turn, &self.bullets,
                );
                let (cmds, logs) = sandbox.act(&sensors);
                for log in logs {
                    battle_log.push(format!("[Turn {:04}][{}] {}", turn, tank.name, log));
                }
                tank.command_queue.extend(cmds);
            }

            // ── 4. 消费命令队列（每帧一条） ──────────────────────────────
            let this_turn_cmds: Vec<Option<TankCommand>> = self.agents.iter_mut()
                .map(|(t, _)| if t.alive { t.command_queue.pop_front() } else { None })
                .collect();

            // 4a. 计算预期新位置（同时解算，消除处理顺序影响）
            let mut intended: Vec<Option<(usize, usize)>> = self.agents.iter()
                .zip(this_turn_cmds.iter())
                .map(|((tank, _), cmd)| {
                    if !tank.alive { return None; }
                    if matches!(cmd, Some(TankCommand::Move)) {
                        physics::step_forward(tank.x, tank.y, tank.facing)
                            .filter(|&(nx, ny)| self.map[ny][nx].is_passable())
                    } else {
                        None
                    }
                })
                .collect();

            // 冲突检测：两辆坦克想去同一格，或目标格已有存活坦克 → 均不动
            let n = self.agents.len();
            for i in 0..n {
                if let Some(pos_i) = intended[i] {
                    let conflict = (0..n).any(|j| {
                        if j == i { return false; }
                        let (tj, _) = &self.agents[j];
                        (tj.alive && tj.x == pos_i.0 && tj.y == pos_i.1)
                            || intended[j] == Some(pos_i)
                    });
                    if conflict { intended[i] = None; }
                }
            }

            // 应用转向 & 移动
            for (i, (tank, _)) in self.agents.iter_mut().enumerate() {
                if !tank.alive { continue; }
                match &this_turn_cmds[i] {
                    Some(TankCommand::TurnLeft)  => { tank.facing = tank.facing.turn_left(); }
                    Some(TankCommand::TurnRight) => { tank.facing = tank.facing.turn_right(); }
                    _ => {}
                }
                if let Some((nx, ny)) = intended[i] {
                    tank.x = nx;
                    tank.y = ny;
                }
            }

            // 4b. 射击
            let mut new_bullets = Vec::new();
            for (i, (tank, _)) in self.agents.iter_mut().enumerate() {
                if !tank.alive { continue; }
                if matches!(&this_turn_cmds[i], Some(TankCommand::Fire))
                    && tank.shoot_cooldown == 0
                {
                    tank.shoot_cooldown = 1; // 子弹在飞，禁止再射
                    new_bullets.push(physics::Bullet {
                        id: self.next_bullet_id,
                        x: tank.x, y: tank.y,
                        facing: tank.facing,
                        owner: tank.id,
                        active: true,
                    });
                    self.next_bullet_id += 1;
                    battle_log.push(format!("[Turn {:04}] {} 射击！", turn, tank.name));
                }
            }
            self.bullets.extend(new_bullets);

            // ── 5. 推进子弹（每颗前进两格，与竞品对齐）────────────────────
            // (id, x, y, alive, team_id)
            let tank_pos: Vec<(usize, usize, usize, bool, usize)> = self.agents.iter()
                .map(|(t, _)| (t.id, t.x, t.y, t.alive, t.team_id))
                .collect();

            let mut hit_events: Vec<(usize, usize)> = Vec::new();

            for _ in 0..physics::BULLET_SPEED {
                for bullet in self.bullets.iter_mut().filter(|b| b.active) {
                    let Some((nx, ny)) = physics::step_forward(bullet.x, bullet.y, bullet.facing)
                        else { bullet.active = false; continue; };

                    match &self.map[ny][nx] {
                        physics::Tile::Wall => { bullet.active = false; continue; }
                        physics::Tile::Mound => {
                            self.map[ny][nx] = physics::Tile::Floor;
                            bullet.active = false;
                            battle_log.push(format!(
                                "[Turn {:04}] 子弹摧毁了土堆 ({},{})", turn, nx, ny
                            ));
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
            // 子弹消灭时解锁 owner 的射击冷却
            for bullet in self.bullets.iter().filter(|b| !b.active) {
                if let Some((tank, _)) = self.agents.get_mut(bullet.owner) {
                    tank.shoot_cooldown = 0;
                }
            }
            self.bullets.retain(|b| b.active);

            for (owner_id, victim_id) in hit_events {
                let (tank, _) = &mut self.agents[victim_id];
                tank.hp -= physics::BULLET_DAMAGE;
                if tank.hp <= 0 { tank.hp = 0; tank.alive = false; }
                let log = if tank.alive {
                    format!(
                        "[Turn {:04}] {} 击中 {}（{} HP 剩余）",
                        turn, names[owner_id], names[victim_id], tank.hp
                    )
                } else {
                    format!(
                        "[Turn {:04}] ☠ {} 被 {} 摧毁！",
                        turn, names[victim_id], names[owner_id]
                    )
                };
                battle_log.push(log);
            }

            // ── 6. 捡星星 ────────────────────────────────────────────────
            let mut i = self.stars.len();
            while i > 0 {
                i -= 1;
                let (sx, sy) = (self.stars[i].x, self.stars[i].y);
                if let Some((tank, _)) = self.agents.iter_mut()
                    .find(|(t, _)| t.alive && t.x == sx && t.y == sy)
                {
                    self.stars.remove(i);
                    tank.score += 1;
                    battle_log.push(format!(
                        "[Turn {:04}] ⭐ {} 捡到星星（得分 {}）", turn, tank.name, tank.score
                    ));
                }
            }

            // ── 7. 记录帧 ────────────────────────────────────────────────
            telemetry.push(FrameData {
                tick: turn,
                tanks: self.agents.iter().map(|(t, _)| TankSnapshot {
                    id: t.id, name: t.name.clone(),
                    x: t.pixel_x(), y: t.pixel_y(),
                    body_angle: t.facing.to_angle(),
                    turret_angle: t.facing.to_angle(),
                    hp: t.hp, alive: t.alive, score: t.score,
                    team_id: t.team_id,
                }).collect(),
                bullets: self.bullets.iter().filter(|b| b.active).map(|b| BulletSnapshot {
                    id: b.id, x: b.pixel_x(), y: b.pixel_y(), owner_id: b.owner,
                }).collect(),
                stars: self.stars.iter().map(|s| StarSnapshot {
                    x: s.x as f64 * physics::TILE_SIZE + physics::TILE_SIZE / 2.0,
                    y: s.y as f64 * physics::TILE_SIZE + physics::TILE_SIZE / 2.0,
                }).collect(),
            });

            // ── 8. 胜负判断 ──────────────────────────────────────────────
            let alive: Vec<&TankState> = self.agents.iter()
                .map(|(t, _)| t)
                .filter(|t| t.alive)
                .collect();

            // 存活坦克属于同一支队伍（或只剩 1 个或 0 个），则结束
            let alive_teams: std::collections::HashSet<usize> =
                alive.iter().map(|t| t.team_id).collect();

            if alive_teams.len() <= 1 {
                final_tick = turn + 1;
                timed_out = false;
                if alive.is_empty() {
                    // 同归于尽：取得分/HP 最高者
                    if let Some(t) = self.agents.iter().map(|(t, _)| t)
                        .max_by_key(|t| (t.score, t.hp))
                    {
                        winner       = t.name.clone();
                        winner_label = format!("{} (同归于尽·最高分)", t.name);
                        winner_team  = None;
                    } else {
                        winner       = "无".into();
                        winner_label = "无".into();
                        winner_team  = None;
                    }
                } else {
                    // 取存活队伍中得分/HP 最高者作为代表
                    let winning_team = alive_teams.into_iter().next().unwrap();
                    winner_team = Some(winning_team);
                    if let Some(t) = alive.iter().max_by_key(|t| (t.score, t.hp)) {
                        winner       = t.name.clone();
                        winner_label = if alive.len() == 1 {
                            format!("{} 🏆", t.name)
                        } else {
                            format!("队伍 {} 🏆（代表：{}）", winning_team, t.name)
                        };
                    }
                };
                battle_log.push(format!("[Turn {:04}] 比赛结束！胜者: {}", turn, winner_label));
                break 'sim;
            }
        }

        if winner.is_empty() {
            // 超时：循环跑完未分出胜负
            timed_out = true;
            let alive_at_timeout: Vec<&TankState> = self.agents.iter()
                .map(|(t, _)| t)
                .filter(|t| t.alive)
                .collect();
            // 判定胜利队伍（存活坦克中得分/HP 最高者）
            if let Some(t) = alive_at_timeout.iter().max_by_key(|t| (t.score, t.hp)) {
                winner       = t.name.clone();
                winner_label = format!("{} (时间到·最高分)", t.name);
                winner_team  = Some(t.team_id);
            } else if let Some(t) = self.agents.iter().map(|(t, _)| t)
                .max_by_key(|t| (t.score, t.hp))
            {
                winner       = t.name.clone();
                winner_label = format!("{} (时间到·最高分)", t.name);
                winner_team  = Some(t.team_id);
            } else {
                winner       = "无".into();
                winner_label = "无".into();
                winner_team  = None;
            }
            battle_log.push(format!(
                "达到最大回合 ({})，判定胜者: {}", physics::MAX_TURNS, winner_label
            ));
        }

        battle_log.push("═══ 竞技场结束 ═══".to_string());

        // 收集每辆坦克的 JS 执行统计
        let js_stats: Vec<JsExecStats> = self.agents.iter()
            .map(|(_, sandbox)| sandbox.stats())
            .collect();

        BattleResult {
            winner,
            winner_label,
            total_ticks: final_tick,
            timed_out,
            arena: arena_config,
            telemetry,
            battle_log,
            skins: HashMap::new(),
            js_stats,
            winner_team,
        }
    }
}
