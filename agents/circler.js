// 侧翼手：侧向绕行敌人，对准时射击

var _side = 1; // 1=右绕, -1=左绕

function onIdle(me, enemy, game) {
    var orders = ["north", "east", "south", "west"];

    if (!enemy) {
        me.turn("right");
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

    var facing = me.tank.direction;

    if (facing === towardFacing && me.tank.shootCooldown === 0) {
        me.fire();
    }

    // 每 8 帧换绕行方向
    if (game.frames % 8 === 0) _side = -_side;

    var ti = orders.indexOf(towardFacing);
    var sideFacing = orders[(ti + _side + 4) % 4];

    var targetFacing = dist <= 4 ? sideFacing : towardFacing;

    if (facing !== targetFacing) {
        var cur = orders.indexOf(facing);
        var tgt = orders.indexOf(targetFacing);
        if ((tgt - cur + 4) % 4 <= 2) me.turn("right"); else me.turn("left");
    } else {
        me.go();
    }
}
