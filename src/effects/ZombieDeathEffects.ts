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
const PARTICLE_BASE_SPEED = 0.15;  // Base speed for all particles
const PARTICLE_SPEED_MIN = 0.8;    // Minimum speed multiplier
const PARTICLE_SPEED_MAX = 1.2;    // Maximum speed multiplier

// Force configuration
const FORCE_UPWARD_BASE = 0.15;    // Base upward force
const FORCE_UPWARD_VARIANCE = 0.1; // How much upward force can vary
const FORCE_SPIN_MIN = 1;         // Minimum spin force
const FORCE_SPIN_MAX = 3;         // Maximum spin force

// Spawn position configuration
const SPAWN_OFFSET_RANGE = 0.5;  // How far particles can spawn from center
const SPAWN_HEIGHT_BOOST = 0.5;  // Extra height added to spawn position

// Performance and pooling
const POOL_SIZE = 500;
const MAX_ACTIVE_PARTICLES = 150;  // Maximum number of particles that can be active at once

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

    private cleanupOldestParticles(count: number): void {
        // Convert Set to Array to get oldest particles (added first)
        const particlesArray = Array.from(this.activeParticles);
        const particlesToRemove = particlesArray.slice(0, count);
        
        console.log(`Cleaning up ${count} old particles`);
        
        for (const particle of particlesToRemove) {
            this.returnParticleToPool(particle);
        }
    }

    createDeathEffect(position: Vector3Like, scale: number = 1): void {
        if (!this.world) return;

        console.log('\n=== Death Effect Debug Info ===');
        console.log(`Pool Status - Size: ${this.particlePool.length}/${POOL_SIZE}, Active: ${this.activeParticles.size}/${MAX_ACTIVE_PARTICLES}`);
        console.log('Creating death effect at position:', position);

        let successfulSpawns = 0;
        
        // Check if we have room for all particles
        const particlesToSpawn = Math.min(PARTICLE_COUNT, MAX_ACTIVE_PARTICLES - this.activeParticles.size);
        
        if (particlesToSpawn < PARTICLE_COUNT) {
            console.warn(`Can only spawn ${particlesToSpawn}/${PARTICLE_COUNT} particles due to active limit`);
        }

        // Always use fixed particle count regardless of zombie scale
        for (let i = 0; i < particlesToSpawn; i++) {
            const particle = this.getParticleFromPool();
            if (!particle) {
                console.warn(`Failed to get particle ${i}`);
                continue;
            }
            
            const offsetX = (Math.random() - 0.5) * SPAWN_OFFSET_RANGE;
            const offsetY = (Math.random() - 0.5) * SPAWN_OFFSET_RANGE + SPAWN_HEIGHT_BOOST;
            const offsetZ = (Math.random() - 0.5) * SPAWN_OFFSET_RANGE;

            particle.spawn(this.world, {
                x: position.x + offsetX,
                y: position.y + offsetY,
                z: position.z + offsetZ
            });

            this.activeParticles.add(particle);
            successfulSpawns++;

            if (particle.rawRigidBody) {
                const angle = Math.random() * Math.PI * 2;
                // Fixed speed calculation independent of zombie scale
                const speedMultiplier = PARTICLE_SPEED_MIN + Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
                const speed = PARTICLE_BASE_SPEED * speedMultiplier;
                
                // Fixed upward force independent of zombie scale
                const upwardForce = FORCE_UPWARD_BASE + (Math.random() * FORCE_UPWARD_VARIANCE);
                
                particle.rawRigidBody.applyImpulse({
                    x: Math.cos(angle) * speed,
                    y: upwardForce,
                    z: Math.sin(angle) * speed
                });

                // Fixed spin force independent of zombie scale
                const spin = FORCE_SPIN_MIN + (Math.random() * (FORCE_SPIN_MAX - FORCE_SPIN_MIN));
                const spinDirection = Math.random() > 0.5 ? 1 : -1;
                particle.rawRigidBody.applyTorqueImpulse({
                    x: spin * spinDirection,
                    y: spin * spinDirection,
                    z: spin * spinDirection
                });
            }

            setTimeout(() => {
                if (this.activeParticles.has(particle)) {
                    console.log('Returning particle to pool:', {
                        beforePoolSize: this.particlePool.length,
                        beforeActiveParticles: this.activeParticles.size
                    });
                    this.returnParticleToPool(particle);
                    console.log('After return:', {
                        afterPoolSize: this.particlePool.length,
                        afterActiveParticles: this.activeParticles.size
                    });
                }
            }, PARTICLE_LIFETIME_MS);
        }

        console.log('=== Death Effect Summary ===');
        console.log('Successfully spawned particles:', successfulSpawns);
        console.log('Final pool size:', this.particlePool.length);
        console.log('Final active particles:', this.activeParticles.size);
    }

    private getParticleFromPool(): Entity | null {
        // First try to get from pool
        let particle = this.particlePool.pop();
        
        // If pool is empty AND we haven't hit max active limit, create new
        if (!particle && this.activeParticles.size < MAX_ACTIVE_PARTICLES) {
            console.log(`Creating new particle - Pool empty, active count: ${this.activeParticles.size}/${MAX_ACTIVE_PARTICLES}`);
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
        } else if (!particle) {
            console.warn('Could not get particle - Max active limit reached');
            return null;
        } else {
            console.log('Reusing particle from pool');
        }

        return particle;
    }

    private returnParticleToPool(particle: Entity): void {
        if (!particle) return;

        if (particle.isSpawned) {
            particle.despawn();
        }
        
        this.activeParticles.delete(particle);
        
        // Only add to pool if we haven't hit pool size limit
        if (this.particlePool.length < POOL_SIZE) {
            this.particlePool.push(particle);
            console.log(`Particle returned to pool (pool size: ${this.particlePool.length}/${POOL_SIZE})`);
        } else {
            console.log('Pool full, discarding particle');
        }
    }
} 