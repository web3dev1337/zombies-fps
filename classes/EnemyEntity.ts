import {
  Audio,
  Entity,
  EntityEvent,
  ModelRegistry,
  PathfindingEntityController,
  SceneUI,
  CollisionGroup,
} from 'hytopia';

import type { 
  EntityOptions,
  EventPayloads,
  QuaternionLike, 
  Vector3Like, 
  World 
} from 'hytopia';

import GamePlayerEntity from './GamePlayerEntity';
import { SceneUIManager } from './scene-ui-manager';
import { ZombieDeathEffects } from './effects/ZombieDeathEffects';
import type { HitInfo } from './score-manager';
import GameAudioManager from './GameAudioManager';

const RETARGET_ACCUMULATOR_THRESHOLD_MS = 5000;
const PATHFIND_ACCUMULATOR_THRESHOLD_MS = 3000;

// Distance-based pathfinding optimization
const CLOSE_RANGE = 4;      // Increased slightly to give more room for wall avoidance
const MID_RANGE = 20;       // Increased to reduce pathfinding frequency
const FAR_RANGE = 40;      // Keep far range the same

// Speed multipliers for different ranges
const CLOSE_RANGE_SPEED_MULTIPLIER = 1.2;
const MID_RANGE_SPEED_MULTIPLIER = 0.9;    // Increased for better corner navigation
const FAR_RANGE_SPEED_MULTIPLIER = 0.7;    // Increased slightly

// Wall avoidance parameters
const WALL_CHECK_DISTANCE = 1.5;  // How far to check for walls
const WALL_AVOID_FORCE = 0.8;     // How strongly to avoid walls

// Dynamic pathfinding scaling
const MAX_PATHFINDERS_PER_TICK = 20;  // Reduced to allow more CPU for movement
let currentTick = 0;

// Add these constants near the top with other constants
const STUCK_CHECK_INTERVAL_MS = 1000;  // How often to check if stuck
const STUCK_DISTANCE_THRESHOLD = 0.5;  // If moved less than this in check interval, consider stuck
const STUCK_DURATION_THRESHOLD = 3000;  // How long to be "stuck" before triggering brute force
const BRUTE_FORCE_DURATION = 2000;     // How long to apply brute force movement
const BRUTE_FORCE_SPEED_MULTIPLIER = 1.5; // Speed boost when using brute force

// Add damage cooldown constant
const DAMAGE_COOLDOWN_MS = 1000; // 1 second between damage applications

export interface EnemyEntityOptions extends EntityOptions {
  damage: number;
  damageAudioUri?: string;
  health: number;
  headshotMultiplier?: number;     // Damage multiplier for headshots
  idleAudioUri?: string;
  idleAudioReferenceDistance?: number;
  idleAudioVolume?: number;
  jumpHeight?: number
  preferJumping?: boolean;
  reward: number;
  speed: number;
}

export default class EnemyEntity extends Entity {
  public damage: number;
  public health: number;
  public headshotMultiplier: number;
  public jumpHeight: number;
  public maxHealth: number;
  public preferJumping: boolean;
  public reward: number;
  public speed: number;

  private _damageAudio: Audio | undefined;
  private _idleAudio: Audio | undefined;
  private _idleAudioConfig: { uri: string; volume: number; referenceDistance: number } | undefined;
  private _isPathfinding = false;
  private _pathfindAccumulatorMs = 0;
  private _retargetAccumulatorMs = 0;
  private _targetEntity: Entity | undefined;
  private _lastPosition = { x: 0, y: 0, z: 0 };
  private _lastPositionCheckTime = 0;
  private _stuckStartTime = 0;
  private _isBruteForcing = false;
  private _bruteForceStartTime = 0;
  private _lastDamageTime: { [playerId: string]: number } = {};
  private _isIdleAudioPlaying = false;
  private _audioCheckAccumulatorMs = 0;
  private readonly AUDIO_CHECK_INTERVAL_MS = 500; // Check audio state every 500ms
  private readonly AUDIO_DISTANCE_THRESHOLD = 30; // Only play audio within 30 units of a player
  
