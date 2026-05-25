/// 坦克竞技场物理层（格子 + 回合制）

use std::collections::VecDeque;
use serde::{Deserialize, Serialize};

// ─── 地图常量 ──────────────────────────────────────────────────────────────
pub const GRID_W: usize = 20;
pub const GRID_H: usize = 20;
pub const TILE_SIZE: f64 = 40.0;

// ─── 游戏常量 ──────────────────────────────────────────────────────────────
pub const TANK_INIT_HP: i32 = 100;
pub const BULLET_DAMAGE: i32 = 25;
pub const MAX_TURNS: u32 = 300;
pub const BULLET_SPEED: usize = 2;
pub const STAR_SPAWN_INTERVAL: u32 = 30;
pub const STAR_MAX: usize = 3;

// ─── Tile ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum Tile {
    Floor,
    Wall,
    Mound,
    Grass,
}

impl Tile {
    pub fn from_char(c: char) -> Self {
        match c {
            'x' => Tile::Wall,
            'm' => Tile::Mound,
            'o' => Tile::Grass,
            _   => Tile::Floor,
        }
    }

    pub fn to_char(&self) -> char {
        match self {
            Tile::Floor => '.',
            Tile::Wall  => 'x',
            Tile::Mound => 'm',
            Tile::Grass => 'o',
        }
    }

    pub fn is_passable(&self) -> bool {
        matches!(self, Tile::Floor | Tile::Grass)
    }

    #[allow(dead_code)]
    pub fn blocks_bullet(&self) -> bool {
        matches!(self, Tile::Wall | Tile::Mound)
    }
}

pub type Map = Vec<Vec<Tile>>;

// ─── 朝向 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Facing {
    North,
    East,
    South,
    West,
}

impl Facing {
    pub fn turn_left(self) -> Self {
        match self {
            Facing::North => Facing::West,
            Facing::West  => Facing::South,
            Facing::South => Facing::East,
            Facing::East  => Facing::North,
        }
    }

    pub fn turn_right(self) -> Self {
        match self {
            Facing::North => Facing::East,
            Facing::East  => Facing::South,
            Facing::South => Facing::West,
            Facing::West  => Facing::North,
        }
    }

    /// (col_delta, row_delta)
    pub fn delta(self) -> (i32, i32) {
        match self {
            Facing::North => (0, -1),
            Facing::East  => (1,  0),
            Facing::South => (0,  1),
            Facing::West  => (-1, 0),
        }
    }

    /// 朝向转弧度（用于遥测兼容，East=0，顺时针增大）
    pub fn to_angle(self) -> f64 {
        match self {
            Facing::East  => 0.0,
            Facing::South =>  std::f64::consts::FRAC_PI_2,
            Facing::West  =>  std::f64::consts::PI,
            Facing::North => -std::f64::consts::FRAC_PI_2,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Facing::North => "north",
            Facing::East  => "east",
            Facing::South => "south",
            Facing::West  => "west",
        }
    }
}

// ─── 命令 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum TankCommand {
    Move,
    TurnLeft,
    TurnRight,
    Fire,
    UseSkill(Option<(usize, usize)>), // 传送技能：Some((col, row))；其余技能：None
}

// ─── 技能系统 ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillType {
    Shield,
    Freeze,
    Stun,
    Overload,
    Cloak,
    Poison,
    Teleport,
    Boost,
}

impl Default for SkillType { fn default() -> Self { SkillType::Shield } }

