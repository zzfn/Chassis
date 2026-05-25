// 狙击手：保持距离对准后射击，射击后后退

var _retreating = 0;

function onIdle(me, enemy, game) {
    var orders = ["north", "east", "south", "west"];
    var facing = me.tank.direction;

    if (!enemy) {
        me.go();
        return;
    }

    var ex = enemy.tank.position[0];
    var ey = enemy.tank.position[1];
    var mx = me.tank.position[0];
    var my = me.tank.position[1];
    var dx = ex - mx;
    var dy = ey - my;
    var dist = Math.abs(dx) + Math.abs(dy);

    var towardFacing = Math.abs(dx) >= Math.abs(dy)
        ? (dx > 0 ? "east" : "west")
        : (dy > 0 ? "south" : "north");

    var awayFacing = orders[(orders.indexOf(towardFacing) + 2) % 4];

    if (_retreating > 0) {
        _retreating--;
        // 后退：转向逃跑方向
        if (facing !== awayFacing) {
            var cur = orders.indexOf(facing);
            var tgt = orders.indexOf(awayFacing);
            if ((tgt - cur + 4) % 4 <= 2) me.turn("right"); else me.turn("left");
        } else {
            me.go();
        }
        return;
    }

    // 理想距离 5~8 格
    if (dist < 5) {
        // 太近：后退
        if (facing !== awayFacing) {
            var cur2 = orders.indexOf(facing);
            var tgt2 = orders.indexOf(awayFacing);
            if ((tgt2 - cur2 + 4) % 4 <= 2) me.turn("right"); else me.turn("left");
        } else {
            me.go();
        }
        return;
    }

    // 对准敌人
    if (facing !== towardFacing) {
        var cur3 = orders.indexOf(facing);
        var tgt3 = orders.indexOf(towardFacing);
        if ((tgt3 - cur3 + 4) % 4 <= 2) me.turn("right"); else me.turn("left");
        return;
    }

    // 已对准，射击
    if (me.tank.shootCooldown === 0) {
        me.fire();
        _retreating = 4;
        return;
    }

    // 等待冷却期间侧移
    var sideFacing = orders[(orders.indexOf(towardFacing) + 1) % 4];
    if (facing !== sideFacing) {
        me.turn("right");
    } else {
        me.go();
    }
}
