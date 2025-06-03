# Performance Analysis: Wave 15+ Lag Issues

## Executive Summary
After analyzing the codebase, I've identified multiple performance bottlenecks that compound after wave 15, causing significant lag. The primary issues are:

1. **Exponential zombie spawning without proper limits**
2. **Excessive audio processing from hundreds of zombies**
3. **Unoptimized pathfinding for large zombie counts**
4. **Memory leaks in particle effects and UI systems**
5. **Lack of zombie cleanup and distance-based optimizations**

## Detailed Analysis

### 1. Zombie Spawning Issues (GameManager.ts)

#### Current Problems:
- **No maximum zombie limit** until recently added `MAX_ZOMBIE_COUNT = 100`
- **Aggressive spawn intervals** after wave 15:
  ```typescript
  // Wave 15+: Very aggressive scaling
  spawnInterval = Math.max(FASTEST_SPAWN_INTERVAL_MS, 600 - ((this.waveNumber - 15) * 75));
  ```
- At wave 20, spawn interval could be as low as 225ms (4.4 zombies/second)
- **Running animation threshold**: Zombies with speed > 5 use running animation (more CPU intensive)

#### Impact:
- Wave 15: ~13 zombies/second spawn rate
- Wave 20: ~22 zombies/second spawn rate
- More zombies are running (speed > 5) at higher waves, increasing animation overhead

### 2. Audio System Overload

#### Current Problems:
- **Every zombie has idle audio** playing continuously:
  ```typescript
  idleAudioUri: 'audio/sfx/zombie-idle.mp3',
  idleAudioVolume: 0.8,
  idleAudioReferenceDistance: 20,
  ```
- **No distance culling** for audio sources
- **Audio manager limit (32 sounds)** easily exceeded with 100+ zombies
- Each zombie damage plays audio, creating audio queue backlog

#### Impact:
- 100 zombies = 100 continuous audio sources
- Audio processing overhead grows linearly with zombie count

### 3. Pathfinding Performance

#### Current Problems:
- **Dynamic pathfinding throttling** but still processing many zombies:
  ```typescript
  const MAX_PATHFINDERS_PER_TICK = 20;
  ```
- **Stuck detection** creates additional overhead:
  - Position checks every 1000ms
  - Brute force movement when stuck
- **Wall avoidance raycasts** for every zombie every tick

#### Impact:
- With 100+ zombies, pathfinding calculations dominate CPU
- Multiple raycasts per zombie for wall detection

### 4. Particle System Memory Leaks

#### Current Problems:
- **Large particle pool (500)** with aggressive spawning:
  ```typescript
  const POOL_SIZE = 500;
  const PARTICLE_COUNT = 15; // Per death
  ```
- **Pool replenishment** creates new entities during gameplay:
  ```typescript
  if (this.particlePool.length < POOL_SIZE * 0.2) { // Creates 50 new particles
  ```
- **Collision detection** between particles and all entities

#### Impact:
- Memory fragmentation from constant particle creation/destruction
- Physics calculations for hundreds of particles

### 5. UI and Rendering Overhead

#### Current Problems:
- **Scene UI creation** for every hit:
  ```typescript
  const damageNotification = new SceneUI({...});
  damageNotification.load(this.world);
  ```
- **Boss UI updates** sent to all players every hit
- **Complex CSS animations** for damage numbers
- **No UI pooling or recycling**

### 6. Entity Management Issues

#### Current Problems:
- **No distance-based LOD** (Level of Detail)
- **All zombies fully simulated** regardless of distance
- **No zombie recycling** - new entities created continuously
- **Collision detection** between all zombies and players

## Recommended Fixes

### Priority 1: Immediate Performance Gains

1. **Implement Zombie Spawning Caps**
   ```typescript
   // GameManager.ts - Already partially implemented
   const MAX_ZOMBIE_COUNT = 50; // Reduce from 100
   const MAX_ZOMBIE_COUNT_PER_PLAYER = 15; // Scale with players
   ```

2. **Audio Distance Culling**
   ```typescript
   // EnemyEntity.ts
   private shouldPlayAudio(): boolean {
     const nearestPlayer = this._getNearestTarget();
     if (!nearestPlayer) return false;
     const distance = this._getTargetDistance(nearestPlayer);
     return distance < 30; // Only play audio within 30 units
   }
   ```