impl SkillType {
    pub fn cooldown_max(&self) -> u32 {
        match self {
            SkillType::Shield   => 32,
            SkillType::Freeze   => 32, // 32(原34)：效果大幅增强，CD 同步缩短
            SkillType::Stun     => 33, // 33(原31)：最强控制，微加 CD
            SkillType::Overload => 32,
            SkillType::Cloak    => 36, // 36(原32)：7帧隐身效果强，CD 拉长
            SkillType::Poison   => 30, // 30(原34)：效果增强，CD 同步缩短
            SkillType::Teleport => 35, // 35(原40)：降低门槛
            SkillType::Boost    => 31,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            SkillType::Shield   => "shield",
            SkillType::Freeze   => "freeze",
            SkillType::Stun     => "stun",
            SkillType::Overload => "overload",
            SkillType::Cloak    => "cloak",
            SkillType::Poison   => "poison",
            SkillType::Teleport => "teleport",
            SkillType::Boost    => "boost",
        }
    }
    pub fn from_str(s: &str) -> Self {
        match s {
            "freeze"   => SkillType::Freeze,
            "stun"     => SkillType::Stun,
            "overload" => SkillType::Overload,
            "cloak"    => SkillType::Cloak,
            "poison"   => SkillType::Poison,
            "teleport" => SkillType::Teleport,
            "boost"    => SkillType::Boost,
            _          => SkillType::Shield,
        }
    }
}

/// 坦克实时状态（持续帧数倒计时）
#[derive(Debug, Clone, Default)]
pub struct TankStatus {
    pub shielded:    u32,   // 剩余帧数：护盾
    pub frozen:      u32,   // 剩余帧数：冻结（跳过命令出队）
    pub stunned:     u32,   // 剩余帧数：眩晕（随机化命令）
    pub overloaded:  bool,  // 直到下次开火
    pub cloaked:     u32,   // 剩余帧数：隐身（敌人传感器不可见）
    pub poisoned:    u32,   // 剩余帧数：中毒（每隔一帧跳过命令）
    pub boosted:     u32,   // 剩余帧数：加速（移动 2 格）
    pub fire_locked: u32,   // 剩余帧数：传送锁定（不能射击）
    pub poison_skip: bool,  // 中毒状态下交替跳帧标志
}

impl TankStatus {
    pub fn tick(&mut self) {
        if self.shielded    > 0 { self.shielded    -= 1; }
        if self.frozen      > 0 { self.frozen      -= 1; }
        if self.stunned     > 0 { self.stunned     -= 1; }
        if self.cloaked     > 0 { self.cloaked     -= 1; }
        if self.boosted     > 0 { self.boosted     -= 1; }
        if self.fire_locked > 0 { self.fire_locked -= 1; }
        if self.poisoned    > 0 {
            self.poisoned    -= 1;
            self.poison_skip  = !self.poison_skip;
        } else {
            self.poison_skip = false;
        }
    }
}

/// 状态快照（用于传感器，不含内部 skip 标志）
#[derive(Debug, Clone, Default)]
pub struct TankStatusSummary {
    pub shielded:    bool,
    pub frozen:      bool,
    pub stunned:     bool,
    pub overloaded:  bool,
    pub cloaked:     bool,
    pub poisoned:    bool,
    pub boosted:     bool,
    pub fire_locked: bool,
}

// ─── 数据结构 ─────────────────────────────────────────────────────────────

/// 轻量级快照，用于传感器计算（避免 clone VecDeque）
#[derive(Debug, Clone)]
pub struct TankSummary {
    pub id: usize,
    pub x: usize,
    pub y: usize,
    pub facing: Facing,
    pub hp: i32,
    pub alive: bool,
    pub score: u32,
    pub shoot_cooldown: u32,
    pub team_id: usize,
    pub skill_type: SkillType,
    pub skill_cooldown: u32,
    pub status: TankStatusSummary,
}

pub struct TankState {
    pub id: usize,
    pub name: String,
    pub x: usize,
    pub y: usize,
    pub facing: Facing,
    pub hp: i32,
    pub alive: bool,
    pub shoot_cooldown: u32,
    pub score: u32,
    pub command_queue: VecDeque<TankCommand>,
    pub team_id: usize,
    pub skill_type: SkillType,
    pub skill_cooldown: u32,
    pub status: TankStatus,
}

