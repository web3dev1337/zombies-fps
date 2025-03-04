import { Quaternion } from 'hytopia';
import type { PlayerEntity, Vector3Like, QuaternionLike } from 'hytopia';

import GunEntity from '../GunEntity';
import type { GunEntityOptions } from '../GunEntity';

export default class PistolEntity extends GunEntity {
  public constructor(options: Partial<GunEntityOptions> = {}) {
    super({
      ammo: options.ammo ?? 10,
      damage: options.damage ?? 3,
      fireRate: options.fireRate ?? 9,
      // Use the same model for first-person view but with different positioning
      firstPersonModelUri: options.firstPersonModelUri ?? 'models/items/pistol.glb',
      hand: options.hand ?? 'right',
      iconImageUri: options.iconImageUri ?? 'icons/pistol.png',
      idleAnimation: options.idleAnimation ?? 'idle_gun_right',
      name: options.name ?? 'Pistol',
      maxAmmo: options.maxAmmo ?? 10,
      modelUri: options.modelUri ?? 'models/items/pistol.glb',
      modelScale: options.modelScale ?? 1.3,
      parent: options.parent,
      range: options.range ?? 50,
      reloadAudioUri: options.reloadAudioUri ?? 'audio/sfx/pistol-reload.mp3',
      reloadTimeMs: options.reloadTimeMs ?? 1250,
      shootAnimation: options.shootAnimation ?? 'shoot_gun_right',
      shootAudioUri: options.shootAudioUri ?? 'audio/sfx/pistol-shoot.mp3',
      // Position the first-person view model in front of the camera
      viewModelOffset: options.viewModelOffset ?? { x: 0.3, y: -0.3, z: -0.5 },
    });
  }

  public override shoot() {
    if (!this.parent || !this.processShoot()) {
      return;
    }

    const parentPlayerEntity = this.parent as PlayerEntity;

    if (!parentPlayerEntity.world) {
      return;
    }

    // shoot the bullet
    super.shoot();

    // cancel the input, pistols require click to shoot
    parentPlayerEntity.player.input.ml = false;

    // play shoot animation
    parentPlayerEntity.startModelOneshotAnimations([ 'shoot_gun_right' ]);
    
    // Add recoil effect for first-person view model
    this._applyRecoilEffect();
  }
  
  /**
   * Applies a recoil effect to the first-person view model
   * for more realistic shooting feedback
   */
  private _applyRecoilEffect() {
    if (!this._firstPersonViewEntity || !this.isSpawned || !this.world) {
      return;
    }
    
    // Get base position
    const basePosition = this._viewModelOffset || { x: 0.3, y: -0.3, z: -0.5 };
    
    // Apply recoil - move the gun back and up slightly
    this._firstPersonViewEntity.setPosition({
      x: basePosition.x,
      y: basePosition.y + 0.05, // Move up slightly
      z: basePosition.z + 0.1,  // Move back
    });
    
    // Use Bun's native setTimeout
    const timer = globalThis.setTimeout(() => {
      if (this._firstPersonViewEntity?.isSpawned) {
        this._firstPersonViewEntity.setPosition(basePosition);
      }
    }, 100);

    // Clean up timer if entity is despawned
    this.once('despawn', () => {
      globalThis.clearTimeout(timer);
    });
  }

  public override getMuzzleFlashPositionRotation(): { position: Vector3Like, rotation: QuaternionLike } {
    return {
      position: { x: 0.03, y: 0.1, z: -0.5 },
      rotation: Quaternion.fromEuler(0, 90, 0),
    };
  }
}
