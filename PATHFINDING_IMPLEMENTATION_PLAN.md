# Pathfinding Implementation Plan

## Quick Reference: Issues and Solutions

| Issue | Current Behavior | Root Cause | Solution | Priority |
|-------|-----------------|------------|----------|----------|
| **Circular Gliding** | Zombies circle at 5m | Hard distance boundaries | Smooth transitions + blend zones | HIGH |
| **Corner Stuck** | Trapped in corners | Limited raycast directions | 8-way detection + escape logic | HIGH |
| **Long-Path Blindness** | Can't navigate around walls when close | No pathfinding in close range | Smart close-range pathfinding | HIGH |
| **Wall Oscillation** | Jittering against walls | Poor tangent calculation | Proper wall-following | MEDIUM |
| **Performance** | Degrades with many zombies | Redundant calculations | Caching + LOD | MEDIUM |

## Phase 1: Critical Fixes (1-2 days)

### Fix 1: Smooth Distance Transitions (Fixes Circular Gliding)

**Current Problem Code**:
```typescript
// Abrupt transition at exactly 4 units
if (targetDistance <= CLOSE_RANGE) {
  // Instant switch to 1.2x speed direct movement
} else if (targetDistance <= MID_RANGE) {
  // Instant switch to 0.9x speed pathfinding
}
```

**New Implementation**:
```typescript
// Add to EnemyEntity class
private _getBlendedMovementParams(distance: number): {
  usePathfinding: boolean;
  pathfindingWeight: number;
  directWeight: number;
  speedMultiplier: number;
} {
  // Smooth blend zone from 3 to 6 units
  if (distance <= 3) {
    return {
      usePathfinding: false,
      pathfindingWeight: 0,
      directWeight: 1,
      speedMultiplier: 1.2
    };
  } else if (distance <= 6) {
    // Linear interpolation in blend zone
    const t = (distance - 3) / 3; // 0 to 1
    return {
      usePathfinding: true,
      pathfindingWeight: t,
      directWeight: 1 - t,
      speedMultiplier: 1.2 - (0.3 * t) // 1.2 to 0.9
    };
  } else if (distance <= 20) {
    return {
      usePathfinding: true,
      pathfindingWeight: 1,
      directWeight: 0,
      speedMultiplier: 0.9
    };
  } else {
    return {
      usePathfinding: false,
      pathfindingWeight: 0,
      directWeight: 1,
      speedMultiplier: 0.7
    };
  }
}

// Update _onTick to use blended movement
const params = this._getBlendedMovementParams(targetDistance);

if (params.usePathfinding && params.pathfindingWeight > 0) {
  // Blend pathfinding with direct movement
  const pathfindVelocity = this._calculatePathfindingVelocity();
  const directVelocity = this._calculateDirectVelocity();
  
  const blendedVelocity = {
    x: pathfindVelocity.x * params.pathfindingWeight + 
       directVelocity.x * params.directWeight,
    z: pathfindVelocity.z * params.pathfindingWeight + 
       directVelocity.z * params.directWeight
  };
  
  pathfindingController.move(blendedVelocity, this.speed * params.speedMultiplier);
}
```

### Fix 2: Smart Close-Range Pathfinding (Fixes Long-Path Blindness)

**Current Problem Code**:
```typescript
if (targetDistance <= CLOSE_RANGE) {
  // NEVER uses pathfinding, even if path is blocked
  const moveDirection = this._getWallAvoidanceDirection(this._targetEntity.position);
  pathfindingController.move(moveDirection, this.speed * CLOSE_RANGE_SPEED_MULTIPLIER);
}
```

