import {
  Audio,
  CollisionGroup,
  CollisionGroupsBuilder,
  Entity,
  PlayerEntity,
  World,
  PlayerEntityController,
} from 'hytopia';

import type {
  EntityOptions,
  Vector3Like,
  QuaternionLike,
} from 'hytopia';

import EnemyEntity from './EnemyEntity';
import type GamePlayerEntity from './GamePlayerEntity';
import { ZombieDeathEffects } from '../src/effects/ZombieDeathEffects';
import GameAudioManager from './GameAudioManager';

export type GunHand = 'left' | 'right' | 'both';

export interface GunEntityOptions extends EntityOptions {
  ammo: number;              // The amount of ammo in the clip.
  damage: number;            // The damage of the gun.
  fireRate: number;          // Bullets shot per second.
  hand: GunHand;             // The hand the weapon is held in.
  iconImageUri: string;      // The image uri of the weapon icon.
  idleAnimation: string;     // The animation played when the gun is idle.
  maxAmmo: number;           // The amount of ammo the clip can hold.
  parent?: GamePlayerEntity; // The parent player entity.
  range: number;             // The max range bullets travel for raycast hits
  reloadAudioUri: string;    // The audio played when reloading
  reloadTimeMs: number;      // Seconds to reload.
  shootAnimation: string;    // The animation played when the gun is shooting.
  shootAudioUri: string;     // The audio played when shooting
}

export default abstract class GunEntity extends Entity {
  public ammo: number;
  public damage: number;
  public fireRate: number;
  public hand: GunHand;
  public iconImageUri: string;
  public idleAnimation: string;
  public maxAmmo: number;
  public range: number;
  public reloadTimeMs: number;
  public shootAnimation: string;
  private _lastFireTime: number = 0;
  private _muzzleFlashChildEntity: Entity | undefined;
  private _reloadAudio: Audio;
  private _reloading: boolean = false;
  private _shootAudio: Audio;
  private _hitMarkerAudio: Audio | undefined;

  // Add damage variation constants
  private static readonly DAMAGE_VARIATION_PERCENT = 0.1; // 10% variation

  public constructor(options: GunEntityOptions) {
    super({
      ...options,
      parent: options.parent,
      parentNodeName: options.parent ? GunEntity._getParentNodeName(options.hand) : undefined,
    });

    this.ammo = options.ammo;
    this.damage = options.damage;
    this.fireRate = options.fireRate;
    this.hand = options.hand;
    this.iconImageUri = options.iconImageUri;
    this.idleAnimation = options.idleAnimation;
    this.maxAmmo = options.maxAmmo;
    this.range = options.range;
    this.reloadTimeMs = options.reloadTimeMs;
    this.shootAnimation = options.shootAnimation;

    // Create reusable audio instances with better spatial settings
    this._reloadAudio = new Audio({
      attachedToEntity: this,
      uri: options.reloadAudioUri,
      volume: 0.8,
      referenceDistance: 15  // Increased for better audibility
    });

    this._shootAudio = new Audio({
      attachedToEntity: this,
      uri: options.shootAudioUri,
      volume: 0.4,           // Increased base volume
      referenceDistance: 25  // Increased for better long-range audibility
    });

    // Initialize hit marker audio with spatial settings
    this._hitMarkerAudio = new Audio({
      attachedToEntity: this,
      uri: 'audio/sfx/damage/hit-marker.wav',
      volume: 1.0,
      loop: false,
      referenceDistance: 30  // Increased for better feedback
    });

    if (options.parent) {
      this.setParentAnimations();
    }
  }

  public get isEquipped(): boolean { return !!this.parent; }

  public override spawn(world: World, position: Vector3Like, rotation: QuaternionLike) {
    super.spawn(world, position, rotation);
    this.createMuzzleFlashChildEntity();
    this._updatePlayerUIAmmo();
    this._updatePlayerUIWeapon();
  }

  public createMuzzleFlashChildEntity() {
    if (!this.isSpawned || !this.world) {
      return;
    }

    this._muzzleFlashChildEntity = new Entity({
      parent: this,
      modelUri: 'models/environment/muzzle-flash.gltf',
      modelScale: 0.5,
      opacity: 0,
    });

    // pistol specific atm
    const { position, rotation } = this.getMuzzleFlashPositionRotation();
    this._muzzleFlashChildEntity.spawn(this.world, position, rotation);
  }

  public abstract getMuzzleFlashPositionRotation(): { position: Vector3Like, rotation: QuaternionLike };

