/// 坦克竞技场物理层（格子 + 回合制）

use std::collections::VecDeque;

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
}

impl TankState {
    pub fn new(id: usize, name: &str, x: usize, y: usize, facing: Facing) -> Self {
        Self {
            id, name: name.to_string(),
            x, y, facing,
            hp: TANK_INIT_HP,
            alive: true,
            shoot_cooldown: 0,
            score: 0,
            command_queue: VecDeque::new(),
        }
    }

    pub fn as_summary(&self) -> TankSummary {
        TankSummary {
            id: self.id, x: self.x, y: self.y,
            facing: self.facing, hp: self.hp, alive: self.alive,
            score: self.score, shoot_cooldown: self.shoot_cooldown,
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
}

#[derive(Clone)]
pub struct BulletSensor {
    pub id: u32,
    pub x: usize,
    pub y: usize,
    pub facing: Facing,
    pub owner_id: usize,
}

// ─── 地图 ─────────────────────────────────────────────────────────────────

// 180° 旋转对称地图：map[r][c] == map[19-r][19-c]，保证对角出生公平
const MAP_STR: &[&str] = &[
    "xxxxxxxxxxxxxxxxxxxx",  //  0
    "x..................x",  //  1
    "x.xx............xx.x",  //  2  角落矮墙（自对称）
    "x..................x",  //  3
    "x..ooo............x",  //  4  左上草丛
    "x..ooo............x",  //  5
    "xxx................x",  //  6  左侧凸出墙
    "x.......mm.........x",  //  7  土堆（左偏）
    "x..........mm......x",  //  8  土堆（右偏）
    "x........mm........x",  //  9  中心土堆（自对称）
    "x........mm........x",  // 10  mirror of  9
    "x......mm..........x",  // 11  mirror of  8
    "x.........mm.......x",  // 12  mirror of  7
    "x................xxx",  // 13  mirror of  6
    "x.............ooo..x",  // 14  mirror of  5
    "x.............ooo..x",  // 15  mirror of  4（右下草丛）
    "x..................x",  // 16  mirror of  3
    "x.xx............xx.x",  // 17  mirror of  2（自对称）
    "x..................x",  // 18  mirror of  1
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
    let mut enemies: Vec<EnemySensor> = others.iter()
        .filter(|t| t.alive)
        .map(|t| EnemySensor { id: t.id, x: t.x, y: t.y, facing: t.facing, hp: t.hp })
        .collect();
    // 按曼哈顿距离排序
    enemies.sort_by_key(|e| {
        (e.x as i32 - me.x as i32).unsigned_abs() + (e.y as i32 - me.y as i32).unsigned_abs()
    });

    let bullet_sensors: Vec<BulletSensor> = bullets.iter()
        .filter(|b| b.active)
        .map(|b| BulletSensor { id: b.id, x: b.x, y: b.y, facing: b.facing, owner_id: b.owner })
        .collect();

    SensorData {
        me: me.clone(),
        enemies,
        map: map.clone(),
        stars: stars.iter().map(|s| (s.x, s.y)).collect(),
        frame,
        bullets: bullet_sensors,
    }
}