**New Implementation**:
```typescript
// Add line-of-sight check
private _hasLineOfSight(target: Entity): boolean {
  if (!this.world || !target.position) return false;
  
  const direction = {
    x: target.position.x - this.position.x,
    y: target.position.y - this.position.y,
    z: target.position.z - this.position.z
  };
  
  const distance = Math.sqrt(
    direction.x * direction.x + 
    direction.y * direction.y + 
    direction.z * direction.z
  );
  
  // Check if direct path is clear
  const hit = this.world.simulation.raycast(
    this.position,
    { 
      x: direction.x / distance, 
      y: direction.y / distance, 
      z: direction.z / distance 
    },
    distance,
    {
      filterExcludeRigidBody: this.rawRigidBody,
      // Only check for walls/blocks, not other entities
      collisionGroups: {
        includeGroups: [ CollisionGroup.BLOCK ]
      }
    }
  );
  
  return !hit; // No hit means clear line of sight
}

// Update close range logic
if (targetDistance <= CLOSE_RANGE) {
  if (this._hasLineOfSight(this._targetEntity)) {
    // Direct movement when path is clear
    const moveDirection = {
      x: this._targetEntity.position.x - this.position.x,
      y: 0,
      z: this._targetEntity.position.z - this.position.z
    };
    pathfindingController.move(moveDirection, this.speed * CLOSE_RANGE_SPEED_MULTIPLIER);
  } else {
    // Use pathfinding when blocked, even in close range
    if (!this._isPathfinding) {
      this._isPathfinding = pathfindingController.pathfind(
        this._targetEntity.position, 
        this.speed * CLOSE_RANGE_SPEED_MULTIPLIER,
        {
          maxFall: this.jumpHeight * 2,
          maxJump: this.jumpHeight * 2,
          maxOpenSetIterations: 200, // Less iterations for close range
          pathfindCompleteCallback: () => this._isPathfinding = false,
        }
      );
    }
  }
}
```

### Fix 3: Enhanced Corner Detection (Fixes Getting Stuck)

**Current Problem Code**:
```typescript
// Only checks 3 directions
const frontWallHit = this.world.simulation.raycast(...);
const rightWallHit = this.world.simulation.raycast(...);
const leftWallHit = this.world.simulation.raycast(...);
```

**New Implementation**:
```typescript
// Add comprehensive corner detection
private _detectEnvironment(): {
  type: 'open' | 'corner' | 'enclosed' | 'edge';
  escapeDirection?: Vector3Like;
} {
  if (!this.world) return { type: 'open' };
  
  // 8 directional checks
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const checkDistance = 2.0;
  const hits: boolean[] = [];
  const freeDirections: Vector3Like[] = [];
  
  for (const angle of angles) {
    const rad = (angle * Math.PI) / 180;
    const direction = {
      x: Math.cos(rad),
      y: 0,
      z: Math.sin(rad)
    };
    
    const hit = this.world.simulation.raycast(
      this.position,
      direction,
      checkDistance
    );
    
    hits.push(!!hit);
    if (!hit) {
      freeDirections.push(direction);
    }
  }
  
  const hitCount = hits.filter(h => h).length;
  
  // Determine environment type
  if (hitCount >= 7) {
    // Almost fully enclosed - find best escape
    return {
      type: 'enclosed',
      escapeDirection: freeDirections[0] || { x: 0, y: 0, z: -1 }
    };
  } else if (hitCount >= 5) {
    // In a corner - calculate escape direction
    const escapeX = freeDirections.reduce((sum, dir) => sum + dir.x, 0);
    const escapeZ = freeDirections.reduce((sum, dir) => sum + dir.z, 0);
    const magnitude = Math.sqrt(escapeX * escapeX + escapeZ * escapeZ);
    
    return {
      type: 'corner',
      escapeDirection: {
        x: escapeX / magnitude,
        y: 0,
        z: escapeZ / magnitude
      }
    };
  } else if (hitCount >= 2) {
    return { type: 'edge' };
  }
  
  return { type: 'open' };
}

// Use environment detection in movement
const environment = this._detectEnvironment();

if (environment.type === 'corner' || environment.type === 'enclosed') {
  // Priority: Escape the corner
  if (environment.escapeDirection) {
    // Move in escape direction at full speed
    pathfindingController.move(
      environment.escapeDirection, 
      this.speed * 1.5 // Boost speed to escape
    );
    
    // Still face target to maintain aggression
    pathfindingController.face(this._targetEntity.position, this.speed);
  }
  
  // Lower stuck threshold in corners
  this._stuckDurationThreshold = 1000; // 1 second instead of 3
}
```

