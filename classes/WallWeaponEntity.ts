import {
  Audio,
  Collider,
  RigidBodyType,
  World,
  SceneUI,
  Entity,
  Quaternion,
} from 'hytopia';
import type {
  QuaternionLike,
  Vector3Like,
  EntityOptions
} from 'hytopia';

import GamePlayerEntity from './GamePlayerEntity';
import InteractableEntity from './InteractableEntity';
import type { GunEntityOptions } from './GunEntity';
import type GunEntity from './GunEntity';

export interface WallWeaponEntityOptions {
  name: string;
  price: number;
  weaponClass: new (options: Partial<GunEntityOptions>) => GunEntity;
  modelUri: string;
  displayOffset?: Vector3Like;
  displayRotation?: QuaternionLike;
}

export default class WallWeaponEntity extends InteractableEntity {
  public purchasePrice: number;
  private _purchaseSceneUI: SceneUI;
  private _weaponClass: new (options: Partial<GunEntityOptions>) => GunEntity;
  private _modelUri: string;
  private _displayOffset: Vector3Like;
  private _displayRotation?: QuaternionLike;
  private _weaponDisplay?: Entity;
  private _floatAnimationStartTime: number;
  private _floatHeight: number = 0.5; // Increased from 0.2 to 0.5 for more noticeable movement
  private _floatSpeed: number = 0.8; // Slowed down from 1.5 to 0.8 to make it more visible
  private _floatInterval?: NodeJS.Timer;
  private _pulseInterval?: NodeJS.Timer;

  public constructor(options: WallWeaponEntityOptions) {
    const colliderOptions = Collider.optionsFromModelUri(options.modelUri);

    if (colliderOptions.halfExtents) {
      colliderOptions.halfExtents.y = 3; // Make it taller for better interact area
    }

    super({
      name: options.name,
      modelUri: options.modelUri,
      rigidBodyOptions: {
        type: RigidBodyType.FIXED,
        colliders: [ colliderOptions ]
      },
      tintColor: { r: 255, g: 255, b: 255 },
    });

    this.purchasePrice = options.price;
    this._weaponClass = options.weaponClass;
    this._modelUri = options.modelUri;
    this._displayOffset = options.displayOffset ?? { x: 0, y: 0, z: 0 };
    this._displayRotation = options.displayRotation;
    this._floatAnimationStartTime = Date.now();

    // Create purchase UI with pulsing effect
    this._purchaseSceneUI = new SceneUI({
      attachedToEntity: this,
      offset: { x: 0, y: 2, z: 0 }, // Raised from 1.5 to 2 for better visibility
      templateId: 'purchase-label',
      viewDistance: 8,
      state: {
        name: `💰 ${this.name} 💰`, // Added emojis for visibility
        cost: this.purchasePrice,
        isPulsing: true,
      },
    });

    // Start the UI pulse animation
    this._startUIPulse();
  }

  private _startUIPulse() {
    if (!this.world) return;

    // Clear any existing interval
    if (this._pulseInterval) {
      clearInterval(this._pulseInterval);
    }

    console.log(`Starting pulse animation for ${this.name}`);

    // Update every 50ms (20 times per second)
    this._pulseInterval = setInterval(() => {
      if (!this.isSpawned) {
        if (this._pulseInterval) {
          clearInterval(this._pulseInterval);
          console.log(`Stopping pulse animation for ${this.name} - entity despawned`);
        }
        return;
      }

      const time = (Date.now() - this._floatAnimationStartTime) / 1000;
      const scale = 1 + Math.sin(time * Math.PI) * 0.25; // Increased from 0.1 to 0.25 for more noticeable pulsing

      if (this._purchaseSceneUI) {
        this._purchaseSceneUI.setState({
          name: `💰 ${this.name} 💰`,
          cost: this.purchasePrice,
          isPulsing: true,
          opacity: scale, // Using opacity instead of scale since it's more likely to be supported
        });
      }
    }, 50);
  }

  public override interact(interactingPlayer: GamePlayerEntity) {
    if (!this.isSpawned || !this.world) {
      return;
    }

    // Check if player has enough money
    if (!interactingPlayer.spendMoney(this.purchasePrice)) {
      this.world.chatManager.sendPlayerMessage(
        interactingPlayer.player,
        `You don't have enough money to purchase this weapon!`,
        'FF0000'
      );
      return;
    }

    // Create and equip the weapon with parent set
    interactingPlayer.equipGun(new this._weaponClass({ parent: interactingPlayer }));

    // Play purchase sound
    const purchaseSound = new Audio({
      uri: 'audio/sfx/purchase.mp3',
      volume: 0.5,
    });
    purchaseSound.play(this.world, true);
  }

  public override spawn(world: World, position: Vector3Like, rotation?: QuaternionLike): void {
    super.spawn(world, position, rotation);
    this._purchaseSceneUI.load(world);
    
    // Create and spawn the weapon display after parent is spawned
    this._weaponDisplay = new Entity({
      modelUri: this._modelUri,
      modelScale: 1,
      parent: this,
    });
    
    // Spawn the weapon display with offset
    const displayPosition = {
      x: position.x + this._displayOffset.x,
      y: position.y + this._displayOffset.y,
      z: position.z + this._displayOffset.z
    };
    this._weaponDisplay.spawn(world, displayPosition, this._displayRotation ?? rotation);

    // Start the floating animation update
    this._startFloatingAnimation();
  }

  private _startFloatingAnimation() {
    if (!this._weaponDisplay || !this.world) return;

    // Clear any existing interval
    if (this._floatInterval) {
      clearInterval(this._floatInterval);
    }

    console.log(`Starting float animation for ${this.name}`);

    // Update every 16ms (approximately 60 times per second)
    this._floatInterval = setInterval(() => {
      if (!this._weaponDisplay || !this.isSpawned) {
        if (this._floatInterval) {
          clearInterval(this._floatInterval);
          console.log(`Stopping float animation for ${this.name} - entity despawned`);
        }
        return;
      }

      const time = (Date.now() - this._floatAnimationStartTime) / 1000;
      const floatOffset = Math.sin(time * Math.PI * 2 * this._floatSpeed) * this._floatHeight;
      const rotationOffset = Math.sin(time * Math.PI * this._floatSpeed) * 15; // Added slight rotation

      const basePosition = {
        x: this.position.x + this._displayOffset.x,
        y: this.position.y + this._displayOffset.y,
        z: this.position.z + this._displayOffset.z
      };

      this._weaponDisplay.setPosition({
        x: basePosition.x,
        y: basePosition.y + floatOffset,
        z: basePosition.z
      });

      // Add a gentle rotation to make it more noticeable
      this._weaponDisplay.setRotation(Quaternion.fromEuler(0, rotationOffset, 0));
    }, 16);
  }

  public override despawn(): void {
    // Clear animation intervals
    if (this._floatInterval) {
      clearInterval(this._floatInterval);
      this._floatInterval = undefined;
    }
    if (this._pulseInterval) {
      clearInterval(this._pulseInterval);
      this._pulseInterval = undefined;
    }

    if (this._weaponDisplay) {
      this._weaponDisplay.despawn();
      this._weaponDisplay = undefined;
    }
    super.despawn();
  }
} 