  // Phase 1 pathfinding improvements
  private _environmentCheckAccumulatorMs = 0;
  private readonly ENVIRONMENT_CHECK_INTERVAL_MS = 200; // Check environment periodically
  private _currentEnvironment: { type: 'open' | 'corner' | 'enclosed' | 'edge'; escapeDirection?: Vector3Like } = { type: 'open' };

  public constructor(options: EnemyEntityOptions) {
    super({ ...options, tag: 'enemy' });
    this.damage = options.damage;
    this.health = options.health;
    this.headshotMultiplier = options.headshotMultiplier ?? 2.5; // Default 2.5x damage for headshots
    this.jumpHeight = options.jumpHeight ?? 1;
    this.maxHealth = options.health;
    this.preferJumping = options.preferJumping ?? false;
    this.reward = options.reward;
    this.speed = options.speed;

    // Set up collision groups to prevent zombies from blocking each other's raycasts
    this.setCollisionGroupsForSolidColliders({
      belongsTo: [ CollisionGroup.ENTITY ],
      collidesWith: [ CollisionGroup.BLOCK, CollisionGroup.PLAYER ],
    });

    if (options.damageAudioUri) {
      this._damageAudio = new Audio({
        attachedToEntity: this,
        uri: options.damageAudioUri,
        volume: 0.4,
        loop: false,
        referenceDistance: 5  // Increased from default to hear zombie damage sounds better
      });
    }

    // Store audio config for later use
    this._idleAudioConfig = options.idleAudioUri ? {
      uri: options.idleAudioUri,
      volume: options.idleAudioVolume ?? 0.2,
      referenceDistance: options.idleAudioReferenceDistance ?? 5
    } : undefined;

    this.on(EntityEvent.ENTITY_COLLISION, this._onEntityCollision);
    this.on(EntityEvent.TICK, this._onTick);

    this.setCcdEnabled(true);
  }

  public override spawn(world: World, position: Vector3Like, rotation?: QuaternionLike) {
    super.spawn(world, position, rotation);

    // Don't play audio immediately - let distance check handle it
    this._isIdleAudioPlaying = false;
  }

  public override despawn(): void {
    // Mark audio as not playing (audio will stop automatically when entity despawns)
    this._isIdleAudioPlaying = false;
    
    super.despawn();
  }

  /**
   * Determines whether the given hit point is a headshot by retrieving the "head"
   * node from the underlying model.
   *
   * Note: Since Entity does not expose a "model" property, we retrieve the loaded model
   * via the renderObject (which is attached internally). Ensure your glTF model names the head node "head".
   */
  public isHeadshot(hitPoint: Vector3Like): boolean {
    if (!this.isSpawned) {
      return false;
    }

    // Attempt to retrieve the loaded model from the entity.
    // Note: This accesses internal SDK properties which may change in future versions
    try {
      const modelInstance = (this as any).renderObject;
      if (!modelInstance || typeof modelInstance.getObjectByName !== 'function') {
        return false;
      }

      const headNode = modelInstance.getObjectByName('head');
      if (!headNode) {
        return false;
      }

      // Get world position of head node
      const headPosition = {
        x: 0,
        y: 0,
        z: 0
      };
      
      // Get the world matrix of the head node
      const worldMatrix = headNode.matrixWorld;
      headPosition.x = worldMatrix.elements[12];
      headPosition.y = worldMatrix.elements[13];
      headPosition.z = worldMatrix.elements[14];

      const scale = this.modelScale ?? 1;
      const headRadius = 0.3 * scale;
      const headHeight = 0.4 * scale;

      const dx = Math.abs(hitPoint.x - headPosition.x);
      const dy = Math.abs(hitPoint.y - headPosition.y);
      const dz = Math.abs(hitPoint.z - headPosition.z);
      
      return dx <= headRadius && dy <= headHeight && dz <= headRadius;
    } catch (error) {
      // If we can't access the model, assume no headshot
      return false;
    }
  }
  