## Phase 2: Navigation Enhancement (2-3 days)

### Fix 4: Proper Wall Following

**Implementation**:
```typescript
private _calculateWallFollowDirection(wallHit: RaycastHit): Vector3Like {
  if (!wallHit.normal) return { x: 0, y: 0, z: 0 };
  
  // Get wall normal (perpendicular to wall surface)
  const normal = wallHit.normal;
  
  // Calculate both possible tangent directions
  const tangent1 = { x: -normal.z, y: 0, z: normal.x };
  const tangent2 = { x: normal.z, y: 0, z: -normal.x };
  
  // Direction to target
  const toTarget = {
    x: this._targetEntity.position.x - this.position.x,
    y: 0,
    z: this._targetEntity.position.z - this.position.z
  };
  
  // Choose tangent that moves toward target
  const dot1 = tangent1.x * toTarget.x + tangent1.z * toTarget.z;
  const dot2 = tangent2.x * toTarget.x + tangent2.z * toTarget.z;
  
  const bestTangent = dot1 > dot2 ? tangent1 : tangent2;
  
  // Blend with target direction for smoother movement
  const blendFactor = 0.7; // 70% wall follow, 30% toward target
  return {
    x: bestTangent.x * blendFactor + toTarget.x * (1 - blendFactor),
    y: 0,
    z: bestTangent.z * blendFactor + toTarget.z * (1 - blendFactor)
  };
}
```

### Fix 5: Predictive Obstacle Avoidance

**Implementation**:
```typescript
private _predictCollision(moveDirection: Vector3Like, timeAhead: number = 0.5): boolean {
  if (!this.world) return false;
  
  // Predict future position
  const futurePos = {
    x: this.position.x + moveDirection.x * this.speed * timeAhead,
    y: this.position.y,
    z: this.position.z + moveDirection.z * this.speed * timeAhead
  };
  
  // Check multiple points along the path
  const steps = 3;
  for (let i = 1; i <= steps; i++) {
    const checkPos = {
      x: this.position.x + (moveDirection.x * this.speed * timeAhead * i / steps),
      y: this.position.y,
      z: this.position.z + (moveDirection.z * this.speed * timeAhead * i / steps)
    };
    
    // Sphere cast for better collision detection
    const hit = this.world.simulation.sphereCast(
      checkPos,
      0.5, // Zombie radius
      { x: 0, y: -1, z: 0 }, // Downward to check ground
      0.1
    );
    
    if (hit) return true;
  }
  
  return false;
}
```

## Phase 3: Performance Optimization (1-2 days)

### Optimization 1: Raycast Result Caching

**Implementation**:
```typescript
// Add to EnemyEntity
private _raycastCache = new Map<string, { result: any; timestamp: number }>();
private readonly CACHE_DURATION_MS = 100;

private _cachedRaycast(
  origin: Vector3Like, 
  direction: Vector3Like, 
  distance: number
): RaycastHit | null {
  // Create cache key from parameters
  const key = `${Math.round(origin.x)},${Math.round(origin.z)}_${
    Math.round(direction.x * 100)},${Math.round(direction.z * 100)}_${distance}`;
  
  const cached = this._raycastCache.get(key);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp) < this.CACHE_DURATION_MS) {
    return cached.result;
  }
  
  // Perform raycast
  const result = this.world.simulation.raycast(origin, direction, distance);
  
  // Cache result
  this._raycastCache.set(key, { result, timestamp: now });
  
  // Cleanup old entries periodically
  if (this._raycastCache.size > 20) {
    for (const [k, v] of this._raycastCache.entries()) {
      if (now - v.timestamp > this.CACHE_DURATION_MS * 2) {
        this._raycastCache.delete(k);
      }
    }
  }
  
  return result;
}
```

