/// 贪吃蛇竞技场仿真引擎

use std::collections::VecDeque;
use serde::{Deserialize, Serialize};
use rquickjs::{Array, Context, Function, Object, Runtime, Value};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;
use std::cell::Cell;

use crate::physics::{self, Facing, Tile, GRID_W, GRID_H};
use crate::battle::ArenaConfig;

const SNAKE_MAX_TURNS: u32 = 500;
const SNAKE_FOOD_MAX:  usize = 3;
const SNAKE_INIT_LEN:  usize = 3;

const MAX_MEMORY_BYTES: usize = 2 * 1024 * 1024;
const MAX_STACK_BYTES:  usize = 256 * 1024;
const MAX_EXEC_MS: u128 = 10;

thread_local! {
    static SNAKE_JS_TIMER: Cell<Option<Instant>> = const { Cell::new(None) };
}

fn reset_timer() { SNAKE_JS_TIMER.with(|c| c.set(Some(Instant::now()))); }
fn clear_timer() { SNAKE_JS_TIMER.with(|c| c.set(None)); }
fn is_timed_out() -> bool {
    SNAKE_JS_TIMER.with(|c| c.get().map(|t| t.elapsed().as_millis() >= MAX_EXEC_MS).unwrap_or(false))
}

const SNAKE_INFRA_JS: &str = r#"
var __dir = null;
var __logs = [];
function print() {
    var a = [];
    for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i]));
    __logs.push(a.join(' '));
}
var me = {
    head: [0, 0],
    body: [],
    direction: "east",
    length: 1,
    score: 0,
    setDir: function(d) {
        if (d === "north" || d === "east" || d === "south" || d === "west") __dir = d;
    }
};
var others = [];
var game = { map: [], food: [], tick: 0 };
"#;