  /**
   * Apply damage to the enemy
   * @param damage Base damage amount
   * @param fromPlayer Player who caused the damage
   * @param isHeadshot Whether this is a headshot
   * @param hitPoint The position where the enemy was hit
   */
  public takeDamage(damage: number, fromPlayer?: GamePlayerEntity, isHeadshot?: boolean, hitPoint?: Vector3Like) {
    if (!this.world) {
      return;
    }
    
    // Check for headshot if not explicitly provided but hit point is available
    if (isHeadshot === undefined && hitPoint) {
      isHeadshot = this.isHeadshot(hitPoint);
    }
    
    // Calculate damage with multipliers
    let actualDamage = damage;
    let damageType = '';
    
    if (isHeadshot) {
      actualDamage *= this.headshotMultiplier;
      damageType = 'headshot';
    }
    
    this.health -= actualDamage;

    // Only play damage audio if a player is nearby
    if (this._damageAudio && fromPlayer) {
      const distance = this.getDistanceFrom(fromPlayer);
      if (distance <= this.AUDIO_DISTANCE_THRESHOLD) {
        // Use priority sound for damage as it's important feedback
        GameAudioManager.playPrioritySound(this._damageAudio, this.world);
      }
    }

    // Give reward based on damage as % of health with 20% increase
    if (fromPlayer) {
      // Calculate reward multiplier based on hit type
      let rewardMultiplier = 1;
      if (isHeadshot) rewardMultiplier *= 2;
      
      const moneyReward = (actualDamage / this.maxHealth) * this.reward * rewardMultiplier;
      fromPlayer.addMoney(moneyReward);
      
      // Track kill if enemy dies
      if (this.health <= 0) {
        fromPlayer.addKill(!!isHeadshot);
      }
      
      // Send appropriate UI notification
      if (fromPlayer && hitPoint) {
        // Create hit info for score calculation and display
        const hitInfo: HitInfo = {
          playerId: fromPlayer.player.id,
          damage: actualDamage,
          distance: this.getDistanceFrom(fromPlayer),
          targetSpeed: this.getSpeed(),
          isHeadshot: !!isHeadshot,
          isKill: this.health <= 0,
          hitPosition: hitPoint,
          spawnOrigin: this.position
        };
        
        // Process hit using SceneUIManager
        const sceneUIManager = SceneUIManager.getInstance(this.world);
        sceneUIManager.processHit(hitInfo);

        // Send legacy data for UI compatibility
        fromPlayer.player.ui.sendData({ 
          type: damageType || 'hit',
          damage: actualDamage,
          reward: moneyReward
        });
      }
    }

    // Apply visual feedback and handle death
    if (this.health <= 0 && this.isSpawned) {
      // Create death effect before despawning
      if (this.world) {
        const deathEffects = ZombieDeathEffects.getInstance(this.world);
        deathEffects.createDeathEffect(this.position, this.modelScale || 1);
      }
      
      this.despawn();
    }
  }

  private _onEntityCollision = (payload: EventPayloads[EntityEvent.ENTITY_COLLISION]) => {
    const { otherEntity, started, ended } = payload;

    // Handle collision end - clean up damage tracking
    if (ended && otherEntity instanceof GamePlayerEntity) {
      // Optionally reset damage timer on collision end
      // delete this._lastDamageTime[otherEntity.player.id];
      return;
    }

    // Handle both new collisions (started=true) and ongoing collisions (started=false)
    if (!(otherEntity instanceof GamePlayerEntity)) {
      return;
    }

    const now = Date.now();
    const lastDamageTime = this._lastDamageTime[otherEntity.player.id] || 0;

    // Check if enough time has passed since last damage
    if (now - lastDamageTime >= DAMAGE_COOLDOWN_MS) {
      otherEntity.takeDamage(this.damage);
      this._lastDamageTime[otherEntity.player.id] = now;
    }
  }

  /**
   * Get blended movement parameters based on distance for smooth transitions
   */
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

  /**
   * Check if there's a clear line of sight to the target
   */
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
    
    if (distance === 0) return true;
    
