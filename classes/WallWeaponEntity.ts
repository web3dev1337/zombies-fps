import {
  Audio,
  Collider,
  RigidBodyType,
  World,
  SceneUI,
  Entity,
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
  private _weaponDisplay: Entity;
  private _displayOffset: Vector3Like;
  private _displayRotation?: QuaternionLike;

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
    this._displayOffset = options.displayOffset ?? { x: 0, y: 0, z: 0 };
    this._displayRotation = options.displayRotation;

    // Create purchase UI
    this._purchaseSceneUI = new SceneUI({
      attachedToEntity: this,
      offset: { x: 0, y: 1, z: 0 },
      templateId: 'purchase-label',
      viewDistance: 4,
      state: {
        name: `${this.name} - ${options.name}`,
        cost: this.purchasePrice,
      },
    });

    // Create weapon display model
    this._weaponDisplay = new Entity({
      modelUri: options.modelUri,
      modelScale: 1,
      parent: this,
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

    // Give player the weapon
    interactingPlayer.equipGun(new this._weaponClass({ parent: interactingPlayer }));
  }

  public override spawn(world: World, position: Vector3Like, rotation?: QuaternionLike): void {
    super.spawn(world, position, rotation);
    this._purchaseSceneUI.load(world);
    
    // Spawn the weapon display with offset
    const displayPosition = {
      x: position.x + this._displayOffset.x,
      y: position.y + this._displayOffset.y,
      z: position.z + this._displayOffset.z
    };
    this._weaponDisplay.spawn(world, displayPosition, this._displayRotation ?? rotation);
  }
} 