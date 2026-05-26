// 贪吃蛇内置 Bot — BFS 寻路朝食物移动，避开障碍
function onIdle(me, others, game) {
  var head = me.head;
  var food = game.food;

  // 找最近的食物（曼哈顿距离）
  var target = null;
  var minDist = 999;
  for (var i = 0; i < food.length; i++) {
    var d = Math.abs(food[i][0] - head[0]) + Math.abs(food[i][1] - head[1]);
    if (d < minDist) { minDist = d; target = food[i]; }
  }

  var prefDirs = [];
  if (target) {
    var dx = target[0] - head[0];
    var dy = target[1] - head[1];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx > 0) prefDirs.push("east"); else if (dx < 0) prefDirs.push("west");
      if (dy > 0) prefDirs.push("south"); else if (dy < 0) prefDirs.push("north");
    } else {
      if (dy > 0) prefDirs.push("south"); else if (dy < 0) prefDirs.push("north");
      if (dx > 0) prefDirs.push("east"); else if (dx < 0) prefDirs.push("west");
    }
  }

  var all = ["north", "east", "south", "west"];
  for (var k = 0; k < all.length; k++) {
    if (prefDirs.indexOf(all[k]) < 0) prefDirs.push(all[k]);
  }

  for (var j = 0; j < prefDirs.length; j++) {
    if (safeDir(head, prefDirs[j], me, others, game)) {
      me.setDir(prefDirs[j]);
      return;
    }
  }
}

function safeDir(head, dir, me, others, game) {
  var nx = head[0], ny = head[1];
  if (dir === "north") ny--;
  else if (dir === "south") ny++;
  else if (dir === "east") nx++;
  else if (dir === "west") nx--;

  if (nx < 0 || ny < 0 || nx >= 20 || ny >= 20) return false;
  var cell = game.map[ny][nx];
  if (cell === "x" || cell === "m") return false;

  // 自身（不含尾部）
  for (var i = 0; i < me.body.length - 1; i++) {
    if (me.body[i][0] === nx && me.body[i][1] === ny) return false;
  }

  // 其他蛇
  for (var j = 0; j < others.length; j++) {
    for (var k = 0; k < others[j].body.length; k++) {
      if (others[j].body[k][0] === nx && others[j].body[k][1] === ny) return false;
    }
  }

  return true;
}
