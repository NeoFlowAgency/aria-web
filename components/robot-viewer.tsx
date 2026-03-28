'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export type Expression = 'content' | 'triste' | 'surpris' | 'colere' | 'amoureux' | 'neutre'
export type RobotState  = 'repos' | 'ecoute' | 'reflechit' | 'parle' | 'danse'

const OLED_COLORS: Record<Expression, number> = {
  content:  0x34c759,
  triste:   0x0071e3,
  surpris:  0xff9500,
  colere:   0xff3b30,
  amoureux: 0xff2d55,
  neutre:   0xaaaaaa,
}

interface RobotViewerProps {
  expression?: Expression
  state?:      RobotState
  servoAngle?: number
  className?:  string
}

export default function RobotViewer({
  expression = 'neutre',
  state      = 'repos',
  servoAngle = 90,
  className,
}: RobotViewerProps) {
  const mountRef    = useRef<HTMLDivElement>(null)
  const sceneRef    = useRef<{
    renderer: THREE.WebGLRenderer
    scene:    THREE.Scene
    camera:   THREE.PerspectiveCamera
    head:     THREE.Group
    body:     THREE.Group
    oled:     THREE.Mesh
    antenna:  THREE.Mesh
    raf:      number
  } | null>(null)

  // Init Three.js une seule fois
  useEffect(() => {
    if (!mountRef.current) return
    const el = mountRef.current
    const W = el.clientWidth  || 600
    const H = el.clientHeight || 480

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setSize(W, H)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    renderer.setClearColor(0xf5f5f7)
    el.appendChild(renderer.domElement)

    // Scene + Camera
    const scene  = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100)
    camera.position.set(0, 0.5, 5.5)

    // Lumières
    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
    dirLight.position.set(3, 5, 3)
    dirLight.castShadow = true
    scene.add(dirLight)
    const fillLight = new THREE.PointLight(0xe0e8ff, 0.4)
    fillLight.position.set(-3, 2, 2)
    scene.add(fillLight)

    // Matériaux
    const matBody   = new THREE.MeshStandardMaterial({ color: 0xe8e8ed, roughness: 0.3, metalness: 0.1 })
    const matArm    = new THREE.MeshStandardMaterial({ color: 0xd2d2d7, roughness: 0.4 })
    const matHead   = new THREE.MeshStandardMaterial({ color: 0xf5f5f7, roughness: 0.25, metalness: 0.05 })
    const matAntenna = new THREE.MeshStandardMaterial({ color: 0x86868b, roughness: 0.5 })
    const matDot    = new THREE.MeshStandardMaterial({ color: 0x0071e3, emissive: new THREE.Color(0x0071e3), emissiveIntensity: 0.4 })
    const matOled   = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, emissive: new THREE.Color(0xaaaaaa), emissiveIntensity: 1.0, roughness: 0.05 })

    const box = (w: number, h: number, d: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      m.castShadow = true
      return m
    }
    const cyl = (r: number, h: number, mat: THREE.Material) =>
      new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat)
    const sph = (r: number, mat: THREE.Material) =>
      new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12), mat)

    // Corps
    const body = new THREE.Group()
    const torso = box(1.2, 1.6, 0.8, matBody)
    body.add(torso)
    const armL = box(0.18, 0.8, 0.18, matArm); armL.position.set(-0.75, 0, 0); body.add(armL)
    const armR = box(0.18, 0.8, 0.18, matArm); armR.position.set( 0.75, 0, 0); body.add(armR)
    const base = box(0.9, 0.25, 0.7, matArm);  base.position.set(0, -1.0, 0);  body.add(base)

    // Tête
    const head   = new THREE.Group()
    const skull  = box(0.9, 0.85, 0.75, matHead); head.add(skull)
    const oled   = box(0.55, 0.38, 0.01, matOled); oled.position.set(0, 0.05, 0.385); head.add(oled)
    const ant    = cyl(0.025, 0.35, matAntenna); ant.position.set(0, 0.6, 0); head.add(ant)
    const dot    = sph(0.05, matDot);             dot.position.set(0, 0.78, 0); head.add(dot)
    head.position.set(0, 1.1, 0)
    body.add(head)

    // Float offset
    body.position.set(0, -0.3, 0)
    scene.add(body)

    sceneRef.current = { renderer, scene, camera, head, body, oled, antenna: dot, raf: 0 }

    // Resize
    const onResize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    // Basic orbit (drag)
    let isDragging = false, prevX = 0
    const onDown  = (e: MouseEvent) => { isDragging = true; prevX = e.clientX }
    const onUp    = ()               => { isDragging = false }
    const onMove  = (e: MouseEvent) => {
      if (!isDragging) return
      body.rotation.y += (e.clientX - prevX) * 0.01
      prevX = e.clientX
    }
    renderer.domElement.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('mousemove', onMove)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(sceneRef.current?.raf ?? 0)
      renderer.dispose()
      el.removeChild(renderer.domElement)
      sceneRef.current = null
    }
  }, [])

  // Réagir aux props sans recréer la scène
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return

    const targetOledColor = new THREE.Color(OLED_COLORS[expression])
    const targetHeadY = THREE.MathUtils.degToRad(-(servoAngle - 90))
    let t = 0

    cancelAnimationFrame(s.raf)

    const animate = () => {
      s.raf = requestAnimationFrame(animate)
      t += 0.016

      // Float
      s.body.position.y = -0.3 + Math.sin(t * 1.5) * 0.06

      // State animations
      if (state === 'danse') {
        s.body.rotation.z = Math.sin(t * 4) * 0.15
        s.body.position.y = Math.sin(t * 4) * 0.1
      } else if (state === 'parle') {
        s.body.rotation.z = Math.sin(t * 6) * 0.02
      } else {
        s.body.rotation.z *= 0.95
      }

      // Tête servo
      s.head.rotation.y += (targetHeadY - s.head.rotation.y) * 0.08

      // OLED couleur
      const oledMat = s.oled.material as THREE.MeshStandardMaterial
      oledMat.color.lerp(targetOledColor, 0.05)
      oledMat.emissive.lerp(targetOledColor, 0.05)

      // Antenne pulse si écoute
      const antMat = s.antenna.material as THREE.MeshStandardMaterial
      antMat.emissiveIntensity = state === 'ecoute'
        ? 0.5 + Math.sin(t * 6) * 0.5
        : 0.4

      s.renderer.render(s.scene, s.camera)
    }

    animate()
  }, [expression, state, servoAngle])

  return <div ref={mountRef} className={className} style={{ touchAction: 'none' }} />
}