  public getShootOriginDirection(): { origin: Vector3Like, direction: Vector3Like } {
    const parentPlayerEntity = this.parent as GamePlayerEntity;

    const { x, y, z } = parentPlayerEntity.position;
    const cameraYOffset = parentPlayerEntity.player.camera.offset.y;    
    const direction = parentPlayerEntity.player.camera.facingDirection;
    const origin = {
      x: x + (direction.x * 0.5),
      y: y + (direction.y * 0.5) + cameraYOffset,
      z: z + (direction.z * 0.5),
    };

    return { origin, direction };
  }

  // simple convenience helper for handling ammo and fire rate in shoot() overrides.
  public processShoot(): boolean {
    const now = performance.now();

    if (this._lastFireTime && now - this._lastFireTime < 1000 / this.fireRate) {
      return false;
    }

    if (this.ammo <= 0) {
      this.reload();
      return false;
    }

    this.ammo--;
    this._lastFireTime = now;

    return true;
  }

  private _canReload(): boolean {
    const hasValidParentInWorld = this.parent?.world != null;
    const isNotCurrentlyReloading = !this._reloading;
    const clipIsNotFull = this.ammo < this.maxAmmo;

    if (!hasValidParentInWorld) {
      return false;
    }
    
    return isNotCurrentlyReloading && clipIsNotFull;
  }

  public reload() {
    if (!this._canReload()) {
      return;
    }

    const world = this.parent?.world;
    if (!world) {
      return;
    }

    this.ammo = 0; // set the ammo to 0 to prevent fire while reloading if clip wasn't empty.
    this._reloading = true;
    // Reload sound is important feedback, make it priority
    GameAudioManager.playPrioritySound(this._reloadAudio, world);
    this._updatePlayerUIReload();

    setTimeout(() => {
      if (!this.isEquipped) {
        return;
      }

      this.ammo = this.maxAmmo;
      this._reloading = false;
      this._updatePlayerUIAmmo();
    }, this.reloadTimeMs);
  }

  public setParentAnimations() {
    if (!this.parent || !this.parent.world) {
      return;
    }

    const playerEntityController = this.parent.controller as PlayerEntityController;

    // Safely update animations if properties exist
    if ('idleLoopedAnimations' in playerEntityController) {
      (playerEntityController as any).idleLoopedAnimations = [ this.idleAnimation, 'idle_lower' ];
    }
    if ('walkLoopedAnimations' in playerEntityController) {
      (playerEntityController as any).walkLoopedAnimations = [ this.idleAnimation, 'walk_lower' ];
    }
    if ('runLoopedAnimations' in playerEntityController) {
      (playerEntityController as any).runLoopedAnimations = [ this.idleAnimation, 'run_lower' ];
    }
  }

  // override to create specific gun shoot logic
  public shoot() {
    if (!this.parent || !this.parent.world) {
      return;
    }

    const parentPlayerEntity = this.parent as GamePlayerEntity;
    
    // Deal damage and raycast
    const { origin, direction } = this.getShootOriginDirection();
    this.shootRaycast(origin, direction, this.range);

    // Play shoot animation
    parentPlayerEntity.startModelOneshotAnimations([ this.shootAnimation ]);

    // Show Muzzle Flash
    if (this._muzzleFlashChildEntity) {
      this._muzzleFlashChildEntity.setOpacity(1);
      setTimeout(() => {
        if (this.isSpawned && this._muzzleFlashChildEntity?.isSpawned) {
          this._muzzleFlashChildEntity.setOpacity(0);
        }
      }, 35);
    }
    
    // Update player ammo
    this._updatePlayerUIAmmo();
    
    // Play shoot audio - make it regular priority since it can happen frequently
    GameAudioManager.playSound(this._shootAudio, this.parent.world);
  }

  /**
   * Calculate actual damage with random variation
   * @returns The damage value with ±20% random variation
   */
  protected calculateDamageWithVariation(): number {
    const variation = 1 + (Math.random() * 2 - 1) * GunEntity.DAMAGE_VARIATION_PERCENT;
    return this.damage * variation;
  }

