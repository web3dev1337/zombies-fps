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
const PARTICLE_BASE_SPEED = 0.1;    // Reduced base speed for more consistency
const PARTICLE_SPEED_MIN = 0.9;     // Tightened speed range
const PARTICLE_SPEED_MAX = 1.1;     // Tightened speed range

// Force configuration
const FORCE_UPWARD_BASE = 0.2;      // Increased base upward force
const FORCE_UPWARD_VARIANCE = 0.05; // Reduced variance for more consistency
const FORCE_SPIN_MIN = 0.5;         // Reduced spin for more visibility
const FORCE_SPIN_MAX = 1.5;         // Reduced spin for more visibility

// Spawn position configuration
const SPAWN_OFFSET_RANGE = 0.3;    // Reduced spread for tighter grouping
const SPAWN_HEIGHT_BOOST = 0.7;    // Increased height for better visibility

// Performance and pooling
const POOL_SIZE = 500;
const MAX_ACTIVE_PARTICLES = 150;  // Maximum number of particles that can be active at once

export class ZombieDeathEffects {
    private activeParticles: Set<Entity> = new Set();
    private particlePool: Entity[] = [];
    private static instance: ZombieDeathEffects;
    private world: World;
    private particleSpawnTimes = new Map<Entity, number>();
    private cleanupInterval: any = null;