3. **Reduce Particle Count**
   ```typescript
   const PARTICLE_COUNT = 8; // Reduce from 15
   const HIT_PARTICLE_COUNT = 2; // Reduce from 5
   const POOL_SIZE = 200; // Reduce from 500
   ```

### Priority 2: Pathfinding Optimization

1. **Implement Pathfinding Tiers**
   ```typescript
   // Based on distance to nearest player
   if (distance > 50) {
     // Simple direct movement, no pathfinding
   } else if (distance > 20) {
     // Pathfind every 5 seconds
   } else {
     // Current pathfinding logic
   }
   ```

2. **Batch Raycasts**
   ```typescript
   // Cache wall check results for multiple ticks
   private _wallCheckCache: Map<string, boolean> = new Map();
   private _wallCheckCacheTime: number = 0;
   private readonly WALL_CHECK_CACHE_DURATION = 500; // ms
   ```

### Priority 3: Memory Management

1. **Implement Entity Pooling for Zombies**
   ```typescript
   class ZombiePool {
     private pool: ZombieEntity[] = [];
     private readonly POOL_SIZE = 200;
     
     getZombie(options): ZombieEntity {
       return this.pool.pop() || new ZombieEntity(options);
     }
     
     returnZombie(zombie: ZombieEntity): void {
       zombie.reset();
       this.pool.push(zombie);
     }
   }
   ```

2. **UI Notification Pooling**
   ```typescript
   class UINotificationPool {
     private pool: SceneUI[] = [];
     private readonly POOL_SIZE = 50;
     // Similar implementation to zombie pool
   }
   ```

### Priority 4: Spawn Rate Adjustments

1. **Cap Spawn Rates After Wave 15**
   ```typescript
   // GameManager.ts
   else if (this.waveNumber >= 15) {
     // Cap at wave 15 difficulty
     spawnInterval = Math.max(600, FASTEST_SPAWN_INTERVAL_MS);
   }
   ```

2. **Implement Dynamic Difficulty**
   ```typescript
   // Reduce spawn rate if performance is poor
   if (this.world.simulation.getFPS() < 30) {
     spawnInterval *= 1.5; // Slow down spawning
   }
   ```

### Priority 5: Animation and Rendering

1. **Reduce Animation Complexity**
   ```typescript
   // Use simpler animations for distant zombies
   const animation = distance > 30 ? 'idle' : 
                     speed > 5 ? 'run' : 
                     speed > 3 ? 'walk' : 'crawling';
   ```

2. **Implement LOD System**
   ```typescript
   // Disable animations for very distant zombies
   if (distance > 50) {
     this.controller.pauseAnimations();
   }
   ```

## Implementation Plan

### Phase 1: Quick Wins (1-2 hours)
1. Reduce MAX_ZOMBIE_COUNT to 50
2. Implement audio distance culling
3. Reduce particle counts
4. Cap spawn rates after wave 15

### Phase 2: Core Optimizations (2-4 hours)
1. Implement pathfinding tiers
2. Add zombie entity pooling
3. Add UI notification pooling
4. Batch raycasts and cache results

### Phase 3: Advanced Optimizations (4-8 hours)
1. Implement full LOD system
2. Add dynamic difficulty adjustment
3. Optimize animation systems
4. Add performance monitoring

## Testing Recommendations

1. **Stress Test**: Spawn 200 zombies immediately and measure FPS
2. **Wave Progression**: Play through to wave 20 and monitor performance
3. **Profiling**: Use browser dev tools to identify remaining bottlenecks
4. **Memory Monitoring**: Check for memory leaks over extended play sessions

## Conclusion

The lag after wave 15 is caused by multiple compounding factors, primarily the exponential increase in zombie count combined with lack of optimization systems. By implementing the recommended fixes in priority order, the game should maintain stable performance even at high wave counts.

The most critical fixes are:
1. Capping zombie spawn count
2. Audio distance culling
3. Tiered pathfinding based on distance
4. Entity pooling for zombies and UI

These changes will preserve the existing pathfinding system while dramatically improving performance.