# Pathfinding Analysis: Zombie Navigation Issues

## Executive Summary

After analyzing the zombie pathfinding system, I've identified three major issues affecting gameplay:

1. **Corner Navigation Failure** - Zombies get stuck on both open and enclosed corners
2. **Long-Path Blindness** - Zombies can't navigate around large obstacles when close to players
3. **Circular Gliding Behavior** - Zombies circle players at ~5m distance before approaching

These issues stem from the hybrid pathfinding system that switches between different movement modes based on distance, combined with inadequate wall avoidance and corner handling logic.

## Current Implementation Analysis

### Distance-Based Movement Modes

The system uses three distance ranges with different behaviors:

```typescript
const CLOSE_RANGE = 4;   // Direct movement with wall avoidance
const MID_RANGE = 20;    // Full pathfinding (when allowed)
const FAR_RANGE = 40;    // Simple movement with wall avoidance
```

### Movement Strategies by Range

1. **Close Range (0-4 units)**
   - Uses `_getWallAvoidanceDirection()` with direct movement
   - No pathfinding - relies on simple raycasts
   - Speed multiplier: 1.2x

2. **Mid Range (4-20 units)**
   - Full A* pathfinding when zombie's turn comes up
   - Falls back to wall avoidance when not pathfinding
   - Speed multiplier: 0.9x

3. **Far Range (20+ units)**
   - Simple movement with basic wall avoidance
   - Speed multiplier: 0.7x

### Current Wall Avoidance System

The wall avoidance uses three raycasts:
- Forward (in movement direction)
- Left (90° left from movement)
- Right (90° right from movement)

When walls are detected, it applies avoidance forces in the opposite direction.

## Problem Analysis

### 1. Corner Navigation Failure

#### Open Corner Issues
**Cause**: The wall avoidance system only checks 3 directions (forward, left, right) with a fixed check distance of 1.5 units. When approaching an open corner at certain angles, the zombie:
- Detects walls on multiple sides
- Applies competing avoidance forces
- Results in oscillation or getting stuck

**Example Scenario**:
```
Wall  |    Z = Zombie
      |    P = Player
      |
------+ Z -> P
         
```
The zombie detects walls ahead and to the side, creating conflicting forces.

#### Enclosed Corner Issues  
**Cause**: In enclosed corners, zombies can't escape because:
- All three raycasts hit walls
- Avoidance forces cancel each other out
- No "escape route" calculation
- Brute force only activates after 3 seconds of being stuck

### 2. Long-Path Blindness

**Cause**: When zombies are in CLOSE_RANGE (4 units) of a player but separated by walls:
- Pathfinding is disabled in close range
- Wall avoidance can't handle complex navigation
- Zombie tries to move directly through walls
- Player hears zombie but it can't reach them

**Example Scenario**:
```
+----------+
|  Room 1  | Door
| Zombie   +-----+
+----------+     | Hallway
                 |
+----------+     |
|  Room 2  +-----+
| Player   | Door
+----------+
```

The zombie is 3 units from the player (through wall) but needs to travel 20+ units around.

### 3. Circular Gliding Behavior

**Cause**: This occurs at the boundary between CLOSE_RANGE and MID_RANGE (around 4-5 meters):

1. **Transition Zone Issues**:
   - At 4.1m: Uses mid-range pathfinding (0.9x speed)
   - At 3.9m: Switches to close-range direct movement (1.2x speed)
   - Different movement strategies cause discontinuous behavior

2. **Wall Avoidance Interference**:
   - Even without walls, the raycast system can hit other zombies
   - Avoidance forces push zombie perpendicular to target
   - Creates circular motion around player

3. **Pathfinding Abort**:
   - When pathfinding starts but quickly enters CLOSE_RANGE
   - Pathfinding aborts, switching to direct movement
   - Sudden strategy change causes gliding

## Root Causes Summary

1. **Hard Distance Boundaries** - Abrupt transitions between movement modes
2. **Limited Raycast Coverage** - Only 3 directions checked for obstacles
3. **No Corner Detection** - System can't identify when in a corner
4. **Missing Path Memory** - Doesn't remember successful paths
5. **Poor Obstacle Classification** - Treats all obstacles (walls, zombies) the same

## Recommended Solutions

### Solution 1: Enhanced Corner Detection and Navigation

**Implementation**:
```typescript
private _detectCornerType(): 'open' | 'enclosed' | 'none' {
  // Use 8-directional raycasts
  const directions = [
    { x: 1, z: 0 },   // Forward
    { x: 1, z: 1 },   // Forward-Right
    { x: 0, z: 1 },   // Right
    { x: -1, z: 1 },  // Back-Right
    { x: -1, z: 0 },  // Back
    { x: -1, z: -1 }, // Back-Left
    { x: 0, z: -1 },  // Left
    { x: 1, z: -1 }   // Forward-Left
  ];
  
  const hits = directions.map(dir => 
    this.world.simulation.raycast(this.position, dir, 2.0)
  );
  
  // Analyze hit pattern to determine corner type
  const hitCount = hits.filter(h => h).length;
  
  if (hitCount >= 6) return 'enclosed';
  if (hitCount >= 3 && hitCount <= 5) return 'open';
  return 'none';
}
```

**Benefits**:
- Accurately identifies corner situations
- Enables corner-specific navigation strategies
- Prevents oscillation in corners

### Solution 2: Smooth Distance Transitions