    private constructor(world: World) {
        this.world = world;
        
        // Preload the particle pool
        console.log('Preloading particle pool...');
        for (let i = 0; i < POOL_SIZE; i++) {
            const particle = new Entity({
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
            this.particlePool.push(particle);
        }
        console.log(`Particle pool preloaded with ${POOL_SIZE} particles`);

        // Start the cleanup interval
        this.cleanupInterval = setInterval(() => this.forceCleanupParticles(), 5000);
    }

    public static getInstance(world?: World): ZombieDeathEffects {
        if (!ZombieDeathEffects.instance && world) {
            ZombieDeathEffects.instance = new ZombieDeathEffects(world);
        }
        return ZombieDeathEffects.instance;
    }

    private forceCleanupParticles(): void {
        const now = Date.now();
        this.activeParticles.forEach(particle => {
            if (!particle.isSpawned) {
                this.activeParticles.delete(particle);
                this.particleSpawnTimes.delete(particle);
                return;
            }

            const spawnTime = this.particleSpawnTimes.get(particle) || now;
            
            // Only cleanup based on lifetime
            if (now - spawnTime > PARTICLE_LIFETIME_MS) {
                this.returnParticleToPool(particle);
            }
        });
    }

    private getParticleFromPool(): Entity | null {
        if (this.activeParticles.size >= MAX_ACTIVE_PARTICLES) {
            console.warn('Could not get particle - Max active limit reached');
            return null;
        }

        let particle = this.particlePool.pop();
        if (!particle) {
            console.warn('Could not get particle - Pool empty');
            return null;
        }

        // If the particle is spawned or we can't reset it properly, create a new one
        if (particle.isSpawned || !particle.rawRigidBody) {
            console.log('Creating new particle to replace unusable one');
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
        } else {
            // Try to reset physics state
            try {
                particle.rawRigidBody.setLinearVelocity?.({ x: 0, y: 0, z: 0 });
                particle.rawRigidBody.setAngularVelocity?.({ x: 0, y: 0, z: 0 });
            } catch (e) {
                // If we can't reset physics, create a new particle
                console.log('Creating new particle due to physics reset failure');
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
        }

        this.particleSpawnTimes.set(particle, Date.now());
        return particle;
    }

    private returnParticleToPool(particle: Entity): void {
        if (!particle) return;

        if (particle.isSpawned) {
            particle.despawn();
        }
        
        this.activeParticles.delete(particle);
        this.particleSpawnTimes.delete(particle);
        
        // Only keep particles that are properly despawned and have a rigid body
        if (!particle.isSpawned && particle.rawRigidBody && this.particlePool.length < POOL_SIZE) {
            this.particlePool.push(particle);
            console.log(`Particle returned to pool (pool size: ${this.particlePool.length}/${POOL_SIZE})`);
        } else {
            console.log('Discarding potentially problematic particle');
        }
    }

    createDeathEffect(position: Vector3Like, scale: number = 1): void {
        if (!this.world) return;

        console.log('\n=== Death Effect Debug Info ===');
        console.log(`Pool Status - Size: ${this.particlePool.length}/${POOL_SIZE}, Active: ${this.activeParticles.size}/${MAX_ACTIVE_PARTICLES}`);
        console.log('Creating death effect at position:', position);

        // Pre-calculate values
        const angleIncrement = (Math.PI * 2) / PARTICLE_COUNT;
        const speed = PARTICLE_BASE_SPEED;  // Use base speed directly

        let successfulSpawns = 0;
        const particlesToSpawn = Math.min(PARTICLE_COUNT, MAX_ACTIVE_PARTICLES - this.activeParticles.size);
        
        if (particlesToSpawn < PARTICLE_COUNT) {
            console.warn(`Can only spawn ${particlesToSpawn}/${PARTICLE_COUNT} particles due to active limit`);
        }

        // Spawn particles in a batch to ensure consistent timing
        const particles: Entity[] = [];
        for (let i = 0; i < particlesToSpawn; i++) {
            const particle = this.getParticleFromPool();
            if (!particle) {
                console.warn(`Failed to get particle ${i}`);
                continue;
            }
            particles.push(particle);
        }

        // Now spawn and apply forces to all particles at once
        particles.forEach((particle, i) => {
            const angle = angleIncrement * i;
            const offsetX = (Math.random() - 0.5) * SPAWN_OFFSET_RANGE;
            const offsetY = Math.abs(Math.random()) * SPAWN_OFFSET_RANGE + SPAWN_HEIGHT_BOOST; // Always spawn above death point
            const offsetZ = (Math.random() - 0.5) * SPAWN_OFFSET_RANGE;

            particle.spawn(this.world, {
                x: position.x + offsetX,
                y: position.y + offsetY,
                z: position.z + offsetZ
            });

            this.activeParticles.add(particle);
            successfulSpawns++;

            if (particle.rawRigidBody) {
                // Apply consistent outward force
                const speedVariation = PARTICLE_SPEED_MIN + Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
                const outwardForce = {
                    x: Math.cos(angle) * speed * speedVariation,
                    y: FORCE_UPWARD_BASE + (Math.random() * FORCE_UPWARD_VARIANCE),
                    z: Math.sin(angle) * speed * speedVariation
                };

                // Ensure minimum upward velocity
                if (outwardForce.y < FORCE_UPWARD_BASE * 0.8) {
                    outwardForce.y = FORCE_UPWARD_BASE * 0.8;
                }

                particle.rawRigidBody.applyImpulse(outwardForce);

                // Apply more controlled spin
                const spin = FORCE_SPIN_MIN + (Math.random() * (FORCE_SPIN_MAX - FORCE_SPIN_MIN));
                const spinDirection = Math.random() > 0.5 ? 1 : -1;
                particle.rawRigidBody.applyTorqueImpulse({
                    x: spin * spinDirection * 0.5, // Reduced x-axis spin
                    y: spin * spinDirection,       // Keep y-axis spin
                    z: spin * spinDirection * 0.5  // Reduced z-axis spin
                });
            }

            // Ensure consistent cleanup timing
            setTimeout(() => {
                if (this.activeParticles.has(particle)) {
                    this.returnParticleToPool(particle);
                }
            }, PARTICLE_LIFETIME_MS);
        });

        console.log('=== Death Effect Summary ===');
        console.log('Successfully spawned particles:', successfulSpawns);
        console.log('Final pool size:', this.particlePool.length);
        console.log('Final active particles:', this.activeParticles.size);
    }

    cleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        // Force cleanup all particles
        this.activeParticles.forEach(particle => {
            if (particle.isSpawned) {
                particle.despawn();
            }
        });
        this.activeParticles.clear();
        this.particlePool = [];
        this.particleSpawnTimes.clear();
    }
} 