/// QuickJS 沙箱：格子回合制版本

use std::cell::Cell;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Instant;

use rquickjs::{Array, Context, Function, Object, Runtime, Value};
use serde::{Deserialize, Serialize};

use crate::physics::{SensorData, TankCommand};

const MAX_MEMORY_BYTES: usize = 2 * 1024 * 1024;
const MAX_STACK_BYTES:  usize = 256 * 1024;
const MAX_EXEC_MS: u128 = 10;

thread_local! {
    static JS_EXEC_START: Cell<Option<Instant>> = const { Cell::new(None) };
}

fn reset_timer() {
    JS_EXEC_START.with(|c| c.set(Some(Instant::now())));
}

fn clear_timer() {
    JS_EXEC_START.with(|c| c.set(None));
}

fn is_timed_out() -> bool {
    JS_EXEC_START.with(|c| {
        c.get().map(|t| t.elapsed().as_millis() >= MAX_EXEC_MS).unwrap_or(false)
    })
}

/// 每次调用 onIdle 前注入的基础设施 JS
const INFRA_JS: &str = r#"
var __queue = [];
var __logs  = [];
function print() {
    var a = [];
    for (var i = 0; i < arguments.length; i++) a.push(String(arguments[i]));
    __logs.push(a.join(' '));
}
var me = {
    tank: { position: [0,0], direction: "east", id: 0, crashed: false, hp: 100, score: 0, shootCooldown: 0 },
    go: function(n) {
        n = (typeof n === "number" && n >= 1) ? Math.min(Math.floor(n), 10) : 1;
        for (var i = 0; i < n; i++) __queue.push("move");
    },
    turn: function(dir) {
        if (dir === "left")  __queue.push("turn_left");
        if (dir === "right") __queue.push("turn_right");
    },
    fire: function() { __queue.push("fire"); },
    speak: function(text) {},
    bullet: null,
};
var enemy = null;
var ally  = null;
var game = { map: [], stars: [], star: null, frames: 0 };
"#;

/// 单次对战中某辆坦克的 JS 执行统计快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsExecStats {
    pub tank_name: String,
    pub idle_calls: u32,
    pub empty_calls: u32,       // onIdle 未发出任何命令的次数
    pub total_exec_us: u64,
    pub max_exec_us: u64,
    pub avg_exec_us: u64,
    pub error_count: u32,
    pub commands_issued: u32,
    pub peak_memory_bytes: u64, // JS 堆内存峰值（字节）
}

pub struct QuickJsSandbox {
    runtime:  Runtime,
    context:  Context,
    pub tank_name: String,
    error_count:       AtomicU32,
    idle_calls:        AtomicU32,
    empty_calls:       AtomicU32,
    total_exec_us:     AtomicU64,
    max_exec_us:       AtomicU64,
    commands_issued:   AtomicU32,
    timeout_count:     AtomicU32,
    peak_memory_bytes: AtomicU64,
}

impl QuickJsSandbox {
    pub fn new(name: &str, js_code: &str) -> Result<Self, String> {
        let runtime = Runtime::new()
            .map_err(|e| format!("[{}] Runtime 失败: {e}", name))?;
        runtime.set_memory_limit(MAX_MEMORY_BYTES);
        runtime.set_max_stack_size(MAX_STACK_BYTES);
        runtime.set_interrupt_handler(Some(Box::new(|| is_timed_out())));

        let context = Context::full(&runtime)
            .map_err(|e| format!("[{}] Context 失败: {e}", name))?;

        // 清除可能由线程池复用残留的旧计时器，避免 interrupt handler 误触发
        clear_timer();

        context.with(|ctx| {
            // 先注入基础设施（me/enemy/game/__queue/__logs/print）
            ctx.eval::<(), _>(INFRA_JS)
                .map_err(|e| format!("[{}] 基础设施初始化失败: {e}", name))?;
            // 再执行用户代码（只定义 onIdle 函数，不立即运行）
            ctx.eval::<(), _>(js_code)
                .map_err(|e| format!("[{}] JS 编译错误: {e}", name))
        })?;

        Ok(Self {
            runtime,
            context,
            tank_name:         name.to_string(),
            error_count:       AtomicU32::new(0),
            idle_calls:        AtomicU32::new(0),
            empty_calls:       AtomicU32::new(0),
            total_exec_us:     AtomicU64::new(0),
            max_exec_us:       AtomicU64::new(0),
            commands_issued:   AtomicU32::new(0),
            timeout_count:     AtomicU32::new(0),
            peak_memory_bytes: AtomicU64::new(0),
        })
    }

