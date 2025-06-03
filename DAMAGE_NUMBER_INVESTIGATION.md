# Damage Number Position Investigation

## Root Cause Analysis

The damage numbers appearing on the far left of the screen is caused by a combination of:

1. **Camera Direction Changes**: The flashlight orientation fix (commit 24dbb0f) uses `player.camera.facingDirection` to update the light position
2. **Raycast Hit Points**: The gun's raycast uses the same `camera.facingDirection` to shoot
3. **World Position Usage**: Damage numbers appear at the exact `raycastHit.hitPoint` world position

## The Problem Chain

1. When the player moves backwards or at angles, `camera.facingDirection` can point in unexpected directions
2. The gun's raycast origin is calculated as:
   ```typescript
   origin = {
     x: playerPos.x + (cameraDirection.x * 0.5),
     y: playerPos.y + (cameraDirection.y * 0.5) + cameraYOffset,
     z: playerPos.z + (cameraDirection.z * 0.5),
   };
   ```
3. When the ray hits an enemy at an angle, the `hitPoint` can be:
   - On the edge of the enemy's collision box
   - At extreme world coordinates
   - Far from the enemy's center

4. The SceneUI system then places damage numbers at these extreme hit points, causing them to appear off-screen or on the far left

## Why the Flashlight Fix Triggered This

The flashlight fix didn't directly cause the issue, but it:
- Made camera direction updates more frequent/noticeable
- Potentially changed how `camera.facingDirection` behaves during movement
- Revealed an existing issue with using raw hit points for UI positioning

## The Solution

Instead of using the exact `raycastHit.hitPoint` for damage number positioning, we should use the enemy's center position with an offset. This ensures damage numbers always appear above the enemy, regardless of:
- Where the bullet hit
- Camera angle
- Player movement direction

## Code Fix

In `EnemyEntity.ts`, change from:
```typescript
hitPosition: hitPoint,  // Raw raycast hit point
```

To:
```typescript
hitPosition: {
  x: this.position.x,
  y: this.position.y + 1.5,  // Above enemy center
  z: this.position.z
},
```

This makes damage numbers consistently appear above enemies instead of at arbitrary hit locations.