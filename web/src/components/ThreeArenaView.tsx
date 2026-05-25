"use client"

import { useEffect, useRef } from "react"
import * as THREE from "three"

// ── 共享类型（与 replay page 保持一致）──────────────────────────────────────
interface TankSnapshot {
  id: number; name: string
  x: number; y: number
  body_angle: number; turret_angle: number
  hp: number; alive: boolean
}
interface BulletSnapshot { x: number; y: number }
interface FrameData { tick: number; tanks: TankSnapshot[]; bullets: BulletSnapshot[] }
interface ArenaConfig { width: number; height: number; map: string[] }

export type ViewMode3D = "first" | "third"

export interface ThreeArenaViewProps {
  frame: FrameData | null
  arena: ArenaConfig
  viewMode: ViewMode3D
  playerTankId?: number
  className?: string
}

// ── 常量 ─────────────────────────────────────────────────────────────────────
const COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xa78bfa]  // 蓝、红、绿、紫
const COLOR_DEAD = 0x3f3f46
const TILE_SIZE = 40     // 每格 40px（世界坐标）
const WALL_H = 40
const GRASS_H = 18       // 草叶高度
const OFS = 400          // 800×800 竞技场居中偏移（20×40/2）
const BULLET_POOL = 30   // 子弹对象池大小
const EYE_H = 16         // 第一人称相机高度

// ── 坦克模型构建 ───────────────────────────────────────────────────────────────
// 坦克沿 +X 轴方向为"正前方"，旋转公式：group.rotation.y = -body_angle
function buildTankMeshes(color: number) {
  const bodyMat  = new THREE.MeshLambertMaterial({ color, transparent: true })
  const turretMat = new THREE.MeshLambertMaterial({ color, transparent: true })
  const group = new THREE.Group()

  // 车体：28(x) × 10(y) × 20(z)
  const body = new THREE.Mesh(new THREE.BoxGeometry(28, 10, 20), bodyMat)
  body.position.y = 5
  body.castShadow = true
  group.add(body)

  // 炮塔组（独立旋转）
  const turretGroup = new THREE.Group()
  turretGroup.position.y = 10

  const dome = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 6, 12), turretMat)
  dome.position.y = 3
  dome.castShadow = true
  turretGroup.add(dome)

  // 炮管：沿 +X 延伸，旋转 Z 轴 90° 使圆柱水平
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 22, 6), turretMat)
  barrel.rotation.z = Math.PI / 2
  barrel.position.set(11, 3, 0)  // 从圆心延伸到 x=22
  turretGroup.add(barrel)

  group.add(turretGroup)
  return { group, turretGroup, bodyMat, turretMat }
}

type TankEntry = ReturnType<typeof buildTankMeshes>

