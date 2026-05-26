/// 炸弹人竞技场仿真引擎

use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use rquickjs::{Array, Context, Function, Object, Runtime, Value};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;
use std::cell::Cell;

// ─── 常量 ─────────────────────────────────────────────────────────────────────

pub const GRID: usize = 13;
const MAX_TURNS: u32 = 300;
const BOMB_FUSE: u32 = 3;
const BOMB_RANGE_INIT: u32 = 2;
const MAX_BOMBS_INIT: u32 = 1;
const MAX_MEMORY_BYTES: usize = 2 * 1024 * 1024;
const MAX_STACK_BYTES: usize = 256 * 1024;
const MAX_EXEC_MS: u128 = 10;

// ─── 内置 Bot 代码 ───────────────────────────────────────────────────────────

pub(crate) const RANDOM_BOT_JS: &str = r#"
function onIdle(me, others, game) {
    var dirs = ["north", "south", "east", "west"];
    var t = game.tick;
    // 简单伪随机（基于 tick 和位置）
    var seed = t * 7 + me.position[0] * 13 + me.position[1] * 17;
    function rand(max) { seed = (seed * 1664525 + 1013904223) & 0x7fffffff; return seed % max; }

    // 30% 概率放炸弹
    if (me.bomb_count < me.max_bombs && rand(10) < 3) {
        me.bomb();
        return;
    }
    // 随机移动
    var start = rand(4);
    for (var i = 0; i < 4; i++) {
        me.move(dirs[(start + i) % 4]);
        return;
    }
}
"#;

pub(crate) const CHASER_BOT_JS: &str = r#"
function onIdle(me, others, game) {
    if (!others || others.length === 0) return;
    var target = others[0];
    var dx = target.position[0] - me.position[0];
    var dy = target.position[1] - me.position[1];

    // 如果相邻（曼哈顿距离<=2），放炸弹
    if (Math.abs(dx) + Math.abs(dy) <= 2 && me.bomb_count < me.max_bombs) {
        me.bomb();
        return;
    }

    // 移向目标
    var dirs = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx > 0) dirs.push("east"); else if (dx < 0) dirs.push("west");
        if (dy > 0) dirs.push("south"); else if (dy < 0) dirs.push("north");
    } else {
        if (dy > 0) dirs.push("south"); else if (dy < 0) dirs.push("north");
        if (dx > 0) dirs.push("east"); else if (dx < 0) dirs.push("west");
    }
    dirs.push("north"); dirs.push("east"); dirs.push("south"); dirs.push("west");

    // 去重
    var seen = {};
    for (var i = 0; i < dirs.length; i++) {
        if (!seen[dirs[i]]) { seen[dirs[i]] = true; me.move(dirs[i]); return; }
    }
}
"#;

// ─── JS 基础设施 ──────────────────────────────────────────────────────────────

const INFRA_JS: &str = r#"
var __action = null;
var __logs = [];
function print() {
    var a = [];
    for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i]));
    __logs.push(a.join(' '));
}
var me = {
    position: [0, 0],
    alive: true,
    bomb_count: 0,
    max_bombs: 1,
    bomb_range: 2,
    score: 0,
    move: function(dir) {
        if (dir === "north" || dir === "east" || dir === "south" || dir === "west")
            __action = { type: "move", dir: dir };
    },
    bomb: function() { __action = { type: "bomb" }; }
};
var others = [];
var game = { map: [], bombs: [], items: [], tick: 0 };
"#;

// ─── 计时器（线程本地） ────────────────────────────────────────────────────────

thread_local! {
    static BOMBER_JS_TIMER: Cell<Option<Instant>> = const { Cell::new(None) };
}

fn reset_timer() { BOMBER_JS_TIMER.with(|c| c.set(Some(Instant::now()))); }
fn clear_timer() { BOMBER_JS_TIMER.with(|c| c.set(None)); }
fn is_timed_out() -> bool {
    BOMBER_JS_TIMER.with(|c| c.get().map(|t| t.elapsed().as_millis() >= MAX_EXEC_MS).unwrap_or(false))
}

