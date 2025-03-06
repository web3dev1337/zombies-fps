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

    this._purchaseSceneUI = new SceneUI({
      attachedToEntity: this,
      offset: { x: 0, y: 1.5, z: 0 },
      templateId: 'purchase-label',
      viewDistance: 8,
      state: {
        name: `💰 ${this.name} 💰`, // Added emojis for visibility
        cost: this.purchasePrice
      },
    });
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

  }

  public override despawn(): void {

    if (this._weaponDisplay) {
      this._weaponDisplay.despawn();
      this._weaponDisplay = undefined;
    }
    super.despawn();
  }
} 