// ── 主组件 ─────────────────────────────────────────────────────────────────────
export function ThreeArenaView({
  frame, arena, viewMode, playerTankId = 0, className,
}: ThreeArenaViewProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef    = useRef<THREE.Scene | null>(null)
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null)
  const tankMapRef  = useRef<Map<number, TankEntry>>(new Map())
  const bulletPoolRef = useRef<THREE.Mesh[]>([])

  // ── 初始化（依赖 arena 布局）───────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    mount.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Camera
    const camera = new THREE.PerspectiveCamera(70, 1, 1, 2000)
    camera.position.set(0, 400, 400)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x09090b)
    scene.fog = new THREE.FogExp2(0x09090b, 0.0011)
    sceneRef.current = scene

    // 光照
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(300, 500, 150)
    sun.castShadow = true
    sun.shadow.mapSize.setScalar(2048)
    const sc = sun.shadow.camera as THREE.OrthographicCamera
    Object.assign(sc, { near: 1, far: 1600, left: -600, right: 600, top: 600, bottom: -600 })
    scene.add(sun)

    // 世界尺寸（从 map 计算，保持与 20×40=800 的世界坐标一致）
    const mapRows = arena.map.length || 20
    const mapCols = arena.map[0]?.length || 20
    const worldW = mapCols * TILE_SIZE
    const worldH = mapRows * TILE_SIZE

    // 地面
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldH),
      new THREE.MeshLambertMaterial({ color: 0x18181b }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    // 地面网格线（每格一格）
    const grid = new THREE.GridHelper(worldW, mapCols, 0x27272a, 0x27272a)
    grid.position.y = 0.2
    scene.add(grid)

    // 边界条（蓝色发光）
    const bMat = new THREE.MeshLambertMaterial({ color: 0x3b82f6, emissive: 0x1e3a8a, emissiveIntensity: 0.5 })
    const bt = 5, bh = 8, w = worldW, h = worldH
    const borderDefs: [number, number, number, number, number, number][] = [
      [w, bh, bt,  0,          bh / 2, -h / 2 - bt / 2],
      [w, bh, bt,  0,          bh / 2,  h / 2 + bt / 2],
      [bt, bh, h, -w / 2 - bt / 2, bh / 2, 0],
      [bt, bh, h,  w / 2 + bt / 2, bh / 2, 0],
    ]
    for (const [bw, bH, bd, bx, by, bz] of borderDefs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bH, bd), bMat)
      m.position.set(bx, by, bz)
      scene.add(m)
    }

    // Tile 地图渲染：x=永久墙, m=土堆, o=草丛
    const wallMat     = new THREE.MeshLambertMaterial({ color: 0x52525b })
    const moundMat    = new THREE.MeshLambertMaterial({ color: 0x78350f })
    // 草地：深绿地基 + 3 片交叉草叶（best practice crossed planes）
    const grassFloor  = new THREE.MeshLambertMaterial({ color: 0x14532d })
    const grassBlade  = new THREE.MeshLambertMaterial({ color: 0x16a34a, side: THREE.DoubleSide })
    const bladeGeo    = new THREE.PlaneGeometry(TILE_SIZE * 0.88, GRASS_H)
    const floorGeo    = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE)

    for (let row = 0; row < arena.map.length; row++) {
      for (let col = 0; col < arena.map[row].length; col++) {
        const ch = arena.map[row][col]
        if (ch !== 'x' && ch !== 'm' && ch !== 'o') continue
        const px = col * TILE_SIZE + TILE_SIZE / 2 - OFS
        const pz = row * TILE_SIZE + TILE_SIZE / 2 - OFS

        if (ch === 'o') {
          // 深绿地面
          const floor = new THREE.Mesh(floorGeo, grassFloor)
          floor.rotation.x = -Math.PI / 2
          floor.position.set(px, 0.4, pz)
          floor.receiveShadow = true
          scene.add(floor)
          // 3 片草叶，每片间隔 60°
          for (let i = 0; i < 3; i++) {
            const blade = new THREE.Mesh(bladeGeo, grassBlade)
            blade.position.set(px, GRASS_H / 2, pz)
            blade.rotation.y = (i * Math.PI) / 3
            scene.add(blade)
          }
        } else {
          const mat = ch === 'x' ? wallMat : moundMat
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE, WALL_H, TILE_SIZE), mat)
          mesh.position.set(px, WALL_H / 2, pz)
          mesh.castShadow = true
          mesh.receiveShadow = true
          scene.add(mesh)
        }
      }
    }

    // 子弹对象池（避免每帧 new Mesh）
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xfef08a })
    for (let i = 0; i < BULLET_POOL; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 8), bulletMat)
      b.visible = false
      scene.add(b)
      bulletPoolRef.current.push(b)
    }

    // 响应式尺寸
    const ro = new ResizeObserver(() => {
      const { clientWidth: cw, clientHeight: ch } = mount
      if (cw === 0 || ch === 0) return
      renderer.setSize(cw, ch)
      camera.aspect = cw / ch
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)
    const { clientWidth: cw, clientHeight: ch } = mount
    if (cw > 0 && ch > 0) {
      renderer.setSize(cw, ch)
      camera.aspect = cw / ch
      camera.updateProjectionMatrix()
    }

    return () => {
      ro.disconnect()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
          else obj.material.dispose()
        }
      })
      renderer.dispose()
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      rendererRef.current = null
      sceneRef.current    = null
      cameraRef.current   = null
      tankMapRef.current.clear()
      bulletPoolRef.current = []
    }
  }, [arena])

  // ── 每帧更新 ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const renderer = rendererRef.current
    const scene    = sceneRef.current
    const camera   = cameraRef.current
    if (!renderer || !scene || !camera || !frame) return

    // 坦克位姿更新（懒创建）
    for (const tank of frame.tanks) {
      if (!tankMapRef.current.has(tank.id)) {
        const data = buildTankMeshes(COLORS[tank.id] ?? 0xffffff)
        scene.add(data.group)
        tankMapRef.current.set(tank.id, data)
      }
      const { group, turretGroup, bodyMat, turretMat } = tankMapRef.current.get(tank.id)!
      const color = tank.alive ? (COLORS[tank.id] ?? 0xffffff) : COLOR_DEAD
      bodyMat.color.setHex(color)
      turretMat.color.setHex(color)
      group.position.set(tank.x - OFS, tank.alive ? 0 : -5, tank.y - OFS)
      group.rotation.y = -tank.body_angle
      turretGroup.rotation.y = -(tank.turret_angle - tank.body_angle)
      // 草丛隐身：观察者可见，但半透明鬼影
      const tCol = Math.floor(tank.x / TILE_SIZE)
      const tRow = Math.floor(tank.y / TILE_SIZE)
      const onGrass = tank.alive && arena.map[tRow]?.[tCol] === 'o'
      bodyMat.opacity  = onGrass ? 0.38 : 1.0
      turretMat.opacity = onGrass ? 0.38 : 1.0
    }

    // 子弹（对象池复用）
    for (let i = 0; i < bulletPoolRef.current.length; i++) {
      const mesh = bulletPoolRef.current[i]
      if (i < frame.bullets.length) {
        mesh.position.set(frame.bullets[i].x - OFS, 12, frame.bullets[i].y - OFS)
        mesh.visible = true
      } else {
        mesh.visible = false
      }
    }

    // 相机跟随（优先跟随存活的玩家坦克）
    const player =
      frame.tanks.find(t => t.id === playerTankId && t.alive) ??
      frame.tanks.find(t => t.id === playerTankId) ??
      frame.tanks[0]

    if (player) {
      const px = player.x - OFS
      const pz = player.y - OFS

      if (viewMode === "first") {
        // 第一人称：炮塔视角
        camera.position.set(px, EYE_H, pz)
        camera.lookAt(
          px + Math.cos(player.turret_angle) * 500,
          EYE_H,
          pz + Math.sin(player.turret_angle) * 500,
        )
      } else {
        // 第三人称：跟随车体，从身后上方俯看
        const dist = 130, height = 75
        camera.position.set(
          px - Math.cos(player.body_angle) * dist,
          height,
          pz - Math.sin(player.body_angle) * dist,
        )
        camera.lookAt(px, 15, pz)
      }
    }

    renderer.render(scene, camera)
  }, [frame, viewMode, playerTankId])

  return (
    <div
      ref={mountRef}
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  )
}

export default ThreeArenaView
