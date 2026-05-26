/// 坦克竞技场仿真主循环（格子 + 回合制）

use std::collections::HashMap;
use serde::{Deserialize, Serialize};

use crate::physics::{self, SkillType, TankCommand, TankState};
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
    pub skill_type: String,
    pub skill_cooldown: u32,
    // 状态布尔值（前端展示用）
    pub shielded:   bool,
    pub frozen:     bool,
    pub stunned:    bool,
    pub overloaded: bool,
    pub cloaked:    bool,
    pub poisoned:   bool,
    pub boosted:    bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulletSnapshot {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub owner_id: usize,
    pub vx: i32,
    pub vy: i32,
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
    /// 累计被摧毁的土堆坐标 [col, row]
    pub destroyed_mounds: Vec<[usize; 2]>,
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
    destroyed_mounds: Vec<[usize; 2]>,
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
    pub fn new(specs: Vec<(&str, &str, SkillType)>) -> Result<Self, String> {
        let map = physics::init_map();
        let agents = specs
            .into_iter()
            .enumerate()
            .map(|(id, (name, code, skill_type))| {
                let (sx, sy, sf) = physics::start_positions(id);
                // team_id = id % 2：id=0,2 → team 0；id=1,3 → team 1
                let team_id = id % 2;
                let state = TankState::new(id, name, sx, sy, sf, team_id, skill_type);
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
            destroyed_mounds: Vec::new(),
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

            // ── 1. 技能冷却 & 状态倒计时 ──────────────────────────────────
            for (tank, _) in self.agents.iter_mut() {
                if !tank.alive { continue; }
                if tank.skill_cooldown > 0 { tank.skill_cooldown -= 1; }
                tank.status.tick();
            }

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

            // ── 4. 消费命令队列（每帧一条）──────────────────────────────
            let mut this_turn_cmds: Vec<Option<TankCommand>> = self.agents.iter_mut()
                .map(|(t, _)| {
                    if !t.alive { return None; }
                    if t.status.frozen > 0 { return None; }  // 冻结：跳过，不出队
                    if t.status.poisoned > 0 && t.status.poison_skip { return None; }  // 中毒：每隔一帧跳过
                    t.command_queue.pop_front()
                })
                .collect();

            // 眩晕：将命令替换为随机移动/转向（先收集需要眩晕的索引，再替换）
            let stunned_indices: Vec<usize> = self.agents.iter()
                .enumerate()
                .filter(|(_, (t, _))| t.alive && t.status.stunned > 0)
                .map(|(i, _)| i)
                .collect();
            for i in stunned_indices {
                // 原命令推回队首，不丢失
                if let Some(original) = this_turn_cmds[i].take() {
                    self.agents[i].0.command_queue.push_front(original);
                }
                let r = (self.next_rand() * 3.0) as u32;
                this_turn_cmds[i] = Some(match r {
                    0 => TankCommand::Move,
                    1 => TankCommand::TurnLeft,
                    _ => TankCommand::TurnRight,
                });
            }

            // ── 4a. 处理技能命令 ────────────────────────────────────────

            for i in 0..self.agents.len() {
                if !matches!(this_turn_cmds[i], Some(TankCommand::UseSkill(_))) { continue; }
                let coords = if let Some(TankCommand::UseSkill(c)) = &this_turn_cmds[i] { *c } else { None };
                let skill_type = self.agents[i].0.skill_type.clone();

                if self.agents[i].0.skill_cooldown > 0 {
                    this_turn_cmds[i] = None;  // 冷却中，忽略
                    continue;
                }

                let cd_max = skill_type.cooldown_max();
                self.agents[i].0.skill_cooldown = cd_max;
                this_turn_cmds[i] = None;  // 技能命令不产生移动

                // 寻找最近敌人
                let me = &self.agents[i].0;
                let nearest_enemy_id: Option<usize> = summaries.iter()
                    .filter(|s| s.alive && s.team_id != me.team_id)
                    .min_by_key(|s| {
                        (s.x as i32 - me.x as i32).unsigned_abs() + (s.y as i32 - me.y as i32).unsigned_abs()
                    })
                    .map(|s| s.id);

                match skill_type {
                    SkillType::Shield => {
                        self.agents[i].0.status.shielded = 4;
                        battle_log.push(format!("[Turn {:04}] {} 激活护盾！", turn, self.agents[i].0.name));
                    }
                    SkillType::Freeze => {
                        if let Some(eid) = nearest_enemy_id {
                            self.agents[eid].0.status.frozen = 3; // 有效 2 帧
                            battle_log.push(format!("[Turn {:04}] {} 冻结了 {}！", turn, self.agents[i].0.name, self.agents[eid].0.name));
                        }
                    }
                    SkillType::Stun => {
                        if let Some(eid) = nearest_enemy_id {
                            self.agents[eid].0.status.stunned = 7; // 有效 6 帧
                            battle_log.push(format!("[Turn {:04}] {} 眩晕了 {}！", turn, self.agents[i].0.name, self.agents[eid].0.name));
                        }
                    }
                    SkillType::Overload => {
                        self.agents[i].0.status.overloaded = 11; // 有效 10 帧
                        battle_log.push(format!("[Turn {:04}] {} 激活过载！", turn, self.agents[i].0.name));
                    }
                    SkillType::Cloak => {
                        self.agents[i].0.status.cloaked = 9; // 有效 8 帧
                        battle_log.push(format!("[Turn {:04}] {} 进入隐身状态！", turn, self.agents[i].0.name));
                    }
                    SkillType::Poison => {
                        if let Some(eid) = nearest_enemy_id {
                            self.agents[eid].0.status.poisoned = 5; // 有效 4 帧（交替跳帧，共 2 次实际跳过）
                            battle_log.push(format!("[Turn {:04}] {} 使 {} 中毒！", turn, self.agents[i].0.name, self.agents[eid].0.name));
                        }
                    }
                    SkillType::Teleport => {
                        let success = if let Some((tx, ty)) = coords {
                            let passable = tx < physics::GRID_W && ty < physics::GRID_H
                                && self.map[ty][tx].is_passable()
                                && !self.agents.iter().any(|(t, _)| t.alive && t.id != i && t.x == tx && t.y == ty);
                            if passable {
                                self.agents[i].0.x = tx;
                                self.agents[i].0.y = ty;
                                let tank_name = self.agents[i].0.name.clone();
                                battle_log.push(format!("[Turn {:04}] {} 传送至 ({},{})！", turn, tank_name, tx, ty));
                                let near_enemy = summaries.iter()
                                    .any(|s| s.alive && s.team_id != self.agents[i].0.team_id
                                        && (s.x as i32 - tx as i32).unsigned_abs() + (s.y as i32 - ty as i32).unsigned_abs() <= 4);
                                if near_enemy {
                                    self.agents[i].0.status.fire_locked = 2;
                                }
                                true
                            } else { false }
                        } else { false };
                        // 传送失败退还 CD
                        if !success {
                            self.agents[i].0.skill_cooldown = 0;
                        }
                    }
                    SkillType::Boost => {
                        self.agents[i].0.status.boosted = 7; // 有效 6 帧
                        battle_log.push(format!("[Turn {:04}] {} 激活加速！", turn, self.agents[i].0.name));
                    }
                }
            }

            // 4b. 计算预期新位置（同时解算，消除处理顺序影响）
            // 加速坦克移动 2 格
            let mut intended: Vec<Option<(usize, usize)>> = self.agents.iter()
                .zip(this_turn_cmds.iter())
                .map(|((tank, _), cmd)| {
                    if !tank.alive { return None; }
                    if matches!(cmd, Some(TankCommand::Move)) {
                        let step1 = physics::step_forward(tank.x, tank.y, tank.facing)
                            .filter(|&(nx, ny)| self.map[ny][nx].is_passable());
                        if tank.status.boosted > 0 {
                            // 加速：尝试再走一格
                            if let Some((x1, y1)) = step1 {
                                physics::step_forward(x1, y1, tank.facing)
                                    .filter(|&(nx, ny)| self.map[ny][nx].is_passable())
                                    .or(step1)  // 第二格被阻挡时退回到第一格
                            } else {
                                None
                            }
                        } else {
                            step1
                        }
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

            // 4c. 射击（含过载双射 & fire_locked 检查）
            let mut new_bullets = Vec::new();
            for (i, (tank, _)) in self.agents.iter_mut().enumerate() {
                if !tank.alive { continue; }
                if matches!(&this_turn_cmds[i], Some(TankCommand::Fire))
                    && tank.shoot_cooldown == 0
                    && tank.status.fire_locked == 0  // 传送锁定期间不能射击
                {
                    tank.shoot_cooldown = 1; // 子弹在飞，禁止再射
                    let is_overloaded = tank.status.overloaded > 0;
                    if is_overloaded { tank.status.overloaded = 0; }

                    new_bullets.push(physics::Bullet {
                        id: self.next_bullet_id,
                        x: tank.x, y: tank.y,
                        facing: tank.facing,
                        owner: tank.id,
                        active: true,
                    });
                    self.next_bullet_id += 1;
                    battle_log.push(format!("[Turn {:04}] {} 射击！", turn, tank.name));

                    if is_overloaded {
                        new_bullets.push(physics::Bullet {
                            id: self.next_bullet_id,
                            x: tank.x, y: tank.y,
                            facing: tank.facing,
                            owner: tank.id,
                            active: true,
                        });
                        self.next_bullet_id += 1;
                        battle_log.push(format!("[Turn {:04}] {} 过载双射！", turn, tank.name));
                    }
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
                            self.destroyed_mounds.push([nx, ny]);
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

            // 应用伤害（护盾拦截）
            for (owner_id, victim_id) in hit_events {
                let (tank, _) = &mut self.agents[victim_id];
                if tank.status.shielded > 0 {
                    tank.status.shielded = 0;  // 护盾破碎
                    battle_log.push(format!(
                        "[Turn {:04}] {}'s 护盾挡住了子弹！", turn, names[victim_id]
                    ));
                    continue;
                }
                tank.hp -= physics::BULLET_DAMAGE;
                if tank.hp <= 0 { tank.hp = 0; tank.alive = false; }
                let log = if tank.alive {
                    format!(
                        "[Turn {:04}] {} 击中 {}（{} HP 剩余）",
                        turn, names[owner_id], names[victim_id], tank.hp
                    )
                } else {
                    format!(
                        "[Turn {:04}] {} 被 {} 摧毁！",
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
                        "[Turn {:04}] {} 捡到星星（得分 {}）", turn, tank.name, tank.score
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
                    skill_type: t.skill_type.as_str().to_string(),
                    skill_cooldown: t.skill_cooldown,
                    shielded:   t.status.shielded   > 0,
                    frozen:     t.status.frozen     > 0,
                    stunned:    t.status.stunned    > 0,
                    overloaded: t.status.overloaded  > 0,
                    cloaked:    t.status.cloaked    > 0,
                    poisoned:   t.status.poisoned   > 0,
                    boosted:    t.status.boosted    > 0,
                }).collect(),
                bullets: self.bullets.iter().filter(|b| b.active).map(|b| {
                    let (vx, vy) = b.facing.delta();
                    BulletSnapshot { id: b.id, x: b.pixel_x(), y: b.pixel_y(), owner_id: b.owner, vx, vy }
                }).collect(),
                stars: self.stars.iter().map(|s| StarSnapshot {
                    x: s.x as f64 * physics::TILE_SIZE + physics::TILE_SIZE / 2.0,
                    y: s.y as f64 * physics::TILE_SIZE + physics::TILE_SIZE / 2.0,
                }).collect(),
                destroyed_mounds: self.destroyed_mounds.clone(),
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
                    // 同归于尽：先比分数；分数相同则比 JS 平均耗时（越低越好）
                    let max_score = self.agents.iter().map(|(t, _)| t.score).max().unwrap_or(0);
                    let top: Vec<(usize, u64)> = self.agents.iter().enumerate()
                        .filter(|(_, (t, _))| t.score == max_score)
                        .map(|(i, (_, sb))| (i, sb.stats().avg_exec_us))
                        .collect();
                    if top.len() == 1 {
                        let t = &self.agents[top[0].0].0;
                        winner       = t.name.clone();
                        winner_label = format!("{} (同归于尽·最高分)", t.name);
                        winner_team  = None;
                    } else {
                        // 分数相同：先比错误数，再比平均耗时，均一致才平局
                        let top_with_stats: Vec<(usize, u32, u64)> = self.agents.iter().enumerate()
                            .filter(|(_, (t, _))| t.score == max_score)
                            .map(|(i, (_, sb))| {
                                let s = sb.stats();
                                (i, s.error_count, s.avg_exec_us)
                            })
                            .collect();
                        let min_err = top_with_stats.iter().map(|(_, e, _)| *e).min().unwrap();
                        let after_err: Vec<_> = top_with_stats.iter().filter(|(_, e, _)| *e == min_err).collect();
                        let min_us = after_err.iter().map(|(_, _, us)| *us).min().unwrap();
                        let finalists: Vec<_> = after_err.iter().filter(|(_, _, us)| *us == min_us).collect();
                        if finalists.len() == 1 {
                            let t = &self.agents[finalists[0].0].0;
                            winner       = t.name.clone();
                            winner_label = format!("{} (同归于尽·JS效率更高)", t.name);
                            winner_team  = None;
                        } else {
                            winner       = "无".into();
                            winner_label = "平局 (同归于尽·分数与效率均相同)".into();
                            winner_team  = None;
                        }
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
