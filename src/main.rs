/// Chassis 坦克竞技场仿真引擎
///
/// 用法：
///   cargo run                          # 运行 agents/ 目录下所有 .js
///   cargo run -- agents/rusher.js ...  # 指定参赛坦克
///   cargo run -- --serve [port]        # 启动 HTTP API 服务器（默认 3001）

mod physics;
mod battle;
mod sandbox;
mod snake;
mod server;
mod db;
mod auth;

use battle::ArenaEngine;
use std::path::Path;

fn load_agents_from_dir(dir: &str) -> Vec<(String, String)> {
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .unwrap_or_else(|_| { eprintln!("找不到 {} 目录", dir); std::process::exit(1); })
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "js").unwrap_or(false))
        .map(|e| e.path())
        .collect();
    paths.sort();

    paths.iter().map(|path| {
        let name = path.file_stem().unwrap().to_string_lossy().to_string();
        let code = std::fs::read_to_string(path)
            .unwrap_or_else(|e| { eprintln!("读取失败 {:?}: {}", path, e); std::process::exit(1); });
        (name, code)
    }).collect()
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    let args: Vec<String> = std::env::args().skip(1).collect();

    // --serve [port] 模式：启动 HTTP API
    if args.first().map(|s| s.as_str()) == Some("--serve") {
        let port: u16 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(3001);
        server::serve(port).await;
        return;
    }
    let raw_agents: Vec<(String, String)> = if args.is_empty() {
        load_agents_from_dir("agents")
    } else {
        args.iter().map(|p| {
            let name = Path::new(p).file_stem().unwrap().to_string_lossy().to_string();
            let code = std::fs::read_to_string(p)
                .unwrap_or_else(|e| { eprintln!("读取失败 {}: {}", p, e); std::process::exit(1); });
            (name, code)
        }).collect()
    };

    if raw_agents.is_empty() {
        eprintln!("没有找到 agent，请在 agents/ 目录放置 .js 文件");
        std::process::exit(1);
    }

    println!("╔══════════════════════════════════════════════╗");
    println!("║        Chassis 坦克竞技场仿真引擎              ║");
    println!("╚══════════════════════════════════════════════╝");
    println!("参赛坦克: {}", raw_agents.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(" / "));
    println!();

    let specs: Vec<(&str, &str, physics::SkillType)> = raw_agents.iter().map(|(n, c)| (n.as_str(), c.as_str(), physics::SkillType::Shield)).collect();
    let engine = match ArenaEngine::new(specs) {
        Ok(e) => { println!("[主程序] 初始化完成，开始仿真...\n"); e }
        Err(e) => { eprintln!("[主程序] 初始化失败: {}", e); std::process::exit(1); }
    };

    let result = engine.run();

    println!("┌─── 战报 ─────────────────────────────────────────────┐");
    let limit = result.battle_log.len().min(50);
    for line in &result.battle_log[..limit] {
        println!("│ {}", line);
    }
    if result.battle_log.len() > 50 {
        println!("│ ... （共 {} 条事件）", result.battle_log.len());
    }
    println!("└──────────────────────────────────────────────────────┘\n");

    println!("胜者        : {}", result.winner);
    println!("仿真 Tick 数: {}", result.total_ticks);
    println!("遥测帧数    : {} 帧", result.telemetry.len());

    if let Some(last) = result.telemetry.last() {
        println!("\n最终状态:");
        for t in &last.tanks {
            let status = if t.alive { format!("存活 HP={:.0}", t.hp) } else { "已摧毁".to_string() };
            println!("  [{}] {} - {}", t.id, t.name, status);
        }
    }

    let preview: Vec<_> = result.telemetry.iter().take(2).collect();
    println!("\n遥测 JSON（前 2 帧）:");
    println!("{}", serde_json::to_string_pretty(&preview).unwrap());
}