    // Check if direct path is clear (only check for blocks/walls)
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
      }
    );
    
    // If we hit something, check if it's a block/wall or just another entity
    if (hit && hit.hitEntity) {
      // If we hit another entity (not a block), consider it as having line of sight
      return true;
    }
    
    return !hit; // No hit means clear line of sight
  }

  /**
   * Detect the environment type (corner, enclosed, etc.)
   */
  private _detectEnvironment(): {
    type: 'open' | 'corner' | 'enclosed' | 'edge' | 'external_corner';
    escapeDirection?: Vector3Like;
  } {
    if (!this.world || !this._targetEntity) return { type: 'open' };
    
    // 8 directional checks
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    const checkDistance = 1.5; // Reduced for tighter detection
    const hits: { angle: number; hit: boolean; distance?: number }[] = [];
    const freeDirections: Vector3Like[] = [];
    
    // Get direction to target for context
    const toTarget = {
      x: this._targetEntity.position.x - this.position.x,
      y: 0,
      z: this._targetEntity.position.z - this.position.z
    };
    const targetAngle = Math.atan2(toTarget.z, toTarget.x);
    
    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i];
      const rad = (angle * Math.PI) / 180;
      const direction = {
        x: Math.cos(rad),
        y: 0,
        z: Math.sin(rad)
      };
      
      const hit = this.world.simulation.raycast(
        this.position,
        direction,
        checkDistance,
        {
          filterExcludeRigidBody: this.rawRigidBody,
        }
      );
      
      // Only count hits on actual walls/blocks, not other entities
      const isWallHit = hit && (!hit.hitEntity || hit.hitEntity.tag !== 'enemy');
      hits.push({ angle, hit: isWallHit, distance: hit?.distance });
      
      if (!isWallHit) {
        freeDirections.push(direction);
      }
    }
    
    const hitCount = hits.filter(h => h.hit).length;
    
    // Check for external corner pattern (2-3 adjacent hits with specific pattern)
    if (hitCount >= 2 && hitCount <= 4) {
      // Look for adjacent wall hits
      for (let i = 0; i < hits.length; i++) {
        const current = hits[i];
        const next = hits[(i + 1) % hits.length];
        const prev = hits[(i - 1 + hits.length) % hits.length];
        
        // External corner pattern: wall hit with free space on both sides
        if (current.hit && !next.hit && !prev.hit) {
          // This is likely an external corner
          // Calculate escape direction perpendicular to wall
          const wallAngle = (current.angle * Math.PI) / 180;
          
          // Check which perpendicular direction moves toward target
          const perp1 = { x: -Math.sin(wallAngle), y: 0, z: Math.cos(wallAngle) };
          const perp2 = { x: Math.sin(wallAngle), y: 0, z: -Math.cos(wallAngle) };
          
          const dot1 = perp1.x * toTarget.x + perp1.z * toTarget.z;
          const dot2 = perp2.x * toTarget.x + perp2.z * toTarget.z;
          
          return {
            type: 'external_corner',
            escapeDirection: dot1 > dot2 ? perp1 : perp2
          };
        }
      }
    }
    
    // Determine environment type
    if (hitCount >= 7) {
      // Almost fully enclosed - find best escape
      return {
        type: 'enclosed',
        escapeDirection: freeDirections[0] || { x: 0, y: 0, z: -1 }
      };
    } else if (hitCount >= 5) {
      // In an internal corner - calculate escape direction
      if (freeDirections.length > 0) {
        const escapeX = freeDirections.reduce((sum, dir) => sum + dir.x, 0);
        const escapeZ = freeDirections.reduce((sum, dir) => sum + dir.z, 0);
        const magnitude = Math.sqrt(escapeX * escapeX + escapeZ * escapeZ);
        
        if (magnitude > 0) {
          return {
            type: 'corner',
            escapeDirection: {
              x: escapeX / magnitude,
              y: 0,
              z: escapeZ / magnitude
            }
          };
        }
      }
      return { type: 'corner' };
    } else if (hitCount >= 2) {
      return { type: 'edge' };
    }
    
    return { type: 'open' };
  }

  /**
   * Check if audio should be playing based on distance to nearest player
   */
  private _updateAudioState(tickDeltaMs: number): void {
    if (!this.world || !this._idleAudioConfig) return;

    this._audioCheckAccumulatorMs += tickDeltaMs;
    
    // Only check audio state periodically to save performance
    if (this._audioCheckAccumulatorMs < this.AUDIO_CHECK_INTERVAL_MS) {
      return;
    }
    
    this._audioCheckAccumulatorMs = 0;
    
    // Check distance to nearest player
    let nearestPlayerDistance = Infinity;
    const players = this.world.entityManager.getAllPlayerEntities();
    
    for (const player of players) {
      const distance = this._getTargetDistance(player);
      if (distance < nearestPlayerDistance) {
        nearestPlayerDistance = distance;
      }
    }
    
    const shouldPlayAudio = nearestPlayerDistance <= this.AUDIO_DISTANCE_THRESHOLD;
    
    // Only create and play audio when needed
    if (shouldPlayAudio && !this._isIdleAudioPlaying) {
      // Create audio on demand
      if (!this._idleAudio) {
        this._idleAudio = new Audio({
          attachedToEntity: this,
          uri: this._idleAudioConfig.uri,
          volume: this._idleAudioConfig.volume,
          loop: true,
          referenceDistance: this._idleAudioConfig.referenceDistance
        });
      }
      this._idleAudio.play(this.world, true);
      this._isIdleAudioPlaying = true;
    } else if (!shouldPlayAudio && this._isIdleAudioPlaying) {
      // Just mark as not playing - audio will stop when entity despawns
      this._isIdleAudioPlaying = false;
      // Clear the audio reference to save memory
      this._idleAudio = undefined;
    }
  }

  /*
   * Pathfinding is handled on an accumulator basis to prevent excessive pathfinding
   * or movement calculations. It defers to dumb movements 
   */
  private _onTick = (payload: EventPayloads[EntityEvent.TICK]) => {
    const { tickDeltaMs } = payload;

    if (!this.isSpawned || !this.world || !this.id) {
      return;
    }

    // Update audio state based on distance
    this._updateAudioState(tickDeltaMs);

    // Check if stuck
    this._checkIfStuck(tickDeltaMs);
    
    // Update environment detection periodically
    this._environmentCheckAccumulatorMs += tickDeltaMs;
    if (this._environmentCheckAccumulatorMs >= this.ENVIRONMENT_CHECK_INTERVAL_MS) {
      this._currentEnvironment = this._detectEnvironment();
      this._environmentCheckAccumulatorMs = 0;
      
      // Reduce stuck threshold in corners
      if (this._currentEnvironment.type === 'corner' || this._currentEnvironment.type === 'enclosed') {
        // In corners, trigger brute force faster
        if (this._stuckStartTime && Date.now() - this._stuckStartTime > 1000) {
          this._isBruteForcing = true;
          this._bruteForceStartTime = Date.now();
        }
      }
    }

    // Get total zombie count and calculate cycle length
    const totalZombies = this.world.entityManager.getEntitiesByTag('enemy').length;
    const cycleLength = Math.max(20, Math.ceil(totalZombies / MAX_PATHFINDERS_PER_TICK));
    
    // Increment and wrap tick counter
    currentTick = (currentTick + 1) % cycleLength;

    this._pathfindAccumulatorMs += tickDeltaMs;
    this._retargetAccumulatorMs += tickDeltaMs;

    // Acquire a target to hunt
    if (!this._targetEntity || !this._targetEntity.isSpawned || this._retargetAccumulatorMs > RETARGET_ACCUMULATOR_THRESHOLD_MS) {
      this._targetEntity = this._getNearestTarget();
      this._retargetAccumulatorMs = 0;
    }

    // No target, do nothing
    if (!this._targetEntity) {
      return;
    }

    const targetDistance = this._getTargetDistance(this._targetEntity);
    const pathfindingController = this.controller as PathfindingEntityController;

    // If using brute force movement, override normal behavior
    if (this._isBruteForcing && this._targetEntity?.position) {
      // During brute force, use escape direction if in corner
      let moveDirection;
      
      if (this._currentEnvironment.escapeDirection) {
        // Use environment-aware escape direction
        moveDirection = this._currentEnvironment.escapeDirection;
      } else {
        // Fallback to direct movement
        moveDirection = {
          x: this._targetEntity.position.x - this.position.x,
          y: this._targetEntity.position.y - this.position.y,
          z: this._targetEntity.position.z - this.position.z
        };
      }
      
      pathfindingController.move(moveDirection, this.speed * BRUTE_FORCE_SPEED_MULTIPLIER);
      pathfindingController.face(this._targetEntity.position, this.speed * 2);

      // Check if brute force duration has expired
      if (Date.now() - this._bruteForceStartTime > BRUTE_FORCE_DURATION) {
        this._isBruteForcing = false;
        this._stuckStartTime = 0; // Reset stuck timer
      }
      return;
    }
    
    // Handle corner/enclosed environments with priority
    if ((this._currentEnvironment.type === 'corner' || 
         this._currentEnvironment.type === 'enclosed' ||
         this._currentEnvironment.type === 'external_corner') && 
        this._currentEnvironment.escapeDirection) {
      // Move in escape direction at increased speed
      pathfindingController.move(
        this._currentEnvironment.escapeDirection, 
        this.speed * 1.5 // Higher boost for external corners
      );
      
      // For external corners, don't face target directly as it causes conflict
      if (this._currentEnvironment.type === 'external_corner') {
        // Face in movement direction instead
        const moveDir = this._currentEnvironment.escapeDirection;
        const futurePos = {
          x: this.position.x + moveDir.x,
          y: this.position.y,
          z: this.position.z + moveDir.z
        };
        pathfindingController.face(futurePos, this.speed * 2);
      } else {
        pathfindingController.face(this._targetEntity.position, this.speed);
      }
      return;
    }

    // Get blended movement parameters based on distance
    const movementParams = this._getBlendedMovementParams(targetDistance);
    
    // Handle proximity damage before movement
    if (targetDistance <= 1.5 && this._targetEntity instanceof GamePlayerEntity) {
      const now = Date.now();
      const lastDamageTime = this._lastDamageTime[this._targetEntity.player.id] || 0;
      
      if (now - lastDamageTime >= DAMAGE_COOLDOWN_MS) {
        this._targetEntity.takeDamage(this.damage);
        this._lastDamageTime[this._targetEntity.player.id] = now;
      }
    }
    
    // Check line of sight for smart pathfinding decisions
    const hasLineOfSight = this._hasLineOfSight(this._targetEntity);
    
    // If very close and have line of sight, use direct movement
    if (targetDistance <= 4 && hasLineOfSight) {
      const directDirection = {
        x: this._targetEntity.position.x - this.position.x,
        y: 0,
        z: this._targetEntity.position.z - this.position.z
      };
      
      pathfindingController.move(directDirection, this.speed * movementParams.speedMultiplier);
      pathfindingController.face(this._targetEntity.position, this.speed * 2);
      return;
    }

    // Check if it's this zombie's turn to pathfind
    const mySlot = this.id % cycleLength;
    const canPathfindThisTick = mySlot === currentTick;

    // Use blended movement based on parameters
    if (movementParams.usePathfinding) {
      // Should use pathfinding (either full or blended)
      const shouldPathfind = canPathfindThisTick && 
        (this._pathfindAccumulatorMs > PATHFIND_ACCUMULATOR_THRESHOLD_MS || !this._isPathfinding) &&
        (!hasLineOfSight || targetDistance > 6); // Don't pathfind if very close with line of sight
      
      if (shouldPathfind && this._targetEntity?.position) {
        this._isPathfinding = pathfindingController.pathfind(
          this._targetEntity.position, 
          this.speed * movementParams.speedMultiplier, 
          {
            maxFall: this.jumpHeight * 2,
            maxJump: this.jumpHeight * 2,
            maxOpenSetIterations: targetDistance <= 10 ? 200 : 400, // Less iterations for closer targets
            verticalPenalty: this.preferJumping ? 0.5 : 2,
            pathfindAbortCallback: () => {
              this._isPathfinding = false;
              if (this._targetEntity?.position) {
                // On pathfinding failure, use wall avoidance
                const moveDirection = this._getWallAvoidanceDirection(this._targetEntity.position);
                pathfindingController.move(moveDirection, this.speed * movementParams.speedMultiplier);
              }
            },
            pathfindCompleteCallback: () => this._isPathfinding = false,
          }
        );
        this._pathfindAccumulatorMs = 0;
      } else if (this._targetEntity?.position && !this._isPathfinding) {
        // Not pathfinding - use movement based on blend weights
        if (movementParams.directWeight > 0) {
          // Blend or pure direct movement
          const directDirection = {
            x: this._targetEntity.position.x - this.position.x,
            y: 0,
            z: this._targetEntity.position.z - this.position.z
          };
          
          // If in blend zone, apply wall avoidance
          const moveDirection = movementParams.pathfindingWeight > 0 ? 
            this._getWallAvoidanceDirection(this._targetEntity.position) : 
            directDirection;
            
          pathfindingController.move(moveDirection, this.speed * movementParams.speedMultiplier);
        }
      }
    } else {
      // Pure direct movement (very close or very far)
      if (this._targetEntity?.position) {
        const moveDirection = targetDistance > 30 ? 
          this._getWallAvoidanceDirection(this._targetEntity.position) : // Far: use wall avoidance
          { // Close: direct movement
            x: this._targetEntity.position.x - this.position.x,
            y: 0,
            z: this._targetEntity.position.z - this.position.z
          };
        
        pathfindingController.move(moveDirection, this.speed * movementParams.speedMultiplier);
      }
    }

    // Face target with appropriate speed
    if (this._targetEntity?.position) {
      const turnSpeed = targetDistance <= CLOSE_RANGE ? this.speed * 2 : this.speed;
      pathfindingController.face(this._targetEntity.position, turnSpeed);
    }
  }

  private _getNearestTarget(): Entity | undefined {
    if (!this.world) {
      return undefined;
    }

    let nearestTarget: Entity | undefined;
    let nearestDistance = Infinity;

    const targetableEntities = this.world.entityManager.getAllPlayerEntities();

    targetableEntities.forEach(target => {
      if (target instanceof GamePlayerEntity && target.downed) { // skip downed players
        return;
      }
      
      const distance = this._getTargetDistance(target);
      if (distance < nearestDistance) {
        nearestTarget = target;
        nearestDistance = distance;
      }
    });

    return nearestTarget;
  }

  private _getTargetDistance(target: Entity) {
    const targetDistance = {
      x: target.position.x - this.position.x,
      y: target.position.y - this.position.y,
      z: target.position.z - this.position.z,
    };

    return Math.sqrt(targetDistance.x * targetDistance.x + targetDistance.y * targetDistance.y + targetDistance.z * targetDistance.z);
  }

  /**
   * Get distance from another entity
   */
  private getDistanceFrom(entity: Entity): number {
    if (!entity.position || !this.position) return 0;
    
    const dx = this.position.x - entity.position.x;
    const dy = this.position.y - entity.position.y;
    const dz = this.position.z - entity.position.z;
    
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  
  /**
   * Get current speed of the entity
   */
  private getSpeed(): number {
    return 0; // Simplified to avoid velocity check issues
  }

  /**
   * Calculate a movement direction that avoids walls using proper wall sliding
   * @param targetPosition The position we're trying to reach
   * @returns Movement direction that avoids walls
   */
  private _getWallAvoidanceDirection(targetPosition: Vector3Like): Vector3Like {
    if (!this.world) return targetPosition;

    // Calculate direction to target
    const directionToTarget = {
      x: targetPosition.x - this.position.x,
      y: targetPosition.y - this.position.y,
      z: targetPosition.z - this.position.z
    };

    // Normalize direction
    const distance = Math.sqrt(directionToTarget.x * directionToTarget.x + directionToTarget.z * directionToTarget.z);
    if (distance === 0) return { x: 0, y: 0, z: 0 };

    const normalizedDirection = {
      x: directionToTarget.x / distance,
      y: 0,
      z: directionToTarget.z / distance
    };

    // Cast ray slightly ahead to detect walls early
    const checkDistance = WALL_CHECK_DISTANCE * 1.5; // Increased for better detection
    const frontWallHit = this.world.simulation.raycast(
      this.position,
      normalizedDirection,
      checkDistance,
      {
        filterExcludeRigidBody: this.rawRigidBody,
      }
    );

    // If no wall ahead, move directly toward target
    if (!frontWallHit || (frontWallHit.hitEntity && frontWallHit.hitEntity.tag === 'enemy')) {
      return normalizedDirection;
    }

    // Wall detected - calculate slide direction along wall
    const wallNormal = frontWallHit.normal || { x: -normalizedDirection.x, y: 0, z: -normalizedDirection.z };
    
    // Calculate tangent vectors (perpendicular to wall normal)
    const tangent1 = { x: -wallNormal.z, y: 0, z: wallNormal.x };
    const tangent2 = { x: wallNormal.z, y: 0, z: -wallNormal.x };
    
    // Calculate which tangent moves us closer to the target
    const toTarget = {
      x: targetPosition.x - this.position.x,
      y: 0,
      z: targetPosition.z - this.position.z
    };
    
    const dot1 = tangent1.x * toTarget.x + tangent1.z * toTarget.z;
    const dot2 = tangent2.x * toTarget.x + tangent2.z * toTarget.z;
    
    // Choose the tangent that moves toward target
    const slideTangent = dot1 > dot2 ? tangent1 : tangent2;
    
    // Check if the slide direction is also blocked
    const slideCheckDistance = WALL_CHECK_DISTANCE;
    const slideWallHit = this.world.simulation.raycast(
      this.position,
      slideTangent,
      slideCheckDistance,
      {
        filterExcludeRigidBody: this.rawRigidBody,
      }
    );
    
    if (slideWallHit && (!slideWallHit.hitEntity || slideWallHit.hitEntity.tag !== 'enemy')) {
      // We're in a corner - try the opposite tangent
      const oppositeTangent = dot1 > dot2 ? tangent2 : tangent1;
      const oppositeHit = this.world.simulation.raycast(
        this.position,
        oppositeTangent,
        slideCheckDistance,
        {
          filterExcludeRigidBody: this.rawRigidBody,
        }
      );
      
      if (!oppositeHit || (oppositeHit.hitEntity && oppositeHit.hitEntity.tag === 'enemy')) {
        // Can move in opposite direction
        return oppositeTangent;
      } else {
        // Truly stuck in corner - back away
        return { x: -normalizedDirection.x, y: 0, z: -normalizedDirection.z };
      }
    }
    
    // Blend slide direction with a small amount of wall normal to avoid getting too close
    const pushAwayFactor = 0.2;
    return {
      x: slideTangent.x + wallNormal.x * pushAwayFactor,
      y: 0,
      z: slideTangent.z + wallNormal.z * pushAwayFactor
    };
  }

  /**
   * Checks if the entity is stuck by monitoring its movement over time
   */
  private _checkIfStuck(tickDeltaMs: number) {
    const currentTime = Date.now();

    // Initialize last position if not set
    if (!this._lastPositionCheckTime) {
      this._lastPosition = { ...this.position };
      this._lastPositionCheckTime = currentTime;
      return;
    }

    // Check position periodically
    if (currentTime - this._lastPositionCheckTime > STUCK_CHECK_INTERVAL_MS) {
      const distanceMoved = Math.sqrt(
        Math.pow(this.position.x - this._lastPosition.x, 2) +
        Math.pow(this.position.y - this._lastPosition.y, 2) +
        Math.pow(this.position.z - this._lastPosition.z, 2)
      );

      // If barely moved, might be stuck
      if (distanceMoved < STUCK_DISTANCE_THRESHOLD) {
        if (!this._stuckStartTime) {
          this._stuckStartTime = currentTime;
        } else if (currentTime - this._stuckStartTime > STUCK_DURATION_THRESHOLD && !this._isBruteForcing) {
          // Initiate brute force movement
          this._isBruteForcing = true;
          this._bruteForceStartTime = currentTime;
        }
      } else {
        // Reset stuck detection if moving normally
        this._stuckStartTime = 0;
      }

      // Update last position
      this._lastPosition = { ...this.position };
      this._lastPositionCheckTime = currentTime;
    }
  }
}
