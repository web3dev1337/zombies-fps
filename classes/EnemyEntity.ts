import {
  Audio,
  Entity,
  EntityEvent,
  PathfindingEntityController,
} from 'hytopia';

import type { 
  EntityOptions,
  EventPayloads,
  QuaternionLike, 
  Vector3Like, 
  World 
} from 'hytopia';

import GamePlayerEntity from './GamePlayerEntity';

const RETARGET_ACCUMULATOR_THRESHOLD_MS = 5000;
const PATHFIND_ACCUMULATOR_THRESHOLD_MS = 3000;

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
  private _isPathfinding = false;
  private _pathfindAccumulatorMs = 0;
  private _retargetAccumulatorMs = 0;
  private _targetEntity: Entity | undefined;

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

    if (options.damageAudioUri) {
      this._damageAudio = new Audio({
        attachedToEntity: this,
        uri: options.damageAudioUri,
        volume: 1,
        loop: false,
      });
    }

    if (options.idleAudioUri) {
      this._idleAudio = new Audio({
        attachedToEntity: this,
        uri: options.idleAudioUri,
        volume: options.idleAudioVolume ?? 0.5,
        loop: true,
        referenceDistance: options.idleAudioReferenceDistance ?? 1, // low reference distance so its only heard when the enemy is very near
      });
    }

    this.on(EntityEvent.ENTITY_COLLISION, this._onEntityCollision);
    this.on(EntityEvent.TICK, this._onTick);

    this.setCcdEnabled(true);
  }

  public override spawn(world: World, position: Vector3Like, rotation?: QuaternionLike) {
    super.spawn(world, position, rotation);

    if (this._idleAudio) {
      this._idleAudio.play(world, true);
    }
  }

  /**
   * Check if a hit is a headshot based on the hit position
   * @param hitPoint The position where the enemy was hit
   * @returns True if the hit is a headshot, false otherwise
   */
  public isHeadshot(hitPoint: Vector3Like): boolean {
    if (!this.isSpawned) {
      return false;
    }
    
    // Calculate the height of the hit relative to the enemy's position
    // The head is typically at the top of the model
    const headHeight = this.position.y + 1.7; // Assuming the model is about 2 units tall
    const headRadius = 0.3; // Approximate radius of the head
    
    // Check if the hit point is within the head area
    return hitPoint.y > headHeight - headRadius && 
           Math.abs(hitPoint.x - this.position.x) < headRadius && 
           Math.abs(hitPoint.z - this.position.z) < headRadius;
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
    
    // Apply headshot multiplier if applicable
    const actualDamage = isHeadshot ? damage * this.headshotMultiplier : damage;
    this.health -= actualDamage;

    if (this._damageAudio) {
      this._damageAudio.play(this.world, true);
    }

    // Give reward based on damage as % of health
    if (fromPlayer) {
      // Increase reward for headshots
      const rewardMultiplier = isHeadshot ? 2 : 1;
      fromPlayer.addMoney((actualDamage / this.maxHealth) * this.reward * rewardMultiplier);
      
      // Notify player of headshot
      if (isHeadshot) {
        fromPlayer.player.ui.sendData({ 
          type: 'headshot',
          reward: (actualDamage / this.maxHealth) * this.reward * rewardMultiplier
        });
        
        // Display headshot text in the world
        if (this.world) {
          this.world.chatManager.sendPlayerMessage(
            fromPlayer.player, 
            `HEADSHOT! +$${Math.floor((actualDamage / this.maxHealth) * this.reward * rewardMultiplier)}`, 
            'FF0000'
          );
        }
      }
    }

    if (this.health <= 0 && this.isSpawned) {
      // Enemy is dead, give half reward & despawn
      this.despawn();
    } else {
      // Apply red tint for 75ms to indicate damage
      this.setTintColor({ r: 255, g: 0, b: 0 });
      // Reset tint after 75ms, make sure to check if the entity is still
      // spawned to prevent setting tint on a despawned entity
      setTimeout(() => this.isSpawned ? this.setTintColor({ r: 255, g: 255, b: 255 }) : undefined, 75);
    }
  }

  private _onEntityCollision = (payload: EventPayloads[EntityEvent.ENTITY_COLLISION]) => {
    const { otherEntity, started } = payload;

    if (!started || !(otherEntity instanceof GamePlayerEntity)) {
      return;
    }

    otherEntity.takeDamage(this.damage);
  }

  /*
   * Pathfinding is handled on an accumulator basis to prevent excessive pathfinding
   * or movement calculations. It defers to dumb movements 
   */
  private _onTick = (payload: EventPayloads[EntityEvent.TICK]) => {
    const { tickDeltaMs } = payload;

    if (!this.isSpawned) {
      return;
    }

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

    if (targetDistance < 8 || (!this._isPathfinding && this._pathfindAccumulatorMs < PATHFIND_ACCUMULATOR_THRESHOLD_MS)) {
      pathfindingController.move(this._targetEntity.position, this.speed);
      pathfindingController.face(this._targetEntity.position, this.speed * 2);
    } else if (this._pathfindAccumulatorMs > PATHFIND_ACCUMULATOR_THRESHOLD_MS) {
      this._isPathfinding = pathfindingController.pathfind(this._targetEntity.position, this.speed, {
        maxFall: this.jumpHeight,
        maxJump: this.jumpHeight,
        maxOpenSetIterations: 200,
        verticalPenalty: this.preferJumping ? -1 : 1,
        pathfindAbortCallback: () => this._isPathfinding = false,
        pathfindCompleteCallback: () => this._isPathfinding = false,
        waypointMoveSkippedCallback: () => this._isPathfinding = false,
      });

      this._pathfindAccumulatorMs = 0;
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
}
