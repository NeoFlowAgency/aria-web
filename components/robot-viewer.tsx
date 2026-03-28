'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, Environment, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

type Expression = 'content' | 'triste' | 'surpris' | 'colere' | 'amoureux' | 'neutre'
type RobotState = 'repos' | 'ecoute' | 'reflechit' | 'parle' | 'danse'

interface RobotProps {
  expression: Expression
  state: RobotState
  servoAngle: number // 0–180
}

// Couleurs OLED selon expression
const EXPRESSION_COLORS: Record<Expression, string> = {
  content: '#34c759',
  triste: '#0071e3',
  surpris: '#ff9500',
  colere: '#ff3b30',
  amoureux: '#ff2d55',
  neutre: '#ffffff',
}

function RobotMesh({ expression, state, servoAngle }: RobotProps) {
  const bodyRef = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Group>(null)
  const oledRef = useRef<THREE.MeshStandardMaterial>(null)
  const armRef = useRef<THREE.Group>(null)

  const oledColor = useMemo(
    () => new THREE.Color(EXPRESSION_COLORS[expression]),
    [expression]
  )

  // Angle servo → rotation tête (-90° à +90° autour de Y)
  const headRotY = useMemo(
    () => THREE.MathUtils.degToRad(-(servoAngle - 90)),
    [servoAngle]
  )

  useFrame((state_three, delta) => {
    if (!headRef.current || !bodyRef.current) return

    // Rotation douce de la tête vers la cible
    headRef.current.rotation.y = THREE.MathUtils.lerp(
      headRef.current.rotation.y,
      headRotY,
      delta * 4
    )

    // Animation selon l'état
    if (state === 'danse') {
      const t = state_three.clock.elapsedTime
      bodyRef.current.rotation.z = Math.sin(t * 4) * 0.15
      bodyRef.current.rotation.y = Math.sin(t * 2) * 0.2
      bodyRef.current.position.y = Math.sin(t * 4) * 0.08
    } else if (state === 'parle') {
      const t = state_three.clock.elapsedTime
      bodyRef.current.rotation.z = Math.sin(t * 6) * 0.03
      bodyRef.current.rotation.y = THREE.MathUtils.lerp(bodyRef.current.rotation.y, 0, delta * 2)
      bodyRef.current.position.y = THREE.MathUtils.lerp(bodyRef.current.position.y, 0, delta * 4)
    } else {
      bodyRef.current.rotation.z = THREE.MathUtils.lerp(bodyRef.current.rotation.z, 0, delta * 3)
      bodyRef.current.rotation.y = THREE.MathUtils.lerp(bodyRef.current.rotation.y, 0, delta * 3)
      bodyRef.current.position.y = THREE.MathUtils.lerp(bodyRef.current.position.y, 0, delta * 4)
    }

    // Mise à jour couleur OLED
    if (oledRef.current) {
      oledRef.current.emissive.lerp(oledColor, delta * 3)
      oledRef.current.color.lerp(oledColor, delta * 3)
    }
  })

  return (
    <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.3}>
      <group ref={bodyRef}>
        {/* Corps principal */}
        <mesh castShadow position={[0, 0, 0]}>
          <boxGeometry args={[1.2, 1.6, 0.8]} />
          <meshStandardMaterial color="#e8e8ed" roughness={0.3} metalness={0.1} />
        </mesh>

        {/* Épaules */}
        <mesh position={[-0.8, 0.4, 0]}>
          <sphereGeometry args={[0.18, 16, 16]} />
          <meshStandardMaterial color="#d2d2d7" roughness={0.4} metalness={0.15} />
        </mesh>
        <mesh position={[0.8, 0.4, 0]}>
          <sphereGeometry args={[0.18, 16, 16]} />
          <meshStandardMaterial color="#d2d2d7" roughness={0.4} metalness={0.15} />
        </mesh>

        {/* Bras gauche (servo) */}
        <group ref={armRef} position={[-0.8, 0.4, 0]}>
          <mesh position={[-0.3, -0.4, 0]} castShadow>
            <boxGeometry args={[0.18, 0.7, 0.18]} />
            <meshStandardMaterial color="#d2d2d7" roughness={0.4} metalness={0.15} />
          </mesh>
        </group>

        {/* Bras droit */}
        <mesh position={[0.8 + 0.15, 0, 0]} castShadow>
          <boxGeometry args={[0.15, 0.7, 0.15]} />
          <meshStandardMaterial color="#d2d2d7" roughness={0.4} metalness={0.15} />
        </mesh>

        {/* Tête */}
        <group ref={headRef} position={[0, 1.05, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.9, 0.85, 0.75]} />
            <meshStandardMaterial color="#f5f5f7" roughness={0.25} metalness={0.05} />
          </mesh>

          {/* Écran OLED */}
          <mesh position={[0, 0.05, 0.38]}>
            <boxGeometry args={[0.55, 0.4, 0.01]} />
            <meshStandardMaterial
              ref={oledRef}
              color={EXPRESSION_COLORS[expression]}
              emissive={new THREE.Color(EXPRESSION_COLORS[expression])}
              emissiveIntensity={0.8}
              roughness={0.1}
              metalness={0}
            />
          </mesh>

          {/* Antenne */}
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.35, 8]} />
            <meshStandardMaterial color="#86868b" roughness={0.5} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial
              color="#0071e3"
              emissive={new THREE.Color('#0071e3')}
              emissiveIntensity={state === 'ecoute' ? 1.5 : 0.3}
            />
          </mesh>
        </group>

        {/* Base / pieds */}
        <mesh position={[0, -1.1, 0]} castShadow>
          <boxGeometry args={[0.9, 0.2, 0.7]} />
          <meshStandardMaterial color="#d2d2d7" roughness={0.5} metalness={0.2} />
        </mesh>
      </group>
    </Float>
  )
}

interface RobotViewerProps {
  expression?: Expression
  state?: RobotState
  servoAngle?: number
  className?: string
}

export default function RobotViewer({
  expression = 'neutre',
  state = 'repos',
  servoAngle = 90,
  className,
}: RobotViewerProps) {
  return (
    <div className={className} style={{ touchAction: 'none' }}>
      <Canvas
        camera={{ position: [0, 0.5, 5], fov: 40 }}
        shadows
        gl={{ antialias: true }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[3, 5, 3]}
          intensity={1.2}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <pointLight position={[-2, 2, 2]} intensity={0.4} color="#ffffff" />

        <RobotMesh expression={expression} state={state} servoAngle={servoAngle} />

        <Environment preset="city" />
        <OrbitControls
          enablePan={false}
          minDistance={3}
          maxDistance={8}
          maxPolarAngle={Math.PI / 1.8}
        />
      </Canvas>
    </div>
  )
}