  public shootRaycast(origin: Vector3Like, direction: Vector3Like, length: number) {
    if (!this.parent || !this.parent.world) {
      return;
    }

    const parentPlayerEntity = this.parent as GamePlayerEntity;
   
    // Perform multiple raycasts with slight offsets when zombies are close together
    const offsets = [
      { x: 0, y: 0 },      // Center
      { x: 0.1, y: 0 },    // Slight right
      { x: -0.1, y: 0 },   // Slight left
    ];

    for (const offset of offsets) {
      const offsetDirection = {
        x: direction.x + offset.x,
        y: direction.y + offset.y,
        z: direction.z
      };

      // Normalize the direction
      const magnitude = Math.sqrt(
        offsetDirection.x * offsetDirection.x +
        offsetDirection.y * offsetDirection.y +
        offsetDirection.z * offsetDirection.z
      );

      const normalizedDirection = {
        x: offsetDirection.x / magnitude,
        y: offsetDirection.y / magnitude,
        z: offsetDirection.z / magnitude
      };

      const raycastHit = this.parent.world.simulation.raycast(origin, normalizedDirection, length, {
        filterGroups: CollisionGroupsBuilder.buildRawCollisionGroups({
          belongsTo: [ CollisionGroup.ALL ],
          collidesWith: [ CollisionGroup.BLOCK, CollisionGroup.ENTITY ],
        })
      });

      if (raycastHit?.hitEntity && raycastHit.hitEntity instanceof EnemyEntity) {
        const hitEntity = raycastHit.hitEntity;
        const hitPoint = raycastHit.hitPoint;

        // Calculate damage with random variation
        const actualDamage = this.calculateDamageWithVariation();
        
        // Check if it's a headshot based on hit position
        const isHeadshot = hitEntity.isHeadshot(hitPoint);
        
        // Apply damage with headshot information
        hitEntity.takeDamage(actualDamage, parentPlayerEntity, isHeadshot, hitPoint);

        // Play hit marker sound - make it priority since it's important feedback
        if (this._hitMarkerAudio && this.parent.world) {
          GameAudioManager.playPrioritySound(this._hitMarkerAudio, this.parent.world);
        }
        
        // Create hit effect
        const hitDirection = {
          x: hitPoint.x - origin.x,
          y: hitPoint.y - origin.y,
          z: hitPoint.z - origin.z
        };
        
        // Create blood splatter effect at hit point
        if (this.parent.world) {
          const deathEffects = ZombieDeathEffects.getInstance(this.parent.world);
          deathEffects.createHitEffect(hitPoint, hitDirection);
        }
        
        // Play feedback sounds and visual effects
        if (this.parent.world && isHeadshot) {
          // Play headshot sound - make it priority since it's important feedback
          const headshotSound = new Audio({
            uri: 'audio/sfx/headshot.mp3',
            volume: 0.7,
            loop: false,
            referenceDistance: 35  // Increased for better audibility
          });
          GameAudioManager.playPrioritySound(headshotSound, this.parent.world);
          
          // Apply screen shake for headshots
          this._applyHeadshotFeedback(0.2);
        }

        // Exit after first successful hit
        break;
      }
    }
  }
  
  /**
   * Apply visual feedback for hits
   * @param intensity The intensity of the screen shake (0.0 to 1.0)
   */
  protected _applyHeadshotFeedback(intensity: number = 0.2) {
    if (!this.parent || !this.parent.world) {
      return;
    }
    
    const parentPlayerEntity = this.parent as GamePlayerEntity;
    
    // Apply screen shake
    parentPlayerEntity.player.ui.sendData({ 
      type: 'screen_shake',
      intensity: intensity,
      duration: 200
    });
  }

  private _updatePlayerUIAmmo() {
    if (!this.parent || !this.parent.world) {
      return;
    }

    const parentPlayerEntity = this.parent as PlayerEntity;

    parentPlayerEntity.player.ui.sendData({
      type: 'ammo',
      ammo: this.ammo,
      maxAmmo: this.maxAmmo,
    });
  }

  private _updatePlayerUIReload() {
    if (!this.parent || !this.parent.world) {
      return;
    }

    const parentPlayerEntity = this.parent as PlayerEntity;

    parentPlayerEntity.player.ui.sendData({ type: 'reload' });
  }

  private _updatePlayerUIWeapon() {
    if (!this.parent || !this.parent.world) {
      return;
    }

    const parentPlayerEntity = this.parent as PlayerEntity;

    parentPlayerEntity.player.ui.sendData({
      type: 'weapon',
      name: this.name,
      iconImageUri: this.iconImageUri,
    });
  }

  // convenience helper for getting the node name of the hand the gun is held in.
  private static _getParentNodeName(hand: GunHand): string {
    return hand === 'left' ? 'hand_left_anchor' : 'hand_right_anchor';
  }
}
