// 守门员：守住出生角落，转身对准后点射

function onIdle(me, enemy, game) {
    var orders = ["north", "east", "south", "west"];
    var facing = me.tank.direction;

    if (!enemy) {
        // 无敌人：在原地转圈扫描
        me.turn("right");
        return;
    }

    var ex = enemy.tank.position[0];
    var ey = enemy.tank.position[1];
    var mx = me.tank.position[0];
    var my = me.tank.position[1];
    var dx = ex - mx;
    var dy = ey - my;

    var towardFacing = Math.abs(dx) >= Math.abs(dy)
        ? (dx > 0 ? "east" : "west")
        : (dy > 0 ? "south" : "north");

    // 转向对准敌人
    if (facing !== towardFacing) {
        var cur = orders.indexOf(facing);
        var tgt = orders.indexOf(towardFacing);
        if ((tgt - cur + 4) % 4 <= 2) me.turn("right"); else me.turn("left");
        return;
    }

    // 已对准：射击
    if (me.tank.shootCooldown === 0) {
        me.fire();
    }

    // 守住出生点附近（不追击）
    var homeX = (me.tank.position[0] <= 2) ? 1 : 18;
    var homeY = (me.tank.position[1] <= 2) ? 1 : 18;
    var hdx = homeX - mx;
    var hdy = homeY - my;

    if (Math.abs(hdx) + Math.abs(hdy) > 2) {
        // 回家
        var homeFacing = Math.abs(hdx) >= Math.abs(hdy)
            ? (hdx > 0 ? "east" : "west")
            : (hdy > 0 ? "south" : "north");
        if (facing !== homeFacing) {
            var cur2 = orders.indexOf(facing);
            var tgt2 = orders.indexOf(homeFacing);
            if ((tgt2 - cur2 + 4) % 4 <= 2) me.turn("right"); else me.turn("left");
        } else {
            me.go();
        }
    }
    // 已在出生点附近：原地等待（已对准后自动射击）
}