impl TankState {
    pub fn new(id: usize, name: &str, x: usize, y: usize, facing: Facing, team_id: usize, skill_type: SkillType) -> Self {
        Self {
            id, name: name.to_string(),
            x, y, facing,
            hp: TANK_INIT_HP,
            alive: true,
            shoot_cooldown: 0,
            score: 0,
            command_queue: VecDeque::new(),
            team_id,
            skill_type,
            skill_cooldown: 0,
            status: TankStatus::default(),
        }
    }

    pub fn as_summary(&self) -> TankSummary {
        TankSummary {
            id: self.id, x: self.x, y: self.y,
            facing: self.facing, hp: self.hp, alive: self.alive,
            score: self.score, shoot_cooldown: self.shoot_cooldown,
            team_id: self.team_id,
            skill_type: self.skill_type.clone(),
            skill_cooldown: self.skill_cooldown,
            status: TankStatusSummary {
                shielded:    self.status.shielded    > 0,
                frozen:      self.status.frozen      > 0,
                stunned:     self.status.stunned     > 0,
                overloaded:  self.status.overloaded,
                cloaked:     self.status.cloaked     > 0,
                poisoned:    self.status.poisoned    > 0,
                boosted:     self.status.boosted     > 0,
                fire_locked: self.status.fire_locked > 0,
            },
        }
    }

    pub fn pixel_x(&self) -> f64 { self.x as f64 * TILE_SIZE + TILE_SIZE / 2.0 }
    pub fn pixel_y(&self) -> f64 { self.y as f64 * TILE_SIZE + TILE_SIZE / 2.0 }
}

pub struct Bullet {
    pub id: u32,
    pub x: usize,
    pub y: usize,
    pub facing: Facing,
    pub owner: usize,
    pub active: bool,
}

impl Bullet {
    pub fn pixel_x(&self) -> f64 { self.x as f64 * TILE_SIZE + TILE_SIZE / 2.0 }
    pub fn pixel_y(&self) -> f64 { self.y as f64 * TILE_SIZE + TILE_SIZE / 2.0 }
}

pub struct Star {
    pub x: usize,
    pub y: usize,
}

// ─── 传感器数据（注入 JS）─────────────────────────────────────────────────

pub struct SensorData {
    pub me: TankSummary,
    pub enemies: Vec<EnemySensor>,
    pub allies: Vec<AllySensor>,
    pub map: Map,
    pub stars: Vec<(usize, usize)>,
    pub frame: u32,
    pub bullets: Vec<BulletSensor>,
}

#[derive(Clone)]
pub struct EnemySensor {
    pub id: usize,
    pub x: usize,
    pub y: usize,
    pub facing: Facing,
    pub hp: i32,
    pub status: TankStatusSummary,
}

#[derive(Clone)]
pub struct AllySensor {
    pub id: usize,
    pub x: usize,
    pub y: usize,
    pub facing: Facing,
    pub hp: i32,
}

#[derive(Clone)]
pub struct BulletSensor {
    pub x: usize,
    pub y: usize,
    pub facing: Facing,
    pub owner_id: usize,
}

// ─── 地图 ─────────────────────────────────────────────────────────────────

// 180° 旋转对称地图（所有行均为回文，整体自对称）
// 三通道结构：左通道(col1-6)、中通道(col8-11)、右通道(col13-18)
// 门柱墙(col7,col12)制造 chokepoint，中心土堆可被摧毁
const MAP_STR: &[&str] = &[
    "xxxxxxxxxxxxxxxxxxxx",  //  0  外墙
    "x..................x",  //  1  出生行：(1,1)East / (18,1)West
    "x.xx............xx.x",  //  2  角落掩体
    "x..................x",  //  3
    "x.ooo..........ooo.x",  //  4  草丛（col2-4 / col15-17），靠近出生点
    "x.ooo..........ooo.x",  //  5
    "x..................x",  //  6
    "x......x....x......x",  //  7  门柱 col7 / col12
    "x......x.mm.x......x",  //  8  门柱 + 中央土堆缝隙
    "x.......mmmm.......x",  //  9  中心土堆群
    "x.......mmmm.......x",  // 10
    "x......x.mm.x......x",  // 11
    "x......x....x......x",  // 12
    "x..................x",  // 13
    "x.ooo..........ooo.x",  // 14
    "x.ooo..........ooo.x",  // 15  出生行：(1,18)East / (18,18)West
    "x..................x",  // 16
    "x.xx............xx.x",  // 17
    "x..................x",  // 18
    "xxxxxxxxxxxxxxxxxxxx",  // 19
];

