.PHONY: dev build clean

dev:
	@echo "启动 Rust 引擎（端口 3001）和 Next.js 前端（端口 3000）..."
	@trap 'kill 0' SIGINT; \
	cargo run -- --serve & \
	cd web && npm run dev & \
	wait
