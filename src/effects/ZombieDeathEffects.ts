import { Entity, RigidBodyType, ColliderShape, World } from 'hytopia';
import type { Vector3Like } from 'hytopia';

// Death effect configuration
const PARTICLE_COUNT = 15;
const PARTICLE_SCALE = 0.4;
const PARTICLE_SCALE_MIN = 0.15;    // Smallest gore particles
const PARTICLE_SCALE_MAX = 0.5;    // Largest gore particles
const PARTICLE_LIFETIME_MS = 2000;
const PARTICLE_MODEL_URI = 'models/items/rotting-flesh.gltf';

// Hit effect configuration
const HIT_PARTICLE_COUNT = 5;         // Fewer particles for hits
const HIT_PARTICLE_SCALE = 0.1;       // Half the previous size (was 0.2)
const HIT_PARTICLE_LIFETIME_MS = 1000; // Shorter lifetime
const HIT_FORCE_MULTIPLIER = 0.7;     // Less force for smaller particles
const HIT_SPAWN_OFFSET_RANGE = 0.2;   // Tighter spread
const HIT_HEIGHT_BOOST = 0.4;         // Lower height boost

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

    private getParticleFromPool(scale: number = PARTICLE_SCALE): Entity | null {
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
                modelScale: scale,
                ...(Math.abs(scale - HIT_PARTICLE_SCALE) < 0.001 ? { tintColor: { r: 255, g: 0, b: 0 } } : {}),
                rigidBodyOptions: {
                    type: RigidBodyType.DYNAMIC,
                    colliders: [{
                        shape: ColliderShape.BLOCK,
                        halfExtents: {
                            x: scale,
                            y: scale,
                            z: scale
                        },
                        mass: PARTICLE_MASS,
                        friction: PARTICLE_FRICTION,
                        bounciness: PARTICLE_BOUNCINESS
                    }]
                }
            });
        } else if (particle.modelScale !== scale) {
            // If scale doesn't match, create new particle with correct scale
            console.log('Creating new particle with different scale');
            particle = new Entity({
                name: 'ZombieGoreParticle',
                modelUri: PARTICLE_MODEL_URI,
                modelScale: scale,
                ...(Math.abs(scale - HIT_PARTICLE_SCALE) < 0.001 ? { tintColor: { r: 255, g: 0, b: 0 } } : {}),
                rigidBodyOptions: {
                    type: RigidBodyType.DYNAMIC,
                    colliders: [{
                        shape: ColliderShape.BLOCK,
                        halfExtents: {
                            x: scale,
                            y: scale,
                            z: scale
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
                    modelScale: scale,
                    ...(Math.abs(scale - HIT_PARTICLE_SCALE) < 0.001 ? { tintColor: { r: 255, g: 0, b: 0 } } : {}),
                    rigidBodyOptions: {
                        type: RigidBodyType.DYNAMIC,
                        colliders: [{
                            shape: ColliderShape.BLOCK,
                            halfExtents: {
                                x: scale,
                                y: scale,
                                z: scale
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

        // Try to despawn if spawned
        if (particle.isSpawned) {
            try {
                particle.despawn();
            } catch (e) {
                console.warn('Failed to despawn particle, will try to reuse anyway');
            }
        }
        
        this.activeParticles.delete(particle);
        this.particleSpawnTimes.delete(particle);
        
        // Less strict return conditions - only check if we have room
        if (this.particlePool.length < POOL_SIZE) {
            // Try to reset physics state if possible
            try {
                particle.rawRigidBody?.setLinearVelocity?.({ x: 0, y: 0, z: 0 });
                particle.rawRigidBody?.setAngularVelocity?.({ x: 0, y: 0, z: 0 });
            } catch (e) {
                // Ignore physics reset errors
            }
            
            this.particlePool.push(particle);
            console.log(`Particle returned to pool (pool size: ${this.particlePool.length}/${POOL_SIZE})`);
        }

        // Replenish pool if it's getting low
        if (this.particlePool.length < POOL_SIZE * 0.2) { // Less than 20% full
            console.log('Pool running low, creating new particles');
            const toCreate = Math.min(50, POOL_SIZE - this.particlePool.length);
            for (let i = 0; i < toCreate; i++) {
                const newParticle = new Entity({
                    name: 'ZombieGoreParticle',
                    modelUri: PARTICLE_MODEL_URI,
                    modelScale: PARTICLE_SCALE,
                    ...(Math.abs(PARTICLE_SCALE - HIT_PARTICLE_SCALE) < 0.001 ? { tintColor: { r: 255, g: 0, b: 0 } } : {}),
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
                this.particlePool.push(newParticle);
            }
            console.log(`Created ${toCreate} new particles, pool size now: ${this.particlePool.length}/${POOL_SIZE}`);
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
            // Random scale for death particles
            const randomScale = PARTICLE_SCALE_MIN + Math.random() * (PARTICLE_SCALE_MAX - PARTICLE_SCALE_MIN);
            const particle = this.getParticleFromPool(randomScale);
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

            // For death effects, randomly apply red tint to 60% of particles after spawning
            if (Math.random() < 0.6) {
                // Random red intensity between 60% and 100%
                const redIntensity = Math.floor(153 + Math.random() * 102); // 60% = 153, 100% = 255
                particle.setTintColor({ r: 255, g: 255 - redIntensity, b: 255 - redIntensity });
            }

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

    createHitEffect(position: Vector3Like, hitDirection: Vector3Like): void {
        if (!this.world) return;

        console.log('\n=== Hit Effect Debug Info ===');
        console.log(`Pool Status - Size: ${this.particlePool.length}/${POOL_SIZE}, Active: ${this.activeParticles.size}/${MAX_ACTIVE_PARTICLES}`);

        const particlesToSpawn = Math.min(HIT_PARTICLE_COUNT, MAX_ACTIVE_PARTICLES - this.activeParticles.size);
        let successfulSpawns = 0;

        // Normalize hit direction for consistent force
        const magnitude = Math.sqrt(
            hitDirection.x * hitDirection.x + 
            hitDirection.y * hitDirection.y + 
            hitDirection.z * hitDirection.z
        );
        const normalizedDirection = {
            x: hitDirection.x / magnitude,
            y: hitDirection.y / magnitude,
            z: hitDirection.z / magnitude
        };

        // Spawn particles in a batch
        const particles: Entity[] = [];
        for (let i = 0; i < particlesToSpawn; i++) {
            const particle = this.getParticleFromPool(HIT_PARTICLE_SCALE);
            if (!particle) {
                console.warn(`Failed to get particle ${i}`);
                continue;
            }
            particles.push(particle);
        }

        // Spawn and apply forces to all particles
        particles.forEach((particle) => {
            // Random offset from hit position
            const offsetX = (Math.random() - 0.5) * HIT_SPAWN_OFFSET_RANGE;
            const offsetY = Math.abs(Math.random()) * HIT_SPAWN_OFFSET_RANGE + HIT_HEIGHT_BOOST;
            const offsetZ = (Math.random() - 0.5) * HIT_SPAWN_OFFSET_RANGE;

            particle.spawn(this.world, {
                x: position.x + offsetX,
                y: position.y + offsetY,
                z: position.z + offsetZ
            });

            this.activeParticles.add(particle);
            successfulSpawns++;

            if (particle.rawRigidBody) {
                // Apply force in hit direction with some randomness
                const speedVariation = PARTICLE_SPEED_MIN + Math.random() * (PARTICLE_SPEED_MAX - PARTICLE_SPEED_MIN);
                const force = {
                    x: normalizedDirection.x * PARTICLE_BASE_SPEED * speedVariation * HIT_FORCE_MULTIPLIER,
                    y: FORCE_UPWARD_BASE * HIT_FORCE_MULTIPLIER + (Math.random() * FORCE_UPWARD_VARIANCE),
                    z: normalizedDirection.z * PARTICLE_BASE_SPEED * speedVariation * HIT_FORCE_MULTIPLIER
                };

                particle.rawRigidBody.applyImpulse(force);

                // Apply reduced spin for hit particles
                const spin = FORCE_SPIN_MIN + (Math.random() * (FORCE_SPIN_MAX - FORCE_SPIN_MIN)) * HIT_FORCE_MULTIPLIER;
                const spinDirection = Math.random() > 0.5 ? 1 : -1;
                particle.rawRigidBody.applyTorqueImpulse({
                    x: spin * spinDirection * 0.3,
                    y: spin * spinDirection * 0.5,
                    z: spin * spinDirection * 0.3
                });
            }

            // Cleanup after shorter lifetime
            setTimeout(() => {
                if (this.activeParticles.has(particle)) {
                    this.returnParticleToPool(particle);
                }
            }, HIT_PARTICLE_LIFETIME_MS);
        });

        console.log('=== Hit Effect Summary ===');
        console.log('Successfully spawned particles:', successfulSpawns);
        console.log('Final pool size:', this.particlePool.length);
        console.log('Final active particles:', this.activeParticles.size);
    }
} 