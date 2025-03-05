import {
  Audio,
  Entity,
  EntityEvent,
  ModelRegistry,
  PathfindingEntityController,
  SceneUI,
} from 'hytopia';

import type { 
  EntityOptions,
  EventPayloads,
  QuaternionLike, 
  Vector3Like, 
  World 
} from 'hytopia';

import GamePlayerEntity from './GamePlayerEntity';
import { SceneUIManager } from '../src/managers/scene-ui-manager';
import type { HitInfo } from '../src/managers/score-manager';

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
    const modelInstance = (this as any).renderObject;
    if (!modelInstance) {
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

    if (this._damageAudio) {
      this._damageAudio.play(this.world, true);
    }

    // Give reward based on damage as % of health
    if (fromPlayer) {
      // Calculate reward multiplier based on hit type
      let rewardMultiplier = 1;
      if (isHeadshot) rewardMultiplier *= 2;
      
      const moneyReward = (actualDamage / this.maxHealth) * this.reward * rewardMultiplier;
      fromPlayer.addMoney(moneyReward);
      
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
        
        // Display hit text in the world
        if (this.world) {
          let message = '';
          let color = '';
          
          if (damageType === 'headshot') {
            message = `HEADSHOT! +$${Math.floor(moneyReward)}`;
            color = 'FF0000';
          }
          
          if (message) {
            this.world.chatManager.sendPlayerMessage(
              fromPlayer.player, 
              message, 
              color
            );
          }
        }
      }
    }

    // Apply visual feedback based on hit type
    if (this.isSpawned) {
      // Apply red tint for all hits
      this.setTintColor({ r: 255, g: 0, b: 0 });
      
      // Reset tint after 75ms
      setTimeout(() => {
        if (this.isSpawned) {
          this.setTintColor({ r: 255, g: 255, b: 255 });
        }
      }, 75);
      
      // Apply screen shake for headshots
      if (isHeadshot && fromPlayer) {
        fromPlayer.player.ui.sendData({ 
          type: 'screen_shake',
          intensity: 0.2,
          duration: 200
        });
      }
    }

    if (this.health <= 0 && this.isSpawned) {
      // Enemy is dead, give additional reward & despawn
      if (fromPlayer) {
        // Bonus for kill
        const killBonus = this.reward * 0.5;
        fromPlayer.addMoney(killBonus);
        
        // Notify of kill
        fromPlayer.player.ui.sendData({ 
          type: 'kill',
          reward: killBonus
        });
      }
      
      this.despawn();
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
    if (!this.rawRigidBody) return 0;
    
    const velocity = this.rawRigidBody.getLinearVelocity();
    return Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
  }
}