    /// 注入传感器数据，调用 `onIdle(me, enemy, game)`，返回 (命令列表, 日志列表)
    pub fn act(&self, sensors: &SensorData) -> (Vec<TankCommand>, Vec<String>) {
        reset_timer();

        let result = self.context.with(|ctx| -> Result<(Vec<TankCommand>, Vec<String>), String> {
            let globals = ctx.globals();

            // ── 重置队列与日志 ──────────────────────────────────────────────
            ctx.eval::<(), _>("__queue = []; __logs = [];")
                .map_err(|e| e.to_string())?;

            // ── 更新 me.tank ─────────────────────────────────────────────
            let me_obj: Object = globals.get("me").map_err(|e| e.to_string())?;
            let me_tank = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
            let pos = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            pos.set(0, sensors.me.x as i32).map_err(|e| e.to_string())?;
            pos.set(1, sensors.me.y as i32).map_err(|e| e.to_string())?;
            me_tank.set("position",      pos).map_err(|e| e.to_string())?;
            me_tank.set("direction",     sensors.me.facing.as_str()).map_err(|e| e.to_string())?;
            me_tank.set("id",            sensors.me.id as i32).map_err(|e| e.to_string())?;
            me_tank.set("crashed",       false).map_err(|e| e.to_string())?;
            me_tank.set("hp",            sensors.me.hp).map_err(|e| e.to_string())?;
            me_tank.set("score",         sensors.me.score as i32).map_err(|e| e.to_string())?;
            me_tank.set("shootCooldown", sensors.me.shoot_cooldown as i32).map_err(|e| e.to_string())?;
            me_obj.set("tank", me_tank).map_err(|e| e.to_string())?;

            // ── 子弹对象构造辅助闭包 ─────────────────────────────────────
            let make_bullet_obj = |b: &crate::physics::BulletSensor| -> Result<Object, String> {
                let b_obj = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                let b_pos = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                b_pos.set(0, b.x as i32).map_err(|e| e.to_string())?;
                b_pos.set(1, b.y as i32).map_err(|e| e.to_string())?;
                b_obj.set("position",  b_pos).map_err(|e| e.to_string())?;
                b_obj.set("direction", b.facing.as_str()).map_err(|e| e.to_string())?;
                Ok(b_obj)
            };

            // ── 设置 me.bullet（本坦克发出的第一颗活跃子弹）────────────────
            let my_bullet = sensors.bullets.iter().find(|b| b.owner_id == sensors.me.id);
            if let Some(b) = my_bullet {
                me_obj.set("bullet", make_bullet_obj(b)?).map_err(|e| e.to_string())?;
            } else {
                me_obj.set("bullet", Value::new_null(ctx.clone())).map_err(|e| e.to_string())?;
            }

            // ── 更新 enemy（最近敌人 or null）───────────────────────────
            if let Some(e) = sensors.enemies.first() {
                let enemy_obj = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                let e_tank = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                let e_pos = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                e_pos.set(0, e.x as i32).map_err(|e| e.to_string())?;
                e_pos.set(1, e.y as i32).map_err(|e| e.to_string())?;
                e_tank.set("position", e_pos).map_err(|e| e.to_string())?;
                e_tank.set("direction", e.facing.as_str()).map_err(|e| e.to_string())?;
                e_tank.set("hp", e.hp).map_err(|e| e.to_string())?;
                enemy_obj.set("tank", e_tank).map_err(|e| e.to_string())?;
                // ── 设置 enemy.bullet（敌人发出的第一颗活跃子弹）────────────
                let enemy_bullet = sensors.bullets.iter().find(|b| b.owner_id == e.id);
                if let Some(b) = enemy_bullet {
                    enemy_obj.set("bullet", make_bullet_obj(b)?).map_err(|e| e.to_string())?;
                } else {
                    enemy_obj.set("bullet", Value::new_null(ctx.clone())).map_err(|e| e.to_string())?;
                }
                globals.set("enemy", enemy_obj).map_err(|e| e.to_string())?;
            } else {
                globals.set("enemy", Value::new_null(ctx.clone())).map_err(|e| e.to_string())?;
            }

            // ── 更新 ally（最近队友 or null）────────────────────────────
            if let Some(a) = sensors.allies.first() {
                let ally_obj = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                let a_tank = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
                let a_pos = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                a_pos.set(0, a.x as i32).map_err(|e| e.to_string())?;
                a_pos.set(1, a.y as i32).map_err(|e| e.to_string())?;
                a_tank.set("position", a_pos).map_err(|e| e.to_string())?;
                a_tank.set("direction", a.facing.as_str()).map_err(|e| e.to_string())?;
                a_tank.set("hp", a.hp).map_err(|e| e.to_string())?;
                ally_obj.set("tank", a_tank).map_err(|e| e.to_string())?;
                globals.set("ally", ally_obj).map_err(|e| e.to_string())?;
            } else {
                globals.set("ally", Value::new_null(ctx.clone())).map_err(|e| e.to_string())?;
            }

            // ── 更新 game ────────────────────────────────────────────────
            let game_obj: Object = globals.get("game").map_err(|e| e.to_string())?;

            let map_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (r, row) in sensors.map.iter().enumerate() {
                let row_str: String = row.iter().map(|t| t.to_char()).collect();
                map_arr.set(r, row_str).map_err(|e| e.to_string())?;
            }
            game_obj.set("map", map_arr).map_err(|e| e.to_string())?;

            let stars_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
            for (i, (sx, sy)) in sensors.stars.iter().enumerate() {
                let sa = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                sa.set(0, *sx as i32).map_err(|e| e.to_string())?;
                sa.set(1, *sy as i32).map_err(|e| e.to_string())?;
                stars_arr.set(i, sa).map_err(|e| e.to_string())?;
            }
            game_obj.set("stars", stars_arr).map_err(|e| e.to_string())?;
            game_obj.set("frames", sensors.frame as i32).map_err(|e| e.to_string())?;
            if let Some((sx, sy)) = sensors.stars.first() {
                let star_arr = Array::new(ctx.clone()).map_err(|e| e.to_string())?;
                star_arr.set(0, *sx as i32).map_err(|e| e.to_string())?;
                star_arr.set(1, *sy as i32).map_err(|e| e.to_string())?;
                game_obj.set("star", star_arr).map_err(|e| e.to_string())?;
            } else {
                game_obj.set("star", Value::new_null(ctx.clone())).map_err(|e| e.to_string())?;
            }

            // ── 调用 onIdle(me, enemy, game) ─────────────────────────────
            let on_idle: Function = globals.get("onIdle")
                .map_err(|_| "onIdle() 函数未定义".to_string())?;

            let me_val:    Value = globals.get("me").map_err(|e| e.to_string())?;
            let enemy_val: Value = globals.get("enemy").map_err(|e| e.to_string())?;
            let game_val:  Value = globals.get("game").map_err(|e| e.to_string())?;

            let call_start = Instant::now();
            let call_result = on_idle.call::<_, ()>((me_val, enemy_val, game_val));
            let elapsed_us = call_start.elapsed().as_micros() as u64;

            // 更新执行统计
            self.idle_calls.fetch_add(1, Ordering::Relaxed);
            self.total_exec_us.fetch_add(elapsed_us, Ordering::Relaxed);
            // CAS loop 更新最大值
            let mut cur_max = self.max_exec_us.load(Ordering::Relaxed);
            while elapsed_us > cur_max {
                match self.max_exec_us.compare_exchange_weak(
                    cur_max, elapsed_us, Ordering::Relaxed, Ordering::Relaxed,
                ) {
                    Ok(_) => break,
                    Err(v) => cur_max = v,
                }
            }
            // timeout 检测：>= 10ms
            if elapsed_us >= 10_000 {
                self.timeout_count.fetch_add(1, Ordering::Relaxed);
            }

            call_result.map_err(|e| format!("onIdle() 执行错误: {e}"))?;

            // ── 读取 __queue ─────────────────────────────────────────────
            let queue: Array = globals.get("__queue").map_err(|e| e.to_string())?;
            let mut commands = Vec::new();
            for i in 0..queue.len() {
                let v: Value = queue.get(i).unwrap_or(Value::new_null(ctx.clone()));
                let s = v.as_string()
                    .and_then(|js_s| js_s.to_string().ok())
                    .unwrap_or_default();
                match s.as_str() {
                    "move"       => commands.push(TankCommand::Move),
                    "turn_left"  => commands.push(TankCommand::TurnLeft),
                    "turn_right" => commands.push(TankCommand::TurnRight),
                    "fire"       => commands.push(TankCommand::Fire),
                    _ => {}
                }
            }
            self.commands_issued.fetch_add(commands.len() as u32, Ordering::Relaxed);
            if commands.is_empty() {
                self.empty_calls.fetch_add(1, Ordering::Relaxed);
            }

            // ── 读取 __logs ──────────────────────────────────────────────
            let logs_arr: Array = globals.get("__logs").map_err(|e| e.to_string())?;
            let mut logs = Vec::new();
            for i in 0..logs_arr.len() {
                let v: Value = logs_arr.get(i).unwrap_or(Value::new_null(ctx.clone()));
                if let Some(s) = v.as_string().and_then(|js_s| js_s.to_string().ok()) {
                    logs.push(s);
                }
            }

            Ok((commands, logs))
        });

        // 采样当前 JS 堆内存，更新峰值
        let mem_now = self.runtime.memory_usage().memory_used_size as u64;
        let mut cur_peak = self.peak_memory_bytes.load(Ordering::Relaxed);
        while mem_now > cur_peak {
            match self.peak_memory_bytes.compare_exchange_weak(
                cur_peak, mem_now, Ordering::Relaxed, Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(v) => cur_peak = v,
            }
        }

        match result {
            Ok(pair) => pair,
            Err(e) => {
                let prev = self.error_count.fetch_add(1, Ordering::Relaxed);
                if prev == 0 || prev % 100 == 99 {
                    eprintln!("[沙箱/{}] 降级为空转: {}", self.tank_name, e);
                }
                (Vec::new(), Vec::new())
            }
        }
    }

    /// 返回当前执行统计快照
    pub fn stats(&self) -> JsExecStats {
        let calls = self.idle_calls.load(Ordering::Relaxed);
        let total = self.total_exec_us.load(Ordering::Relaxed);
        let avg   = if calls > 0 { total / calls as u64 } else { 0 };
        JsExecStats {
            tank_name:         self.tank_name.clone(),
            idle_calls:        calls,
            empty_calls:       self.empty_calls.load(Ordering::Relaxed),
            total_exec_us:     total,
            max_exec_us:       self.max_exec_us.load(Ordering::Relaxed),
            avg_exec_us:       avg,
            error_count:       self.error_count.load(Ordering::Relaxed),
            commands_issued:   self.commands_issued.load(Ordering::Relaxed),
            peak_memory_bytes: self.peak_memory_bytes.load(Ordering::Relaxed),
        }
    }
}