**Implementation**:
```typescript
private _getMovementStrategy(distance: number): MovementStrategy {
  // Use smooth transitions instead of hard boundaries
  if (distance <= 3) {
    return { type: 'direct', weight: 1.0 };
  } else if (distance <= 5) {
    // Blend between direct and pathfinding
    const blend = (distance - 3) / 2; // 0 to 1
    return { 
      type: 'hybrid',
      directWeight: 1 - blend,
      pathfindWeight: blend
    };
  } else if (distance <= 20) {
    return { type: 'pathfind', weight: 1.0 };
  } else {
    return { type: 'simple', weight: 1.0 };
  }
}
```

**Benefits**:
- Eliminates abrupt behavior changes
- Smooth transitions between movement modes
- Fixes circular gliding issue

### Solution 3: Smart Close-Range Pathfinding

**Implementation**:
```typescript
private _shouldUseCloseRangePathfinding(): boolean {
  // Check if direct path is blocked
  const directPathClear = !this.world.simulation.raycast(
    this.position,
    this._targetEntity.position,
    this._getTargetDistance(this._targetEntity)
  );
  
  if (directPathClear) return false;
  
  // Use pathfinding even in close range if blocked
  return true;
}
```

**Benefits**:
- Solves long-path blindness
- Zombies navigate around walls even when close
- More intelligent behavior

### Solution 4: Tangent-Based Wall Following

**Implementation**:
```typescript
private _calculateWallTangent(wallHit: RaycastHit): Vector3Like {
  // Calculate wall normal from hit
  const wallNormal = wallHit.normal;
  
  // Calculate tangent (perpendicular to normal)
  // Choose direction that moves toward target
  const tangent1 = { x: -wallNormal.z, y: 0, z: wallNormal.x };
  const tangent2 = { x: wallNormal.z, y: 0, z: -wallNormal.x };
  
  // Pick tangent that reduces distance to target
  const targetDir = {
    x: this._targetEntity.position.x - this.position.x,
    z: this._targetEntity.position.z - this.position.z
  };
  
  const dot1 = tangent1.x * targetDir.x + tangent1.z * targetDir.z;
  const dot2 = tangent2.x * targetDir.x + tangent2.z * targetDir.z;
  
  return dot1 > dot2 ? tangent1 : tangent2;
}
```

**Benefits**:
- Natural wall-following behavior
- Escapes corners by following wall edges
- No oscillation or stuck states

### Solution 5: Performance-Optimized Implementation

**Key Optimizations**:

1. **Cached Raycast Results**:
```typescript
private _raycastCache = new Map<string, RaycastResult>();
private _cacheExpiry = 100; // ms

private _getCachedRaycast(origin, direction, distance): RaycastResult {
  const key = `${origin.x},${origin.z}_${direction.x},${direction.z}`;
  const cached = this._raycastCache.get(key);
  
  if (cached && Date.now() - cached.time < this._cacheExpiry) {
    return cached.result;
  }
  
  const result = this.world.simulation.raycast(origin, direction, distance);
  this._raycastCache.set(key, { result, time: Date.now() });
  return result;
}
```

2. **LOD for Distant Zombies**:
```typescript
// Reduce pathfinding frequency based on distance to nearest player
const lodMultiplier = Math.min(nearestPlayerDistance / 10, 3);
const pathfindInterval = PATHFIND_ACCUMULATOR_THRESHOLD_MS * lodMultiplier;
```

3. **Shared Path Cache**:
```typescript
// Cache successful paths between common points
class PathCache {
  private static cache = new Map<string, Path>();
  
  static getPath(from: Vector3Like, to: Vector3Like): Path | null {
    const key = `${Math.round(from.x)},${Math.round(from.z)}_${Math.round(to.x)},${Math.round(to.z)}`;
    return this.cache.get(key) || null;
  }
}
```

## Implementation Priority

### Phase 1: Critical Fixes (Highest Impact)
1. **Smooth Distance Transitions** - Fixes gliding behavior
2. **Smart Close-Range Pathfinding** - Fixes long-path blindness
3. **Enhanced Corner Detection** - Basic corner handling

**Estimated Performance Impact**: Minimal (< 5% CPU increase)

### Phase 2: Navigation Enhancement
1. **Tangent-Based Wall Following** - Natural movement
2. **8-Directional Raycasting** - Better obstacle detection
3. **Corner Escape Logic** - Handles complex geometry

**Estimated Performance Impact**: Moderate (5-10% CPU increase)

### Phase 3: Optimization
1. **Raycast Caching** - Reduces repeated calculations
2. **LOD System** - Scales with zombie count
3. **Path Memory** - Reuses successful paths

**Estimated Performance Impact**: Positive (10-15% CPU decrease)

## Testing Recommendations

1. **Corner Test Scenarios**:
   - Place zombie in each room corner type
   - Verify escape within 2 seconds
   - No oscillation or stuck states

2. **Long Path Test**:
   - Separate player and zombie by walls
   - Zombie should find door/path within 5 seconds
   - Test with multiple room layouts

3. **Gliding Test**:
   - Spawn zombie at exactly 5m distance
   - Should approach smoothly without circling
   - Test with 10+ zombies simultaneously

4. **Performance Benchmarks**:
   - 100 zombies navigating complex map
   - Monitor FPS and pathfinding time
   - Compare before/after implementation

## Conclusion

The current pathfinding issues significantly impact gameplay, making zombies appear unintelligent and reducing game challenge. The recommended solutions address each specific issue while maintaining performance for large zombie counts.

Implementing Phase 1 solutions alone would resolve the most visible issues (gliding and long-path blindness) with minimal performance impact. The complete implementation would create zombies that navigate naturally around obstacles while maintaining the game's performance requirements.