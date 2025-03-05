import { Entity, RigidBodyType, ColliderShape, World } from 'hytopia';
import type { Vector3Like } from 'hytopia';

// Particle appearance
const PARTICLE_COUNT = 15;
const PARTICLE_SCALE = 0.4;
const PARTICLE_LIFETIME_MS = 2000;
const PARTICLE_MODEL_URI = 'models/items/rotting-flesh.gltf';

// Physics properties
const PARTICLE_MASS = 0.4;
const PARTICLE_FRICTION = 0.5;
const PARTICLE_BOUNCINESS = 0.3;
const PARTICLE_BASE_SPEED = 0.2;
const PARTICLE_SPEED_VARIANCE = 0.4; // Will multiply speed by (0.8 to 1.2)

// Force configuration
const FORCE_UPWARD_MIN = 0.1;
const FORCE_UPWARD_MAX = 0.2;
const FORCE_SPIN_STRENGTH = 3;

// Spawn position configuration
const SPAWN_OFFSET_RANGE = 0.5;  // How far particles can spawn from center
const SPAWN_HEIGHT_BOOST = 0.5;  // Extra height added to spawn position

// Performance and pooling
const POOL_SIZE = 500;

export class ZombieDeathEffects {
    private activeParticles: Set<Entity> = new Set();
    private particlePool: Entity[] = [];
    private static instance: ZombieDeathEffects;
    private world: World;

    private constructor(world: World) {
        this.world = world;
    }

    public static getInstance(world?: World): ZombieDeathEffects {
        if (!ZombieDeathEffects.instance && world) {
            ZombieDeathEffects.instance = new ZombieDeathEffects(world);
        }
        return ZombieDeathEffects.instance;
    }

    createDeathEffect(position: Vector3Like, scale: number = 1): void {
        if (!this.world) return;

        console.log('Creating death effect at position:', position, 'with scale:', scale);
        const particleCount = Math.floor(PARTICLE_COUNT * scale);
        
        for (let i = 0; i < particleCount; i++) {
            const particle = this.getParticleFromPool();
            
            const offsetX = (Math.random() - 0.5) * SPAWN_OFFSET_RANGE;
            const offsetY = (Math.random() - 0.5) * SPAWN_OFFSET_RANGE + SPAWN_HEIGHT_BOOST;
            const offsetZ = (Math.random() - 0.5) * SPAWN_OFFSET_RANGE;

            console.log('Spawning particle', i, 'at offset:', { x: offsetX, y: offsetY, z: offsetZ });
            
            particle.spawn(this.world, {
                x: position.x + offsetX,
                y: position.y + offsetY,
                z: position.z + offsetZ
            });

            this.activeParticles.add(particle);

            if (particle.rawRigidBody) {
                const angle = Math.random() * Math.PI * 2;
                const speed = PARTICLE_BASE_SPEED * (1 - PARTICLE_SPEED_VARIANCE/2 + Math.random() * PARTICLE_SPEED_VARIANCE);
                
                particle.rawRigidBody.applyImpulse({
                    x: Math.cos(angle) * speed,
                    y: FORCE_UPWARD_MIN + Math.random() * (FORCE_UPWARD_MAX - FORCE_UPWARD_MIN),
                    z: Math.sin(angle) * speed
                });

                const spin = (Math.random() - 0.5) * FORCE_SPIN_STRENGTH;
                particle.rawRigidBody.applyTorqueImpulse({
                    x: spin,
                    y: spin,
                    z: spin
                });
            }

            setTimeout(() => {
                if (this.activeParticles.has(particle)) {
                    this.returnParticleToPool(particle);
                }
            }, PARTICLE_LIFETIME_MS);
        }
    }

    private getParticleFromPool(): Entity {
        let particle = this.particlePool.pop();
        
        if (!particle) {
            particle = new Entity({
                name: 'ZombieGoreParticle',
                modelUri: PARTICLE_MODEL_URI,
                modelScale: PARTICLE_SCALE,
                rigidBodyOptions: {
                    type: RigidBodyType.DYNAMIC,
                    colliders: [{
                        shape: ColliderShape.BLOCK,
                        halfExtents: {
                            x: PARTICLE_SCALE,
                            y: PARTICLE_SCALE,
                            z: PARTICLE_SCALE
                        },
                        mass: PARTICLE_MASS,
                        friction: PARTICLE_FRICTION,
                        bounciness: PARTICLE_BOUNCINESS
                    }]
                }
            });
        }

        return particle;
    }

    private returnParticleToPool(particle: Entity): void {
        if (particle.isSpawned) {
            particle.despawn();
        }
        this.activeParticles.delete(particle);
        if (this.particlePool.length < POOL_SIZE) {
            this.particlePool.push(particle);
        }
    }
} 