// 冲锋者：沿曼哈顿路径全速逼近最近敌人并射击

function onIdle(me, enemy, game) {
    if (!enemy) {
        // 无敌人：随机游走
        me.go();
        return;
    }

    var ex = enemy.tank.position[0];
    var ey = enemy.tank.position[1];
    var mx = me.tank.position[0];
    var my = me.tank.position[1];

    var dx = ex - mx;
    var dy = ey - my;

    // 瞄准：先转向对准敌人所在轴
    var facing = me.tank.direction;
    var wantFacing;
    if (Math.abs(dx) >= Math.abs(dy)) {
        wantFacing = dx > 0 ? "east" : "west";
    } else {
        wantFacing = dy > 0 ? "south" : "north";
    }

    if (facing !== wantFacing) {
        // 用最少次数转到目标朝向
        var orders = ["north", "east", "south", "west"];
        var cur = orders.indexOf(facing);
        var tgt = orders.indexOf(wantFacing);
        var diff = (tgt - cur + 4) % 4;
        if (diff === 1 || diff === 0) me.turn("right");
        else me.turn("left");
        return;
    }

    // 已对准：射击（如果没冷却）
    if (me.tank.shootCooldown === 0) {
        me.fire();
    }

    // 前进
    me.go();
}