// ─── 遥测结构 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BomberSnapshot {
    pub id: usize,
    pub name: String,
    pub position: [usize; 2],
    pub alive: bool,
    pub score: u32,
    pub bomb_count: u32,
    pub max_bombs: u32,
    pub bomb_range: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BombSnapshot {
    pub position: [usize; 2],
    pub owner: usize,
    pub fuse: u32,
    pub range: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemSnapshot {
    pub position: [usize; 2],
    pub item_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BomberFrame {
    pub tick: u32,
    pub players: Vec<BomberSnapshot>,
    pub bombs: Vec<BombSnapshot>,
    pub items: Vec<ItemSnapshot>,
    pub explosions: Vec<[usize; 2]>,
    pub map: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BombermanResult {
    pub winner: String,
    pub winner_label: String,
    pub total_ticks: u32,
    pub timed_out: bool,
    pub map: Vec<String>,
    pub telemetry: Vec<BomberFrame>,
    pub battle_log: Vec<String>,
}

// ─── 内部状态结构 ─────────────────────────────────────────────────────────────

struct BomberState {
    id: usize,
    name: String,
    pos: (usize, usize),
    alive: bool,
    score: u32,
    bomb_count: u32,
    max_bombs: u32,
    bomb_range: u32,
}

impl BomberState {
    fn to_snapshot(&self) -> BomberSnapshot {
        BomberSnapshot {
            id: self.id,
            name: self.name.clone(),
            position: [self.pos.0, self.pos.1],
            alive: self.alive,
            score: self.score,
            bomb_count: self.bomb_count,
            max_bombs: self.max_bombs,
            bomb_range: self.bomb_range,
        }
    }
}

struct BombState {
    pos: (usize, usize),
    owner: usize,
    fuse: u32,
    range: u32,
}

impl BombState {
    fn to_snapshot(&self) -> BombSnapshot {
        BombSnapshot {
            position: [self.pos.0, self.pos.1],
            owner: self.owner,
            fuse: self.fuse,
            range: self.range,
        }
    }
}

#[derive(Clone, Copy)]
enum ItemKind {
    FireUp,
    BombUp,
}

struct ItemState {
    pos: (usize, usize),
    kind: ItemKind,
}

impl ItemState {
    fn to_snapshot(&self) -> ItemSnapshot {
        ItemSnapshot {
            position: [self.pos.0, self.pos.1],
            item_type: match self.kind {
                ItemKind::FireUp => "F".to_string(),
                ItemKind::BombUp => "B".to_string(),
            },
        }
    }
}

#[derive(Clone)]
enum Action {
    Move(i32, i32),
    PlaceBomb,
    Wait,
}

// ─── JS 沙箱 ──────────────────────────────────────────────────────────────────

struct BomberSandbox {
    #[allow(dead_code)]
    runtime: Runtime,
    context: Context,
    name: String,
    error_count: AtomicU32,
}

impl BomberSandbox {
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
            ctx.eval::<(), _>(INFRA_JS)
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
        me: &BomberSnapshot,
        others: &[&BomberSnapshot],
        map: &[Vec<char>],
        bombs: &[BombSnapshot],
        items: &[ItemSnapshot],
        tick: u32,
    ) -> (Action, Vec<String>) {
        reset_timer();

        let result = self.context.with(|ctx| -> Result<(Action, Vec<String>), String> {
            let globals = ctx.globals();

            ctx.eval::<(), _>("__action = null; __logs = [];")
                .map_err(|e| e.to_string())?;

            // 更新 me
            let me_obj: Object = globals.get("me").map_err(|e| e.to_string())?;

            let pos_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            pos_arr.set(0, me.position[0] as i32).map_err(|e| e.to_string())?;
            pos_arr.set(1, me.position[1] as i32).map_err(|e| e.to_string())?;
            me_obj.set("position", pos_arr).map_err(|e| e.to_string())?;
            me_obj.set("alive", me.alive).map_err(|e| e.to_string())?;
            me_obj.set("bomb_count", me.bomb_count as i32).map_err(|e| e.to_string())?;
            me_obj.set("max_bombs", me.max_bombs as i32).map_err(|e| e.to_string())?;
            me_obj.set("bomb_range", me.bomb_range as i32).map_err(|e| e.to_string())?;
            me_obj.set("score", me.score as i32).map_err(|e| e.to_string())?;

            // 更新 others
            let others_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (i, s) in others.iter().enumerate() {
                if !s.alive { continue; }
                let s_obj = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                let p = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                p.set(0, s.position[0] as i32).map_err(|e| e.to_string())?;
                p.set(1, s.position[1] as i32).map_err(|e| e.to_string())?;
                s_obj.set("position", p).map_err(|e| e.to_string())?;
                s_obj.set("alive", s.alive).map_err(|e| e.to_string())?;
                s_obj.set("score", s.score as i32).map_err(|e| e.to_string())?;
                s_obj.set("bomb_count", s.bomb_count as i32).map_err(|e| e.to_string())?;
                s_obj.set("bomb_range", s.bomb_range as i32).map_err(|e| e.to_string())?;
                others_arr.set(i, s_obj).map_err(|e| e.to_string())?;
            }
            globals.set("others", others_arr).map_err(|e| e.to_string())?;

            // 更新 game
            let game_obj: Object = globals.get("game").map_err(|e| e.to_string())?;

            // map 行字符串
            let map_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (r, row) in map.iter().enumerate() {
                let row_str: String = row.iter().collect();
                map_arr.set(r, row_str).map_err(|e| e.to_string())?;
            }
            game_obj.set("map", map_arr).map_err(|e| e.to_string())?;

            // bombs
            let bombs_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (i, b) in bombs.iter().enumerate() {
                let b_obj = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                let bp = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                bp.set(0, b.position[0] as i32).map_err(|e| e.to_string())?;
                bp.set(1, b.position[1] as i32).map_err(|e| e.to_string())?;
                b_obj.set("position", bp).map_err(|e| e.to_string())?;
                b_obj.set("fuse", b.fuse as i32).map_err(|e| e.to_string())?;
                b_obj.set("range", b.range as i32).map_err(|e| e.to_string())?;
                bombs_arr.set(i, b_obj).map_err(|e| e.to_string())?;
            }
            game_obj.set("bombs", bombs_arr).map_err(|e| e.to_string())?;

            // items
            let items_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (i, it) in items.iter().enumerate() {
                let it_obj = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                let ip = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                ip.set(0, it.position[0] as i32).map_err(|e| e.to_string())?;
                ip.set(1, it.position[1] as i32).map_err(|e| e.to_string())?;
                it_obj.set("position", ip).map_err(|e| e.to_string())?;
                it_obj.set("type", it.item_type.as_str()).map_err(|e| e.to_string())?;
                items_arr.set(i, it_obj).map_err(|e| e.to_string())?;
            }
            game_obj.set("items", items_arr).map_err(|e| e.to_string())?;
            game_obj.set("tick", tick as i32).map_err(|e| e.to_string())?;

            // 调用 onIdle(me, others, game)
            let on_idle: Function = globals.get("onIdle")
                .map_err(|_| "onIdle() 函数未定义".to_string())?;

            let me_val:     Value = globals.get("me").map_err(|e| e.to_string())?;
            let others_val: Value = globals.get("others").map_err(|e| e.to_string())?;
            let game_val:   Value = globals.get("game").map_err(|e| e.to_string())?;

            on_idle.call::<_, ()>((me_val, others_val, game_val))
                .map_err(|e| format!("onIdle() 执行错误: {e}"))?;

            // 读取 __action
            let action_val: Value = globals.get("__action").map_err(|e| e.to_string())?;
            let action = if action_val.is_null() || action_val.is_undefined() {
                Action::Wait
            } else if let Some(obj) = action_val.as_object() {
                let type_val: Value = obj.get("type").unwrap_or(Value::new_null(ctx.clone()));
                let type_str = type_val.as_string().and_then(|s| s.to_string().ok()).unwrap_or_default();
                match type_str.as_str() {
                    "move" => {
                        let dir_val: Value = obj.get("dir").unwrap_or(Value::new_null(ctx.clone()));
                        let dir_str = dir_val.as_string().and_then(|s| s.to_string().ok()).unwrap_or_default();
                        match dir_str.as_str() {
                            "north" => Action::Move(0, -1),
                            "south" => Action::Move(0, 1),
                            "east"  => Action::Move(1, 0),
                            "west"  => Action::Move(-1, 0),
                            _       => Action::Wait,
                        }
                    }
                    "bomb" => Action::PlaceBomb,
                    _      => Action::Wait,
                }
            } else {
                Action::Wait
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

            Ok((action, logs))
        });

        match result {
            Ok(pair) => pair,
            Err(e) => {
                let prev = self.error_count.fetch_add(1, Ordering::Relaxed);
                if prev == 0 || prev % 100 == 99 {
                    eprintln!("[炸弹人沙箱/{}] 降级空转: {}", self.name, e);
                }
                (Action::Wait, Vec::new())
            }
        }
    }
}

// ─── 引擎 ─────────────────────────────────────────────────────────────────────

pub struct BombermanEngine {
    players: Vec<(BomberState, BomberSandbox)>,
    map: Vec<Vec<char>>,
    bombs: Vec<BombState>,
    items: Vec<ItemState>,
    rng: u64,
}

impl BombermanEngine {
    /// xorshift64 伪随机，返回 [0,1)
    fn next_rand(&mut self) -> f64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        (self.rng >> 33) as f64 / u32::MAX as f64
    }

    /// 生成 13×13 地图
    fn generate_map(rng: &mut u64) -> Vec<Vec<char>> {
        // 内联 xorshift64
        let mut rand = || -> f64 {
            *rng ^= *rng << 13;
            *rng ^= *rng >> 7;
            *rng ^= *rng << 17;
            (*rng >> 33) as f64 / u32::MAX as f64
        };

        let mut map = vec![vec!['.'; GRID]; GRID];

        // 边界设为永久墙
        for r in 0..GRID {
            for c in 0..GRID {
                if r == 0 || r == GRID - 1 || c == 0 || c == GRID - 1 {
                    map[r][c] = 'x';
                }
            }
        }

        // 内部偶数行偶数列（row%2==0 && col%2==0，非边界）也是永久墙
        for r in 1..GRID - 1 {
            for c in 1..GRID - 1 {
                if r % 2 == 0 && c % 2 == 0 {
                    map[r][c] = 'x';
                }
            }
        }

        // 4 个角落出生点保护区（以各角落为中心，各 3 格不放砖块）
        // 出生点：(1,1), (GRID-2,1), (1,GRID-2), (GRID-2,GRID-2)
        // 保护格：出生点本身 + 向内两格
        let corners = [
            (1usize, 1usize),
            (GRID - 2, 1),
            (1, GRID - 2),
            (GRID - 2, GRID - 2),
        ];
        let mut protected: HashSet<(usize, usize)> = HashSet::new();
        for &(cx, cy) in &corners {
            // 保护出生点及相邻向内两格（十字形）
            protected.insert((cx, cy));
            // 横向两格
            if cx == 1 {
                protected.insert((cx + 1, cy));
                protected.insert((cx + 2, cy));
            } else {
                protected.insert((cx - 1, cy));
                protected.insert((cx - 2, cy));
            }
            // 纵向两格
            if cy == 1 {
                protected.insert((cx, cy + 1));
                protected.insert((cx, cy + 2));
            } else {
                protected.insert((cx, cy - 1));
                protected.insert((cx, cy - 2));
            }
        }

        // 其他空地 65% 概率放砖块
        for r in 1..GRID - 1 {
            for c in 1..GRID - 1 {
                if map[r][c] != '.' { continue; }
                if protected.contains(&(c, r)) { continue; }
                if rand() < 0.65 {
                    map[r][c] = 'm';
                }
            }
        }

        map
    }

    pub fn new(specs: Vec<(&str, &str)>) -> Result<Self, String> {
        let mut rng = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        // 确保 rng 不为 0（xorshift64 不能从 0 开始）
        if rng == 0 { rng = 0xdeadbeef_cafebabe; }

        let map = Self::generate_map(&mut rng);

        // 2 人出生位置
        let spawn_positions = [
            (1usize, 1usize),
            (GRID - 2, GRID - 2),
            (GRID - 2, 1),
            (1, GRID - 2),
        ];

        let players = specs
            .into_iter()
            .enumerate()
            .map(|(id, (name, code))| {
                let pos = spawn_positions.get(id).copied().unwrap_or((1 + id, 1));
                let state = BomberState {
                    id,
                    name: name.to_string(),
                    pos,
                    alive: true,
                    score: 0,
                    bomb_count: 0,
                    max_bombs: MAX_BOMBS_INIT,
                    bomb_range: BOMB_RANGE_INIT,
                };
                let sandbox = BomberSandbox::new(name, code)?;
                Ok((state, sandbox))
            })
            .collect::<Result<Vec<_>, String>>()?;

        Ok(Self {
            players,
            map,
            bombs: Vec::new(),
            items: Vec::new(),
            rng,
        })
    }

    /// 处理爆炸，返回 (所有爆炸格子, 被摧毁砖块格子)
    fn process_explosions(
        &mut self,
        _tick: u32,
        battle_log: &mut Vec<String>,
    ) -> (Vec<(usize, usize)>, Vec<(usize, usize)>) {
        // 收集 fuse==0 的炸弹索引
        let to_explode: Vec<usize> = self.bombs.iter().enumerate()
            .filter(|(_, b)| b.fuse == 0)
            .map(|(i, _)| i)
            .collect();

        if to_explode.is_empty() {
            return (Vec::new(), Vec::new());
        }

        let mut exploded_set: HashSet<usize> = to_explode.iter().copied().collect();
        let mut queue: Vec<usize> = to_explode.clone();

        let mut all_cells: HashSet<(usize, usize)> = HashSet::new();
        let mut brick_cells: Vec<(usize, usize)> = Vec::new();

        // BFS 连锁爆炸
        let mut qi = 0;
        while qi < queue.len() {
            let bi = queue[qi];
            qi += 1;

            let (bx, by) = self.bombs[bi].pos;
            let range = self.bombs[bi].range as usize;

            // 炸弹中心
            all_cells.insert((bx, by));

            // 4 方向扩散
            let dirs: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
            for (dx, dy) in dirs {
                for step in 1..=range {
                    let nx = bx as i32 + dx * step as i32;
                    let ny = by as i32 + dy * step as i32;
                    if nx < 0 || ny < 0 || nx >= GRID as i32 || ny >= GRID as i32 {
                        break;
                    }
                    let (nx, ny) = (nx as usize, ny as usize);
                    match self.map[ny][nx] {
                        'x' => break, // 永久墙，停止
                        'm' => {
                            // 可破坏砖块，加入两个列表，停止
                            brick_cells.push((nx, ny));
                            all_cells.insert((nx, ny));
                            break;
                        }
                        _ => {
                            // 空地
                            all_cells.insert((nx, ny));
                            // 检查该格是否有未爆炸的炸弹
                            for (ji, jb) in self.bombs.iter().enumerate() {
                                if jb.pos == (nx, ny) && !exploded_set.contains(&ji) {
                                    exploded_set.insert(ji);
                                    queue.push(ji);
                                }
                            }
                        }
                    }
                }
            }
        }

        // 摧毁砖块（去重）
        let mut seen_bricks: HashSet<(usize, usize)> = HashSet::new();
        brick_cells.retain(|&pos| seen_bricks.insert(pos));
        for &(bx, by) in &brick_cells {
            if self.map[by][bx] == 'm' {
                self.map[by][bx] = '.';
                battle_log.push(format!("  砖块 ({},{}) 被摧毁", bx, by));
            }
        }

        // 归还炸弹计数并删除已爆炸炸弹（用 u32::MAX 标记）
        for &bi in &exploded_set {
            let owner = self.bombs[bi].owner;
            self.bombs[bi].fuse = u32::MAX; // 标记待删除
            if let Some((s, _)) = self.players.iter_mut().find(|(s, _)| s.id == owner) {
                s.bomb_count = s.bomb_count.saturating_sub(1);
            }
        }
        self.bombs.retain(|b| b.fuse != u32::MAX);

        let all_cells_vec: Vec<(usize, usize)> = all_cells.into_iter().collect();
        (all_cells_vec, brick_cells)
    }

    /// 将地图转换为字符串列表
    fn map_to_strings(map: &[Vec<char>]) -> Vec<String> {
        map.iter().map(|row| row.iter().collect()).collect()
    }

    pub fn run(mut self) -> BombermanResult {
        let mut telemetry: Vec<BomberFrame> = Vec::new();
        let mut battle_log: Vec<String> = Vec::new();
        let names: Vec<String> = self.players.iter().map(|(s, _)| s.name.clone()).collect();
        let n = self.players.len();

        battle_log.push(format!("═══ 炸弹人竞技场开始，共 {} 名玩家 ═══", n));
        for (s, _) in &self.players {
            battle_log.push(format!("  [{}] 出生于 ({},{})", s.name, s.pos.0, s.pos.1));
        }

        let initial_map = Self::map_to_strings(&self.map);

        let mut winner = String::new();
        let mut winner_label = String::new();
        let mut final_tick = MAX_TURNS;
        let mut timed_out = false;

        'sim: for tick in 0..MAX_TURNS {
            // 1. 生成快照（避免借用冲突）
            let snapshots: Vec<BomberSnapshot> = self.players.iter().map(|(s, _)| s.to_snapshot()).collect();
            let bomb_snaps: Vec<BombSnapshot> = self.bombs.iter().map(|b| b.to_snapshot()).collect();
            let item_snaps: Vec<ItemSnapshot> = self.items.iter().map(|i| i.to_snapshot()).collect();

            // 2. 调用所有存活玩家的 JS act，收集 actions 和 logs
            let mut actions = vec![Action::Wait; n];
            for i in 0..n {
                if !self.players[i].0.alive { continue; }
                let others: Vec<&BomberSnapshot> = snapshots.iter().enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, s)| s)
                    .collect();
                let (action, logs) = self.players[i].1.act(
                    &snapshots[i],
                    &others,
                    &self.map,
                    &bomb_snaps,
                    &item_snaps,
                    tick,
                );
                actions[i] = action;
                for log in logs {
                    battle_log.push(format!("[Turn {:04}][{}] {}", tick, names[i], log));
                }
            }

            // 3. 执行移动
            for i in 0..n {
                if !self.players[i].0.alive { continue; }
                if let Action::Move(dx, dy) = actions[i] {
                    let (cx, cy) = self.players[i].0.pos;
                    let nx = cx as i32 + dx;
                    let ny = cy as i32 + dy;
                    if nx >= 0 && ny >= 0 && nx < GRID as i32 && ny < GRID as i32 {
                        let (nx, ny) = (nx as usize, ny as usize);
                        // 格子可通行：不是 'x' 或 'm'，且没有炸弹
                        let passable = matches!(self.map[ny][nx], '.' | 'o');
                        let has_bomb = self.bombs.iter().any(|b| b.pos == (nx, ny));
                        if passable && !has_bomb {
                            self.players[i].0.pos = (nx, ny);
                        }
                    }
                }
            }

            // 4. 放置炸弹
            for i in 0..n {
                if !self.players[i].0.alive { continue; }
                if let Action::PlaceBomb = actions[i] {
                    let pos = self.players[i].0.pos;
                    let bomb_count = self.players[i].0.bomb_count;
                    let max_bombs = self.players[i].0.max_bombs;
                    let range = self.players[i].0.bomb_range;
                    let has_bomb_here = self.bombs.iter().any(|b| b.pos == pos);
                    if bomb_count < max_bombs && !has_bomb_here {
                        self.players[i].0.bomb_count += 1;
                        self.bombs.push(BombState {
                            pos,
                            owner: i,
                            fuse: BOMB_FUSE,
                            range,
                        });
                        battle_log.push(format!(
                            "[Turn {:04}] {} 在 ({},{}) 放置炸弹",
                            tick, names[i], pos.0, pos.1
                        ));
                    }
                }
            }

            // 5. 炸弹倒计时
            for bomb in &mut self.bombs {
                if bomb.fuse > 0 {
                    bomb.fuse -= 1;
                }
            }

            // 6. 处理爆炸
            let (all_exploded, brick_cells) = self.process_explosions(tick, &mut battle_log);

            // 7. 道具掉落（在 brick_cells 中每格，25% 概率随机掉落 FireUp 或 BombUp）
            for &(bx, by) in &brick_cells {
                if self.next_rand() < 0.25 {
                    // 检查该格没有道具
                    let has_item = self.items.iter().any(|it| it.pos == (bx, by));
                    if !has_item {
                        let kind = if self.next_rand() < 0.5 { ItemKind::FireUp } else { ItemKind::BombUp };
                        self.items.push(ItemState { pos: (bx, by), kind });
                    }
                }
            }

            // 8. 检测玩家死亡
            let exploded_set: HashSet<(usize, usize)> = all_exploded.iter().copied().collect();
            for i in 0..n {
                if !self.players[i].0.alive { continue; }
                if exploded_set.contains(&self.players[i].0.pos) {
                    self.players[i].0.alive = false;
                    battle_log.push(format!(
                        "[Turn {:04}] {} 被炸弹击中死亡！",
                        tick, names[i]
                    ));
                }
            }

            // 9. 玩家捡道具
            let mut items_to_remove: Vec<usize> = Vec::new();
            for (item_idx, item) in self.items.iter().enumerate() {
                for (s, _) in self.players.iter_mut() {
                    if s.alive && s.pos == item.pos {
                        match item.kind {
                            ItemKind::FireUp => {
                                s.bomb_range += 1;
                                battle_log.push(format!(
                                    "[Turn {:04}] {} 捡到 FireUp，射程 -> {}",
                                    tick, s.name, s.bomb_range
                                ));
                            }
                            ItemKind::BombUp => {
                                s.max_bombs += 1;
                                battle_log.push(format!(
                                    "[Turn {:04}] {} 捡到 BombUp，最大炸弹数 -> {}",
                                    tick, s.name, s.max_bombs
                                ));
                            }
                        }
                        items_to_remove.push(item_idx);
                        break;
                    }
                }
            }
            // 逆序删除道具（避免索引偏移）
            items_to_remove.sort_unstable();
            items_to_remove.dedup();
            for idx in items_to_remove.into_iter().rev() {
                self.items.swap_remove(idx);
            }

            // 10. 记录遥测帧
            let current_map = Self::map_to_strings(&self.map);
            telemetry.push(BomberFrame {
                tick,
                players: self.players.iter().map(|(s, _)| s.to_snapshot()).collect(),
                bombs: self.bombs.iter().map(|b| b.to_snapshot()).collect(),
                items: self.items.iter().map(|i| i.to_snapshot()).collect(),
                explosions: all_exploded.iter().map(|&(x, y)| [x, y]).collect(),
                map: current_map,
            });

            // 11. 胜负判断（存活数 <= 1）
            let alive_count = self.players.iter().filter(|(s, _)| s.alive).count();
            if alive_count <= 1 {
                final_tick = tick + 1;
                if let Some((s, _)) = self.players.iter().find(|(s, _)| s.alive) {
                    winner = s.name.clone();
                    winner_label = format!("{} 获胜", s.name);
                } else {
                    // 全部同时死亡，按 score 判断
                    if let Some((s, _)) = self.players.iter().max_by_key(|(s, _)| s.score) {
                        winner = s.name.clone();
                        winner_label = format!("{} (同归于尽·最高分)", s.name);
                    } else {
                        winner = "无".into();
                        winner_label = "无".into();
                    }
                }
                battle_log.push(format!("[Turn {:04}] 比赛结束！胜者: {}", tick, winner_label));
                break 'sim;
            }
        }

        // 超时判断
        if winner.is_empty() {
            timed_out = true;
            if let Some((s, _)) = self.players.iter()
                .filter(|(s, _)| s.alive)
                .max_by_key(|(s, _)| s.score)
            {
                winner = s.name.clone();
                winner_label = format!("{} (时间到·最高分)", s.name);
            } else {
                winner = "无".into();
                winner_label = "无".into();
            }
            battle_log.push(format!("达到最大回合 ({})，判定胜者: {}", MAX_TURNS, winner_label));
        }

        battle_log.push("═══ 炸弹人竞技场结束 ═══".to_string());

        BombermanResult {
            winner,
            winner_label,
            total_ticks: final_tick,
            timed_out,
            map: initial_map,
            telemetry,
            battle_log,
        }
    }
}