// ─── 遥测结构 ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnakeSnapshot {
    pub id: usize,
    pub name: String,
    pub body: Vec<[usize; 2]>,
    pub alive: bool,
    pub score: u32,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnakeFrame {
    pub tick: u32,
    pub snakes: Vec<SnakeSnapshot>,
    pub food: Vec<[usize; 2]>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SnakeResult {
    pub winner: String,
    pub winner_label: String,
    pub total_ticks: u32,
    pub timed_out: bool,
    pub arena: ArenaConfig,
    pub telemetry: Vec<SnakeFrame>,
    pub battle_log: Vec<String>,
}

// ─── 蛇状态 ──────────────────────────────────────────────────────────────────

struct SnakeState {
    id: usize,
    name: String,
    body: VecDeque<(usize, usize)>,
    direction: Facing,
    alive: bool,
    score: u32,
}

impl SnakeState {
    fn head(&self) -> (usize, usize) {
        *self.body.front().expect("蛇身不能为空")
    }

    fn to_snapshot(&self) -> SnakeSnapshot {
        SnakeSnapshot {
            id: self.id,
            name: self.name.clone(),
            body: self.body.iter().map(|&(x, y)| [x, y]).collect(),
            alive: self.alive,
            score: self.score,
            direction: self.direction.as_str().to_string(),
        }
    }
}

// ─── JS 沙箱 ─────────────────────────────────────────────────────────────────

struct SnakeSandbox {
    #[allow(dead_code)]
    runtime: Runtime,
    context: Context,
    name: String,
    error_count: AtomicU32,
}

impl SnakeSandbox {
    fn new(name: &str, code: &str) -> Result<Self, String> {
        let runtime = Runtime::new()
            .map_err(|e| format!("[{}] Runtime 失败: {e}", name))?;
        runtime.set_memory_limit(MAX_MEMORY_BYTES);
        runtime.set_max_stack_size(MAX_STACK_BYTES);
        runtime.set_interrupt_handler(Some(Box::new(|| is_timed_out())));

        let context = Context::full(&runtime)
            .map_err(|e| format!("[{}] Context 失败: {e}", name))?;

        clear_timer();

        context.with(|ctx| {
            ctx.eval::<(), _>(SNAKE_INFRA_JS)
                .map_err(|e| format!("[{}] 基础设施初始化失败: {e}", name))?;
            ctx.eval::<(), _>(code)
                .map_err(|e| format!("[{}] JS 编译错误: {e}", name))
        })?;

        Ok(Self {
            runtime,
            context,
            name: name.to_string(),
            error_count: AtomicU32::new(0),
        })
    }

    fn act(
        &self,
        me: &SnakeSnapshot,
        others: &[&SnakeSnapshot],
        map: &physics::Map,
        food: &[(usize, usize)],
        tick: u32,
    ) -> (Option<Facing>, Vec<String>) {
        reset_timer();

        let result = self.context.with(|ctx| -> Result<(Option<Facing>, Vec<String>), String> {
            let globals = ctx.globals();

            ctx.eval::<(), _>("__dir = null; __logs = [];")
                .map_err(|e| e.to_string())?;

            // 更新 me
            let me_obj: Object = globals.get("me").map_err(|e| e.to_string())?;

            if !me.body.is_empty() {
                let head_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                head_arr.set(0, me.body[0][0] as i32).map_err(|e| e.to_string())?;
                head_arr.set(1, me.body[0][1] as i32).map_err(|e| e.to_string())?;
                me_obj.set("head", head_arr).map_err(|e| e.to_string())?;
            }

            let body_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (i, seg) in me.body.iter().enumerate() {
                let sa = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                sa.set(0, seg[0] as i32).map_err(|e| e.to_string())?;
                sa.set(1, seg[1] as i32).map_err(|e| e.to_string())?;
                body_arr.set(i, sa).map_err(|e| e.to_string())?;
            }
            me_obj.set("body", body_arr).map_err(|e| e.to_string())?;
            me_obj.set("direction", me.direction.as_str()).map_err(|e| e.to_string())?;
            me_obj.set("length", me.body.len() as i32).map_err(|e| e.to_string())?;
            me_obj.set("score", me.score as i32).map_err(|e| e.to_string())?;

            // 更新 others
            let others_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            let mut oi = 0usize;
            for s in others.iter().filter(|s| s.alive) {
                let s_obj = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                if !s.body.is_empty() {
                    let h = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                    h.set(0, s.body[0][0] as i32).map_err(|e| e.to_string())?;
                    h.set(1, s.body[0][1] as i32).map_err(|e| e.to_string())?;
                    s_obj.set("head", h).map_err(|e| e.to_string())?;
                }
                let b_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                for (j, seg) in s.body.iter().enumerate() {
                    let sa = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                    sa.set(0, seg[0] as i32).map_err(|e| e.to_string())?;
                    sa.set(1, seg[1] as i32).map_err(|e| e.to_string())?;
                    b_arr.set(j, sa).map_err(|e| e.to_string())?;
                }
                s_obj.set("body", b_arr).map_err(|e| e.to_string())?;
                s_obj.set("direction", s.direction.as_str()).map_err(|e| e.to_string())?;
                s_obj.set("length", s.body.len() as i32).map_err(|e| e.to_string())?;
                s_obj.set("score", s.score as i32).map_err(|e| e.to_string())?;
                others_arr.set(oi, s_obj).map_err(|e| e.to_string())?;
                oi += 1;
            }
            globals.set("others", others_arr).map_err(|e| e.to_string())?;

            // 更新 game
            let game_obj: Object = globals.get("game").map_err(|e| e.to_string())?;

            let map_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (r, row) in map.iter().enumerate() {
                let row_str: String = row.iter().map(|t| t.to_char()).collect();
                map_arr.set(r, row_str).map_err(|e| e.to_string())?;
            }
            game_obj.set("map", map_arr).map_err(|e| e.to_string())?;

            let food_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (i, &(fx, fy)) in food.iter().enumerate() {
                let fa = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                fa.set(0, fx as i32).map_err(|e| e.to_string())?;
                fa.set(1, fy as i32).map_err(|e| e.to_string())?;
                food_arr.set(i, fa).map_err(|e| e.to_string())?;
            }
            game_obj.set("food", food_arr).map_err(|e| e.to_string())?;
            game_obj.set("tick", tick as i32).map_err(|e| e.to_string())?;

            // 调用 onIdle(me, others, game)
            let on_idle: Function = globals.get("onIdle")
                .map_err(|_| "onIdle() 函数未定义".to_string())?;

            let me_val:     Value = globals.get("me").map_err(|e| e.to_string())?;
            let others_val: Value = globals.get("others").map_err(|e| e.to_string())?;
            let game_val:   Value = globals.get("game").map_err(|e| e.to_string())?;

            on_idle.call::<_, ()>((me_val, others_val, game_val))
                .map_err(|e| format!("onIdle() 执行错误: {e}"))?;

            // 读取 __dir
            let dir_val: Value = globals.get("__dir").map_err(|e| e.to_string())?;
            let new_dir = if let Some(s) = dir_val.as_string().and_then(|s| s.to_string().ok()) {
                match s.as_str() {
                    "north" => Some(Facing::North),
                    "east"  => Some(Facing::East),
                    "south" => Some(Facing::South),
                    "west"  => Some(Facing::West),
                    _       => None,
                }
            } else {
                None
            };

            // 读取 __logs
            let logs_arr: Array = globals.get("__logs").map_err(|e| e.to_string())?;
            let mut logs = Vec::new();
            for i in 0..logs_arr.len() {
                let v: Value = logs_arr.get(i).unwrap_or(Value::new_null(ctx.clone()));
                if let Some(s) = v.as_string().and_then(|s| s.to_string().ok()) {
                    logs.push(s);
                }
            }

            Ok((new_dir, logs))
        });

        match result {
            Ok(pair) => pair,
            Err(e) => {
                let prev = self.error_count.fetch_add(1, Ordering::Relaxed);
                if prev == 0 || prev % 100 == 99 {
                    eprintln!("[蛇沙箱/{}] 降级空转: {}", self.name, e);
                }
                (None, Vec::new())
            }
        }
    }
}

// ─── 引擎 ────────────────────────────────────────────────────────────────────

pub struct SnakeEngine {
    snakes: Vec<(SnakeState, SnakeSandbox)>,
    map:    physics::Map,
    food:   Vec<(usize, usize)>,
    rng:    u64,
}

impl SnakeEngine {
    fn next_rand(&mut self) -> f64 {
        self.rng = self.rng
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.rng >> 33) as f64 / u32::MAX as f64
    }

    fn try_spawn_food(&mut self) {
        if self.food.len() >= SNAKE_FOOD_MAX { return; }
        let occupied: Vec<(usize, usize)> = self.food.iter().copied()
            .chain(self.snakes.iter().flat_map(|(s, _)| s.body.iter().copied()))
            .collect();
        for _ in 0..200 {
            let x = 1 + (self.next_rand() * (GRID_W - 2) as f64) as usize;
            let y = 1 + (self.next_rand() * (GRID_H - 2) as f64) as usize;
            if self.map[y][x] == Tile::Floor && !occupied.contains(&(x, y)) {
                self.food.push((x, y));
                return;
            }
        }
    }

    pub fn new(specs: Vec<(&str, &str)>) -> Result<Self, String> {
        let map = physics::init_map();

        // 4 个角落对称起点（头坐标 + 朝向），行1和行18保证全地板
        let starts: &[(usize, usize, Facing)] = &[
            (3,  1,  Facing::East),
            (16, 18, Facing::West),
            (16, 1,  Facing::West),
            (3,  18, Facing::East),
        ];

        let snakes = specs
            .into_iter()
            .enumerate()
            .map(|(id, (name, code))| {
                let (sx, sy, dir) = starts.get(id).copied()
                    .unwrap_or((3 + id * 3, 1, Facing::East));

                let opp = dir.turn_left().turn_left();
                let (odx, ody) = opp.delta();

                let mut body = VecDeque::new();
                body.push_back((sx, sy));
                for step in 1..SNAKE_INIT_LEN {
                    let nx = (sx as i32 + odx * step as i32).max(0) as usize;
                    let ny = (sy as i32 + ody * step as i32).max(0) as usize;
                    if nx < GRID_W && ny < GRID_H && map[ny][nx] == Tile::Floor {
                        body.push_back((nx, ny));
                    }
                }

                let state = SnakeState { id, name: name.to_string(), body, direction: dir, alive: true, score: 0 };
                let sandbox = SnakeSandbox::new(name, code)?;
                Ok((state, sandbox))
            })
            .collect::<Result<Vec<_>, String>>()?;

        let rng = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;

        let mut engine = Self { snakes, map, food: Vec::new(), rng };
        for _ in 0..SNAKE_FOOD_MAX { engine.try_spawn_food(); }
        Ok(engine)
    }

    pub fn run(mut self) -> SnakeResult {
        let mut telemetry:  Vec<SnakeFrame> = Vec::new();
        let mut battle_log: Vec<String>     = Vec::new();
        let names: Vec<String> = self.snakes.iter().map(|(s, _)| s.name.clone()).collect();
        let n = self.snakes.len();

        battle_log.push(format!("═══ 贪吃蛇竞技场开始，共 {} 条蛇 ═══", n));
        for (s, _) in &self.snakes {
            battle_log.push(format!("  [{}] 出生于 ({},{})", s.name, s.head().0, s.head().1));
        }

        let arena_config = ArenaConfig {
            width: GRID_W, height: GRID_H,
            map: physics::map_to_strings(&self.map),
        };

        let mut winner       = String::new();
        let mut winner_label = String::new();
        let mut final_tick   = SNAKE_MAX_TURNS;
        let mut timed_out    = false;

        'sim: for tick in 0..SNAKE_MAX_TURNS {
            self.try_spawn_food();

            // 生成快照避免借用冲突
            let snapshots: Vec<SnakeSnapshot> = self.snakes.iter().map(|(s, _)| s.to_snapshot()).collect();
            let food_clone = self.food.clone();

            // 调用 JS 收集新方向
            let mut new_dirs = vec![None::<Facing>; n];
            for i in 0..n {
                if !self.snakes[i].0.alive { continue; }
                let others: Vec<&SnakeSnapshot> = snapshots.iter().enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, s)| s)
                    .collect();
                let (dir, logs) = self.snakes[i].1.act(&snapshots[i], &others, &self.map, &food_clone, tick);
                new_dirs[i] = dir;
                for log in logs {
                    battle_log.push(format!("[Turn {:04}][{}] {}", tick, names[i], log));
                }
            }

            // 应用方向（禁止 180° 反转）
            for i in 0..n {
                if !self.snakes[i].0.alive { continue; }
                if let Some(new_dir) = new_dirs[i] {
                    let cur = self.snakes[i].0.direction;
                    if new_dir != cur.turn_left().turn_left() {
                        self.snakes[i].0.direction = new_dir;
                    }
                }
            }

            // 计算新头部（越界或撞墙 → None）
            let mut new_heads: Vec<Option<(usize, usize)>> = Vec::with_capacity(n);
            for (snake, _) in &self.snakes {
                if !snake.alive { new_heads.push(None); continue; }
                let (hx, hy) = snake.head();
                let (dx, dy) = snake.direction.delta();
                let nx = hx as i32 + dx;
                let ny = hy as i32 + dy;
                if nx < 0 || ny < 0 || nx >= GRID_W as i32 || ny >= GRID_H as i32 {
                    new_heads.push(None);
                } else {
                    let (nx, ny) = (nx as usize, ny as usize);
                    match self.map[ny][nx] {
                        Tile::Wall | Tile::Mound => new_heads.push(None),
                        _ => new_heads.push(Some((nx, ny))),
                    }
                }
            }

            // 头碰头检测
            let mut head_died = vec![false; n];
            for i in 0..n {
                for j in (i + 1)..n {
                    if new_heads[i].is_some() && new_heads[i] == new_heads[j] {
                        head_died[i] = true;
                        head_died[j] = true;
                    }
                }
            }

            // 判断哪些蛇能吃到食物
            let mut ate_food = vec![false; n];
            for i in 0..n {
                if !self.snakes[i].0.alive || head_died[i] { continue; }
                if let Some(head) = new_heads[i] {
                    if self.food.contains(&head) { ate_food[i] = true; }
                }
            }

            // 蛇体碰撞检测
            let mut body_died = vec![false; n];
            for i in 0..n {
                let Some(head_i) = new_heads[i] else { continue };
                if !self.snakes[i].0.alive || head_died[i] { continue; }

                'outer: for j in 0..n {
                    if !self.snakes[j].0.alive { continue; }
                    let body_j = &self.snakes[j].0.body;
                    // j 是否在本帧移动（new_heads[j] 有效 && 不头碰头死亡）
                    let j_moves = new_heads[j].is_some() && !head_died[j];
                    // j 本帧有效身体长度（移动后尾部缩短，除非吃到食物）
                    let end = if j_moves && !ate_food[j] {
                        body_j.len().saturating_sub(1)
                    } else {
                        body_j.len()
                    };
                    if body_j.iter().take(end).any(|&cell| cell == head_i) {
                        body_died[i] = true;
                        break 'outer;
                    }
                }
            }

            // 应用移动 & 死亡
            for i in 0..n {
                let (snake, _) = &mut self.snakes[i];
                if !snake.alive { continue; }

                let died = new_heads[i].is_none() || head_died[i] || body_died[i];
                if died {
                    snake.alive = false;
                    let reason = if new_heads[i].is_none() { "撞墙" }
                        else if head_died[i] { "头碰头" }
                        else { "撞蛇体" };
                    battle_log.push(format!("[Turn {:04}] {} 死亡（{}）！", tick, snake.name, reason));
                } else {
                    let head = new_heads[i].unwrap();
                    snake.body.push_front(head);
                    if ate_food[i] {
                        snake.score += 1;
                        battle_log.push(format!(
                            "[Turn {:04}] {} 吃到食物！长度 {} 分数 {}",
                            tick, snake.name, snake.body.len(), snake.score
                        ));
                    } else {
                        snake.body.pop_back();
                    }
                }
            }

            // 移除被成功吃掉的食物
            for i in 0..n {
                if ate_food[i] && self.snakes[i].0.alive {
                    if let Some(head) = new_heads[i] {
                        self.food.retain(|&f| f != head);
                    }
                }
            }

            // 记帧
            telemetry.push(SnakeFrame {
                tick,
                snakes: self.snakes.iter().map(|(s, _)| s.to_snapshot()).collect(),
                food:   self.food.iter().map(|&(x, y)| [x, y]).collect(),
            });

            // 胜负判断
            let alive_count = self.snakes.iter().filter(|(s, _)| s.alive).count();
            if alive_count <= 1 {
                final_tick = tick + 1;
                if let Some((s, _)) = self.snakes.iter().find(|(s, _)| s.alive) {
                    winner       = s.name.clone();
                    winner_label = format!("{} 🏆", s.name);
                } else {
                    if let Some((s, _)) = self.snakes.iter().max_by_key(|(s, _)| (s.score, s.body.len())) {
                        winner       = s.name.clone();
                        winner_label = format!("{} (同归于尽·最高分)", s.name);
                    } else {
                        winner = "无".into(); winner_label = "无".into();
                    }
                }
                battle_log.push(format!("[Turn {:04}] 比赛结束！胜者: {}", tick, winner_label));
                break 'sim;
            }
        }

        if winner.is_empty() {
            timed_out = true;
            if let Some((s, _)) = self.snakes.iter()
                .filter(|(s, _)| s.alive)
                .max_by_key(|(s, _)| (s.score, s.body.len()))
            {
                winner       = s.name.clone();
                winner_label = format!("{} (时间到·最高分)", s.name);
            } else {
                winner = "无".into(); winner_label = "无".into();
            }
            battle_log.push(format!("达到最大回合 ({})，判定胜者: {}", SNAKE_MAX_TURNS, winner_label));
        }

        battle_log.push("═══ 贪吃蛇竞技场结束 ═══".to_string());

        SnakeResult { winner, winner_label, total_ticks: final_tick, timed_out, arena: arena_config, telemetry, battle_log }
    }
}
