'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

type Expression = 'content' | 'triste' | 'surpris' | 'colere' | 'amoureux' | 'neutre'
type RobotState = 'repos' | 'ecoute' | 'reflechit' | 'parle' | 'danse'

const EXPRESSION_COLORS: Record<Expression, string> = {
  content:  '#34c759',
  triste:   '#0071e3',
  surpris:  '#ff9500',
  colere:   '#ff3b30',
  amoureux: '#ff2d55',
  neutre:   '#aaaaaa',
}

interface RobotProps {
  expression: Expression
  state: RobotState
  servoAngle: number
}

function RobotScene({ expression, state, servoAngle }: RobotProps) {
  const bodyRef  = useRef<THREE.Group>(null)
  const headRef  = useRef<THREE.Group>(null)
  const oledRef  = useRef<THREE.Mesh>(null)

  const targetColor = useMemo(
    () => new THREE.Color(EXPRESSION_COLORS[expression]),
    [expression]
  )

  const targetHeadY = useMemo(
    () => THREE.MathUtils.degToRad(-(servoAngle - 90)),
    [servoAngle]
  )

  useFrame((_, delta) => {
    if (!bodyRef.current || !headRef.current) return

    // Rotation tête
    headRef.current.rotation.y = THREE.MathUtils.lerp(
      headRef.current.rotation.y, targetHeadY, delta * 4
    )

    // Animations selon état
    const t = _.clock.elapsedTime
    if (state === 'danse') {
      bodyRef.current.rotation.z = Math.sin(t * 4) * 0.15
      bodyRef.current.rotation.y = Math.sin(t * 2) * 0.2
      bodyRef.current.position.y = Math.sin(t * 4) * 0.1
    } else if (state === 'parle') {
      bodyRef.current.rotation.z = Math.sin(t * 6) * 0.02
      bodyRef.current.position.y = THREE.MathUtils.lerp(bodyRef.current.position.y, 0, delta * 4)
      bodyRef.current.rotation.y = THREE.MathUtils.lerp(bodyRef.current.rotation.y, 0, delta * 3)
    } else {
      bodyRef.current.rotation.z = THREE.MathUtils.lerp(bodyRef.current.rotation.z, 0, delta * 3)
      bodyRef.current.rotation.y = THREE.MathUtils.lerp(bodyRef.current.rotation.y, 0, delta * 3)
      bodyRef.current.position.y = THREE.MathUtils.lerp(bodyRef.current.position.y, 0, delta * 4)
    }

    // Couleur OLED
    if (oledRef.current) {
      const mat = oledRef.current.material as THREE.MeshStandardMaterial
      mat.color.lerp(targetColor, delta * 3)
      mat.emissive.lerp(targetColor, delta * 3)
    }
  })

  return (
    <Float speed={1.5} rotationIntensity={0.08} floatIntensity={0.25}>
      <group ref={bodyRef}>
        {/* Corps */}
        <mesh castShadow>
          <boxGeometry args={[1.2, 1.6, 0.8]} />
          <meshStandardMaterial color="#e8e8ed" roughness={0.3} metalness={0.1} />
        </mesh>

        {/* Bras gauche */}
        <mesh position={[-0.75, 0, 0]} castShadow>
          <boxGeometry args={[0.18, 0.8, 0.18]} />
          <meshStandardMaterial color="#d2d2d7" roughness={0.4} />
        </mesh>

        {/* Bras droit */}
        <mesh position={[0.75, 0, 0]} castShadow>
          <boxGeometry args={[0.18, 0.8, 0.18]} />
          <meshStandardMaterial color="#d2d2d7" roughness={0.4} />
        </mesh>

        {/* Base */}
        <mesh position={[0, -1.0, 0]} castShadow>
          <boxGeometry args={[0.9, 0.25, 0.7]} />
          <meshStandardMaterial color="#d2d2d7" roughness={0.5} />
        </mesh>

        {/* Tête */}
        <group ref={headRef} position={[0, 1.1, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.9, 0.85, 0.75]} />
            <meshStandardMaterial color="#f5f5f7" roughness={0.25} metalness={0.05} />
          </mesh>

          {/* Écran OLED */}
          <mesh ref={oledRef} position={[0, 0.05, 0.385]}>
            <boxGeometry args={[0.55, 0.38, 0.01]} />
            <meshStandardMaterial
              color={EXPRESSION_COLORS[expression]}
              emissive={new THREE.Color(EXPRESSION_COLORS[expression])}
              emissiveIntensity={1.0}
              roughness={0.05}
            />
          </mesh>

          {/* Antenne */}
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.35, 8]} />
            <meshStandardMaterial color="#86868b" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.78, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial
              color="#0071e3"
              emissive={new THREE.Color('#0071e3')}
              emissiveIntensity={state === 'ecoute' ? 2 : 0.4}
            />
          </mesh>
        </group>
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
      <Canvas camera={{ position: [0, 0.5, 5], fov: 40 }} shadows gl={{ antialias: true }}>
        <color attach="background" args={['#f5f5f7']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 3]} intensity={1.2} castShadow />
        <pointLight position={[-3, 2, 2]} intensity={0.5} color="#ffffff" />
        <pointLight position={[0, -2, 2]} intensity={0.3} color="#e0e8ff" />

        <RobotScene expression={expression} state={state} servoAngle={servoAngle} />

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