pub fn init_map() -> Map {
    MAP_STR.iter().map(|row| row.chars().map(Tile::from_char).collect()).collect()
}

pub fn map_to_strings(map: &Map) -> Vec<String> {
    map.iter().map(|row| row.iter().map(|t| t.to_char()).collect()).collect()
}

pub fn start_positions(id: usize) -> (usize, usize, Facing) {
    match id % 4 {
        0 => (1,  1,  Facing::East),   // 左上
        1 => (18, 18, Facing::West),   // 右下（与 0 对角，2v2 标准对称）
        2 => (18, 1,  Facing::West),   // 右上
        _ => (1,  18, Facing::East),   // 左下
    }
}

// ─── 物理辅助 ─────────────────────────────────────────────────────────────

/// 计算前进一格后的目标坐标，超出边界返回 None
pub fn step_forward(x: usize, y: usize, facing: Facing) -> Option<(usize, usize)> {
    let (dx, dy) = facing.delta();
    let nx = x as i32 + dx;
    let ny = y as i32 + dy;
    if nx < 0 || ny < 0 || nx >= GRID_W as i32 || ny >= GRID_H as i32 {
        return None;
    }
    Some((nx as usize, ny as usize))
}

/// 计算所有坦克的传感器读数
pub fn compute_sensors(
    me: &TankSummary,
    others: &[TankSummary],
    map: &Map,
    stars: &[Star],
    frame: u32,
    bullets: &[Bullet],
) -> SensorData {
    // 敌人：存活 && team_id 不同 && 未躲在草丛中 && 未处于隐身状态
    let mut enemies: Vec<EnemySensor> = others.iter()
        .filter(|t| t.alive && t.team_id != me.team_id
                   && map[t.y][t.x] != Tile::Grass
                   && !t.status.cloaked)
        .map(|t| EnemySensor { id: t.id, x: t.x, y: t.y, facing: t.facing, hp: t.hp, status: t.status.clone() })
        .collect();
    // 按曼哈顿距离排序
    enemies.sort_by_key(|e| {
        (e.x as i32 - me.x as i32).unsigned_abs() + (e.y as i32 - me.y as i32).unsigned_abs()
    });

    // 队友：存活 && team_id 相同 && id 不同
    let mut allies: Vec<AllySensor> = others.iter()
        .filter(|t| t.alive && t.team_id == me.team_id && t.id != me.id)
        .map(|t| AllySensor { id: t.id, x: t.x, y: t.y, facing: t.facing, hp: t.hp })
        .collect();
    // 按曼哈顿距离排序
    allies.sort_by_key(|a| {
        (a.x as i32 - me.x as i32).unsigned_abs() + (a.y as i32 - me.y as i32).unsigned_abs()
    });

    let bullet_sensors: Vec<BulletSensor> = bullets.iter()
        .filter(|b| b.active)
        .map(|b| BulletSensor { x: b.x, y: b.y, facing: b.facing, owner_id: b.owner })
        .collect();

    SensorData {
        me: me.clone(),
        enemies,
        allies,
        map: map.clone(),
        stars: stars.iter().map(|s| (s.x, s.y)).collect(),
        frame,
        bullets: bullet_sensors,
    }
}
