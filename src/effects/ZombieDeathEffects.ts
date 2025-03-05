import { Entity, RigidBodyType, ColliderShape, World } from 'hytopia';
import type { Vector3Like } from 'hytopia';

const ZOMBIE_DEATH_CONFIG = {
    GORE_PARTICLES: {
        COUNT: 15,
        SCALE: 0.4,
        LIFETIME: 2000,
        SPEED: 0.5,
        FORCES: {
            EXPLOSION_MULTIPLIER: 0.8,
            UPWARD_MIN: 1,
            UPWARD_MAX: 2,
            SPIN_STRENGTH: 6
        }
    },
    POOLING: {
        POOL_SIZE: 50
    }
};

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
        const particleCount = Math.floor(ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.COUNT * scale);
        
        for (let i = 0; i < particleCount; i++) {
            const particle = this.getParticleFromPool();
            
            const offsetX = (Math.random() - 0.5) * 0.5;
            const offsetY = (Math.random() - 0.5) * 0.5 + 0.5;
            const offsetZ = (Math.random() - 0.5) * 0.5;

            console.log('Spawning particle', i, 'at offset:', { x: offsetX, y: offsetY, z: offsetZ });
            
            particle.spawn(this.world, {
                x: position.x + offsetX,
                y: position.y + offsetY,
                z: position.z + offsetZ
            });

            this.activeParticles.add(particle);

            if (particle.rawRigidBody) {
                const angle = Math.random() * Math.PI * 2;
                const speed = ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.SPEED * (0.8 + Math.random() * 0.4);
                
                particle.rawRigidBody.applyImpulse({
                    x: Math.cos(angle) * speed,
                    y: ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.FORCES.UPWARD_MIN + 
                       Math.random() * (ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.FORCES.UPWARD_MAX),
                    z: Math.sin(angle) * speed
                });

                const spin = (Math.random() - 0.5) * ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.FORCES.SPIN_STRENGTH;
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
            }, ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.LIFETIME);
        }
    }

    private getParticleFromPool(): Entity {
        let particle = this.particlePool.pop();
        
        if (!particle) {
            particle = new Entity({
                name: 'ZombieGoreParticle',
                modelUri: 'models/items/rotting-flesh.gltf',
                modelScale: ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.SCALE,
                rigidBodyOptions: {
                    type: RigidBodyType.DYNAMIC,
                    colliders: [{
                        shape: ColliderShape.BLOCK,
                        halfExtents: {
                            x: ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.SCALE,
                            y: ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.SCALE,
                            z: ZOMBIE_DEATH_CONFIG.GORE_PARTICLES.SCALE
                        },
                        mass: 0.1,
                        friction: 0.5,
                        bounciness: 0.3
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
        if (this.particlePool.length < ZOMBIE_DEATH_CONFIG.POOLING.POOL_SIZE) {
            this.particlePool.push(particle);
        }
    }
} 