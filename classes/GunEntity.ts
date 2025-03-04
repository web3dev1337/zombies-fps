import {
  Audio,
  CollisionGroup,
  CollisionGroupsBuilder,
  Entity,
  EntityEvent,
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

export type GunHand = 'left' | 'right' | 'both';

export interface GunEntityOptions extends EntityOptions {
  ammo: number;                    // The amount of ammo in the clip.
  damage: number;                  // The damage of the gun.
  fireRate: number;                // Bullets shot per second.
  firstPersonModelUri?: string;    // The model URI for first-person view (if different from third-person)
  hand: GunHand;                   // The hand the weapon is held in.
  iconImageUri: string;            // The image uri of the weapon icon.
  idleAnimation: string;           // The animation played when the gun is idle.
  maxAmmo: number;                 // The amount of ammo the clip can hold.
  parent?: GamePlayerEntity;       // The parent player entity.
  range: number;                   // The max range bullets travel for raycast hits
  reloadAudioUri: string;          // The audio played when reloading
  reloadTimeMs: number;            // Seconds to reload.
  shootAnimation: string;          // The animation played when the gun is shooting.
  shootAudioUri: string;           // The audio played when shooting
  viewModelOffset?: Vector3Like;   // Offset for the first-person view model
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
  private _reloading: boolean = false;
  protected _firstPersonModelUri: string | undefined;
  protected _firstPersonViewEntity: Entity | undefined;
  protected _muzzleFlashChildEntity: Entity | undefined;
  protected _reloadAudio: Audio;
  protected _shootAudio: Audio;
  protected _viewModelOffset: Vector3Like | undefined;

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
    
    // Store first-person view model properties
    this._firstPersonModelUri = options.firstPersonModelUri;
    this._viewModelOffset = options.viewModelOffset;

    // Create reusable audio instances
    this._reloadAudio = new Audio({
      attachedToEntity: this,
      uri: options.reloadAudioUri,  
    });

    this._shootAudio = new Audio({
      attachedToEntity: this,
      uri: options.shootAudioUri,
      volume: 0.3,
      referenceDistance: 8,
    });

    if (options.parent) {
      this.setParentAnimations();
    }
  }

  public get isEquipped(): boolean { return !!this.parent; }

  public override spawn(world: World, position: Vector3Like, rotation: QuaternionLike) {
    super.spawn(world, position, rotation);
    this.createMuzzleFlashChildEntity();
    this.createFirstPersonViewModel();
    this._updatePlayerUIAmmo();
    this._updatePlayerUIWeapon();
    
    // Start weapon sway animation
    if (this.parent) {
      this._startWeaponSway();
    }
  }
  
  /**
   * Creates a first-person view model if a firstPersonModelUri is provided
   */
  public createFirstPersonViewModel() {
    if (!this.isSpawned || !this.world || !this._firstPersonModelUri || !this.parent) {
      return;
    }
    
    const parentPlayerEntity = this.parent as GamePlayerEntity;
    
    // Create first-person view model entity
    this._firstPersonViewEntity = new Entity({
      parent: parentPlayerEntity,
      modelUri: this._firstPersonModelUri,
      modelScale: this.modelScale,
      // Attach to camera
      parentNodeName: 'camera',
    });
    
    // Calculate position based on view model offset or default
    const viewModelPosition = this._viewModelOffset || { x: 0.3, y: -0.3, z: -0.5 };
    
    // Spawn the first-person view model
    this._firstPersonViewEntity.spawn(this.world, viewModelPosition);
    
    // Make the original gun model invisible to the player
    // Use setOpacity for the player's view only
    this.setOpacity(0);
  }
  
  /**
   * Starts weapon sway animation for more realistic first-person view
   */
  private _startWeaponSway() {
    // Add debug flag at top of file
    const DEBUG_SWAY = true;
    
    if (!this._firstPersonViewEntity || !this.parent) {
        console.warn('[WeaponSway] Cannot start - missing required entities');
        return;
    }
    
    // Clean up any existing handlers first
    try {
        this.offAll(EntityEvent.TICK);
        if (DEBUG_SWAY) console.log('[WeaponSway] Cleaned up existing handlers');
    } catch (e) {
        console.error('[WeaponSway] Error cleaning up handlers:', e);
    }
    
    let frameCount = 0;
    let lastUpdate = performance.now();
    const updateInterval = 1000 / 60; // 60fps max
    
    const tickHandler = (payload: any) => {
        try {
            const now = performance.now();
            if (now - lastUpdate < updateInterval) {
                return;
            }
            
            // Safety checks
            if (!this.isSpawned || !this._firstPersonViewEntity?.isSpawned || !this.parent) {
                console.warn('[WeaponSway] Invalid state detected, cleaning up');
                this.off(EntityEvent.TICK, tickHandler);
                return;
            }

            frameCount++;
            if (DEBUG_SWAY && frameCount % 600 === 0) { // Log every 10 seconds at 60fps
                console.log('[WeaponSway] Still running, frames:', frameCount);
            }

            const parentPlayerEntity = this.parent as GamePlayerEntity;
            if (!parentPlayerEntity.player?.input) {
                return;
            }

            // Get player input with null checks
            const input = parentPlayerEntity.player.input;
            const isMoving = Boolean(input.w || input.a || input.s || input.d);
            const isSprinting = Boolean(input.shift);
            
            // Reduced sway values
            const swayAmount = isMoving ? (isSprinting ? 0.003 : 0.002) : 0.0005;
            const swaySpeed = isMoving ? (isSprinting ? 3 : 1.5) : 0.25;
            
            // Calculate sway with time dampening
            const time = (now % 10000) / 1000; // Reset every 10 seconds to prevent floating point issues
            const horizontalSway = Math.sin(time * swaySpeed) * swayAmount;
            const verticalSway = Math.cos(time * swaySpeed * 2) * swayAmount / 2;
            
            // Get base position with safety check
            const basePosition = this._viewModelOffset || { x: 0.3, y: -0.3, z: -0.5 };
            
            if (this._firstPersonViewEntity.isSpawned) {
                this._firstPersonViewEntity.setPosition({
                    x: basePosition.x + horizontalSway,
                    y: basePosition.y + verticalSway,
                    z: basePosition.z
                });
            }
            
            lastUpdate = now;
            
        } catch (error) {
            console.error('[WeaponSway] Critical error in tick handler:', error);
            // Attempt cleanup on error
            this.off(EntityEvent.TICK, tickHandler);
        }
    };

    // Wrap the event binding in try-catch
    try {
        this.on(EntityEvent.TICK, tickHandler);
        if (DEBUG_SWAY) console.log('[WeaponSway] Successfully started weapon sway');
    } catch (e) {
        console.error('[WeaponSway] Failed to bind tick handler:', e);
    }

    // Ensure cleanup on despawn
    this.once('despawn', () => {
        try {
            this.off(EntityEvent.TICK, tickHandler);
            if (DEBUG_SWAY) console.log('[WeaponSway] Cleaned up on despawn');
        } catch (e) {
            console.error('[WeaponSway] Error during despawn cleanup:', e);
        }
    });
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

  public reload() {
    if (!this.parent || !this.parent.world || this._reloading) {
      return;
    }

    this.ammo = 0; // set the ammo to 0 to prevent fire while reloading if clip wasn't empty.
    this._reloading = true;
    this._reloadAudio.play(this.parent.world, true);
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

    playerEntityController.idleLoopedAnimations = [ this.idleAnimation, 'idle_lower' ];
    playerEntityController.walkLoopedAnimations = [ this.idleAnimation, 'walk_lower' ];
    playerEntityController.runLoopedAnimations = [ this.idleAnimation, 'run_lower' ];
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
    
    // Play shoot audio
    this._shootAudio.play(this.parent.world, true);
  }

  public shootRaycast(origin: Vector3Like, direction: Vector3Like, length: number) {
    if (!this.parent || !this.parent.world) {
      return;
    }

    const parentPlayerEntity = this.parent as GamePlayerEntity;
   
    const raycastHit = this.parent.world.simulation.raycast(origin, direction, length, {
      filterGroups: CollisionGroupsBuilder.buildRawCollisionGroups({ // filter group is the group the raycast belongs to.
        belongsTo: [ CollisionGroup.ALL ],
        collidesWith: [ CollisionGroup.BLOCK, CollisionGroup.ENTITY ],
      }),
    });

    const hitEntity = raycastHit?.hitEntity;

    if (hitEntity && hitEntity instanceof EnemyEntity) {
      hitEntity.takeDamage(this.damage, parentPlayerEntity);
    }
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

  // Override despawn to ensure cleanup
  public override despawn() {
    // Clean up first person view entity
    if (this._firstPersonViewEntity?.isSpawned) {
        this._firstPersonViewEntity.despawn();
        this._firstPersonViewEntity = undefined;
    }
    
    super.despawn();
  }
}
