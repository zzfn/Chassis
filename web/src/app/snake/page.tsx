"use client"

import { GameArenaPage, type GameArenaConfig } from "@/components/GameArenaPage"

const SNAKE_CONFIG: GameArenaConfig = {
  apiPath:             "snake",
  replayPath:          "/snake/replay",
  agentLabel:          "蛇",
  pageTitle:           "我的蛇",
  sysLabel:            "SNAKE_MGMT.SYS",
  tabAccents:          ["#00F5D4", "#FFE600", "#7B2FFF"],
  challengeAgentField: "snake_name",
  defaultCode: `// 贪吃蛇 AI — 每回合调用 onIdle
// me.head: [col, row]   当前头部坐标
// me.body: [[col,row],...]  完整身体（body[0]=头）
// me.direction: "north"|"east"|"south"|"west"
// me.length: 身体长度   me.score: 当前得分
// others: 其他存活蛇的数组（同 me 字段结构）
// game.map: string[]   地图行（'x'=墙 'm'=土堆 'o'=草丛 '.'=地板）
// game.food: [[col,row],...]  食物坐标列表
// game.tick: 当前回合数
// me.setDir("north"|"east"|"south"|"west")  设置方向

function onIdle(me, others, game) {
  var head = me.head;
  var food = game.food;

  var target = null, minDist = 999;
  for (var i = 0; i < food.length; i++) {
    var d = Math.abs(food[i][0] - head[0]) + Math.abs(food[i][1] - head[1]);
    if (d < minDist) { minDist = d; target = food[i]; }
  }

  var dirs = [];
  if (target) {
    var dx = target[0] - head[0], dy = target[1] - head[1];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > 0) dirs.push("east"); else if (dx < 0) dirs.push("west");
      if (dy > 0) dirs.push("south"); else if (dy < 0) dirs.push("north");
    } else {
      if (dy > 0) dirs.push("south"); else if (dy < 0) dirs.push("north");
      if (dx > 0) dirs.push("east"); else if (dx < 0) dirs.push("west");
    }
  }

  var all = ["north", "east", "south", "west"];
  for (var k = 0; k < all.length; k++) {
    if (dirs.indexOf(all[k]) < 0) dirs.push(all[k]);
  }

  for (var j = 0; j < dirs.length; j++) {
    if (isSafe(head, dirs[j], me, others, game)) {
      me.setDir(dirs[j]); return;
    }
  }
}

function isSafe(head, dir, me, others, game) {
  var nx = head[0], ny = head[1];
  if (dir === "north") ny--; else if (dir === "south") ny++;
  else if (dir === "east") nx++; else if (dir === "west") nx--;
  if (nx < 0 || ny < 0 || nx >= 20 || ny >= 20) return false;
  var cell = game.map[ny][nx];
  if (cell === "x" || cell === "m") return false;
  for (var i = 0; i < me.body.length - 1; i++) {
    if (me.body[i][0] === nx && me.body[i][1] === ny) return false;
  }
  for (var j = 0; j < others.length; j++) {
    for (var k = 0; k < others[j].body.length; k++) {
      if (others[j].body[k][0] === nx && others[j].body[k][1] === ny) return false;
    }
  }
  return true;
}`,
}

export default function SnakePage() {
  return <GameArenaPage config={SNAKE_CONFIG} />
}