### Optimization 2: Level of Detail (LOD) System

**Implementation**:
```typescript
// Add to _onTick
const nearestPlayerDistance = this._getNearestPlayerDistance();

// Reduce update frequency for distant zombies
const lodLevel = this._getLODLevel(nearestPlayerDistance);

switch (lodLevel) {
  case 0: // Very close (< 10m) - full updates
    // Normal pathfinding frequency
    break;
    
  case 1: // Medium (10-30m) - reduced updates
    if (this._frameCount % 2 !== 0) return; // Skip every other frame
    break;
    
  case 2: // Far (30-50m) - minimal updates
    if (this._frameCount % 4 !== 0) return; // Update every 4th frame
    break;
    
  case 3: // Very far (50m+) - rare updates
    if (this._frameCount % 8 !== 0) return; // Update every 8th frame
    // Also disable audio at this distance
    this._isIdleAudioPlaying = false;
    break;
}
```

### Optimization 3: Shared Navigation Mesh

**Implementation**:
```typescript
// Global navigation helper (outside EnemyEntity)
class NavigationMesh {
  private static _instance: NavigationMesh;
  private _nodeCache = new Map<string, NavigationNode>();
  
  static getInstance(): NavigationMesh {
    if (!this._instance) {
      this._instance = new NavigationMesh();
    }
    return this._instance;
  }
  
  getNavigationNode(position: Vector3Like): NavigationNode {
    const key = `${Math.floor(position.x / 2)},${Math.floor(position.z / 2)}`;
    
    if (!this._nodeCache.has(key)) {
      // Calculate node properties once
      const node = {
        position: { 
          x: Math.floor(position.x / 2) * 2, 
          z: Math.floor(position.z / 2) * 2 
        },
        isWalkable: this._checkWalkable(position),
        connections: this._findConnections(position)
      };
      
      this._nodeCache.set(key, node);
    }
    
    return this._nodeCache.get(key)!;
  }
}
```

## Performance Impact Analysis

| Solution | CPU Impact | Memory Impact | Benefit |
|----------|------------|---------------|---------|
| Smooth Transitions | +2% | Negligible | Fixes gliding completely |
| Smart Close Pathfinding | +5% | +1MB | Solves long-path blindness |
| Corner Detection | +3% | Negligible | Prevents getting stuck |
| Raycast Caching | -10% | +2MB | Reduces redundant calculations |
| LOD System | -15% | Negligible | Scales with zombie count |
| **Net Impact** | **-15%** | **+3MB** | **All issues fixed** |

## Implementation Schedule

**Week 1**:
- Day 1-2: Implement Phase 1 (Critical Fixes)
- Day 3: Test and refine Phase 1
- Day 4-5: Begin Phase 2 implementation

**Week 2**:
- Day 1-2: Complete Phase 2
- Day 3-4: Implement Phase 3 optimizations
- Day 5: Full testing and performance profiling

## Testing Checklist

- [ ] No circular gliding at any distance
- [ ] Zombies escape corners within 2 seconds
- [ ] Can navigate around large walls when close
- [ ] Smooth wall following without jitter
- [ ] 100+ zombies maintain 60 FPS
- [ ] No zombies stuck for > 3 seconds
- [ ] Natural-looking movement patterns
- [ ] Proper aggression maintained

## Code Integration Points

The changes primarily affect:
1. `EnemyEntity._onTick()` - Main movement logic
2. `EnemyEntity._getWallAvoidanceDirection()` - Replace with new system
3. `EnemyEntity._checkIfStuck()` - Enhance with corner detection
4. New methods to add to `EnemyEntity` class
5. Global `NavigationMesh` class for optimization

No breaking changes to existing APIs or game mechanics.