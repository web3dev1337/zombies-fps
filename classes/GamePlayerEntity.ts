import { 
  Audio,
  BaseEntityControllerEvent,
  CollisionGroup,
  DefaultPlayerEntityController,
  Light,
  LightType,
  Player,
  PlayerEntity,
  PlayerCameraMode,
  SceneUI,
  World,
  Quaternion,
  PlayerEntityController,
  Vector3,
  GameServer,
  ColliderShape,
} from 'hytopia';

import type {
  EventPayloads,
  PlayerCameraOrientation,
  PlayerInput,
  Vector3Like,
  QuaternionLike,
} from 'hytopia';

import PistolEntity from './guns/PistolEntity';
import InteractableEntity from './InteractableEntity';
import type GunEntity from './GunEntity';
import { INVISIBLE_WALL_COLLISION_GROUP } from '../gameConfig';
import GameManager from './GameManager';
import GameAudioManager from './GameAudioManager';

const BASE_HEALTH = 100;
const REVIVE_REQUIRED_HEALTH = 50;
const REVIVE_PROGRESS_INTERVAL_MS = 100;
const REVIVE_HEALTH_PER_TICK = 1;
const REVIVE_DISTANCE_THRESHOLD = 3;

export default class GamePlayerEntity extends PlayerEntity {
  public health: number;
  public maxHealth: number = BASE_HEALTH;
  public money: number = 0;
  public downed: boolean = false;

  // Add stat tracking
  public kills: number = 0;
  public headshots: number = 0;
  public revives: number = 0;
  public downs: number = 0;
  public score: number = 0; // Track total earnings as score

  private _damageAudio: Audio;
  private _downedSceneUI: SceneUI;
  private _purchaseAudio: Audio;
  private _gun: GunEntity | undefined;
  private _light: Light;
  private _reviveInterval: NodeJS.Timer | undefined;
  private _reviveDistanceVectorA: Vector3;
  private _reviveDistanceVectorB: Vector3;
  private _lastDamageTime: number = 0;
  private readonly REGEN_DELAY_MS: number = 5000; // 5 seconds in milliseconds
  private _lastDamageAudioTime: number = 0;
  private readonly DAMAGE_AUDIO_THROTTLE_MS: number = 100; // Minimum time between damage sounds
  private readonly DAMAGE_AUDIO_MAX_DISTANCE: number = 30; // Maximum distance to play damage audio

  // Player entities always assign a PlayerController to the entity, so we can safely create a convenience getter
  public get playerController(): PlayerEntityController {
    return this.controller as PlayerEntityController;
  }

  public constructor(player: Player) {
    super({
      player,
      name: 'Player',
      modelUri: 'models/players/soldier-player.gltf',
      modelScale: 0.5,
    });
    
    // Create and set controller with custom options
    const controller = new DefaultPlayerEntityController({
      autoCancelMouseLeftClick: false, // Prevent mouse left click from being cancelled
      idleLoopedAnimations: [ 'idle_lower' ],
      interactOneshotAnimations: [],
      walkLoopedAnimations: ['walk_lower' ],
      runLoopedAnimations: [ 'run_lower' ],
    });
    this.setController(controller);

    this.playerController.on(BaseEntityControllerEvent.TICK_WITH_PLAYER_INPUT, this._onTickWithPlayerInput);
    
    // Setup UI
    this.player.ui.load('ui/index.html');

    // Setup first person camera
    this.player.camera.setMode(PlayerCameraMode.FIRST_PERSON);
    this.player.camera.setModelHiddenNodes([ 'head', 'neck', 'torso', 'leg_right', 'leg_left' ]);
    this.player.camera.setOffset({ x: 0, y: 0.5, z: 0 });
  
    // Set base stats
    this.health = BASE_HEALTH;

    // Setup damage audio with reference distance for better spatial audio
    this._damageAudio = new Audio({
      attachedToEntity: this,
      uri: 'audio/sfx/player-hurt.mp3',
      loop: false,
      volume: 0.7,
      referenceDistance: 20, // Audio will start fading at this distance
    });

    // Setup purchase audio
    this._purchaseAudio = new Audio({
      attachedToEntity: this,
      uri: 'audio/sfx/purchase.mp3',
      loop: false,
      volume: 1,
    });

    // Setup downed scene UI
    this._downedSceneUI = new SceneUI({
      attachedToEntity: this,
      templateId: 'downed-player',
      offset: { x: 0, y: 0.5, z: 0 },
    });

    // Setup light
    this._light = new Light({
      angle: Math.PI / 3.5 + 0.1,
      penumbra: 0.1,
      attachedToEntity: this,
      type: LightType.SPOTLIGHT,
      intensity: 4,
      offset: { x: 0, y: 0.5, z: 0.1 }, 
      color: { r: 255, g: 255, b: 255 },
    });

    // Create reusable vector3 for revive distance calculations
    this._reviveDistanceVectorA = new Vector3(0, 0, 0);
    this._reviveDistanceVectorB = new Vector3(0, 0, 0);
  }

  public override spawn(world: World, position: Vector3Like, rotation?: QuaternionLike): void {
    super.spawn(world, position, rotation);

    // Initialize audio manager if not already done
    GameAudioManager.init();

    // Prevent players from colliding, setup appropriate collision groups for invisible walls, etc.
    this.setCollisionGroupsForSolidColliders({
      belongsTo: [ CollisionGroup.PLAYER ],
      collidesWith: [ CollisionGroup.BLOCK, CollisionGroup.ENTITY, CollisionGroup.ENTITY_SENSOR, INVISIBLE_WALL_COLLISION_GROUP ],
    });

    // Give player a pistol.
    this.equipGun(new PistolEntity({ parent: this }));

    // Spawn light
    this._light.spawn(world);

    // Start auto heal ticker
    this._autoHealTicker();

    // Reset any prior UI from respawn
    this._updatePlayerUIHealth();
    this._updatePlayerUIMoney();
  }

  public addMoney(amount: number) {
    const roundedAmount = Math.round(amount);
    this.money += roundedAmount;
    this.score += roundedAmount; // Add to total score when earning money
    this._updatePlayerUIMoney();
  }

  public equipGun(gun: GunEntity) {
    if (!this.world) {
      return;
    }

    if (gun.isSpawned) {
      // no support for equipping already spawned guns atm, like pickup up guns etc, 
      // but would be easy to add. Not needed for this game though.
      return console.warn('Cannot equip already spawned gun!');
    }

    if (this._gun) { // despawn old gun
      this._gun.despawn();
    }

    this._gun = gun;
    this._gun.spawn(this.world, { x: 0, y: 0, z: -0.2 }, Quaternion.fromEuler(-90, 0, 0));
  }

  public spendMoney(amount: number): boolean {
    const roundedAmount = Math.round(amount);
    if (!this.world || this.money < roundedAmount) {
      return false;
    }

    this.money -= roundedAmount;
    this._updatePlayerUIMoney();
    // Always play purchase sound as it's important feedback
    GameAudioManager.playPrioritySound(this._purchaseAudio, this.world);
    return true;
  }

  public takeDamage(damage: number) {
    if (!this.isSpawned || !this.world || this.downed) {
      return;
    }

    // Update the last damage time
    this._lastDamageTime = Date.now();

    const healthAfterDamage = this.health - damage;
    if (this.health > 0 && healthAfterDamage <= 0) {
      this._setDowned(true);
    }

    this.health = Math.max(healthAfterDamage, 0);
    
    this._updatePlayerUIHealth();

    // Audio throttling and distance culling
    const now = Date.now();
    if (now - this._lastDamageAudioTime >= this.DAMAGE_AUDIO_THROTTLE_MS) {
      // Only play audio for nearby players to reduce audio load
      const nearbyPlayers = this.world.entityManager.getAllPlayerEntities()
        .filter(player => {
          if (!(player instanceof GamePlayerEntity)) return false;
          const dx = player.position.x - this.position.x;
          const dy = player.position.y - this.position.y;
          const dz = player.position.z - this.position.z;
          const distanceSquared = dx * dx + dy * dy + dz * dz;
          return distanceSquared <= (this.DAMAGE_AUDIO_MAX_DISTANCE * this.DAMAGE_AUDIO_MAX_DISTANCE);
        });

      if (nearbyPlayers.length > 0) {
        // randomize the detune for variation each hit
        this._damageAudio.setDetune(-200 + Math.random() * 800);
        // Use regular playSound as damage sounds can be queued if too many
        GameAudioManager.playSound(this._damageAudio, this.world);
        this._lastDamageAudioTime = now;
      }
    }
  }

  public progressRevive(byPlayer: GamePlayerEntity) {
    if (!this.world) {
      return;
    }

    clearTimeout(this._reviveInterval);

    this._reviveInterval = setTimeout(() => {
      this._reviveDistanceVectorA.set([ this.position.x, this.position.y, this.position.z ]);
      this._reviveDistanceVectorB.set([ byPlayer.position.x, byPlayer.position.y, byPlayer.position.z ]);
      const distance = this._reviveDistanceVectorA.distance(this._reviveDistanceVectorB);

      if (distance > REVIVE_DISTANCE_THRESHOLD) {
        return;
      }

      this.health += REVIVE_HEALTH_PER_TICK;
      this._updatePlayerUIHealth();

      this._downedSceneUI.setState({
        progress: (this.health / REVIVE_REQUIRED_HEALTH) * 100,
      });

      if (this.health >= REVIVE_REQUIRED_HEALTH) {
        this._setDowned(false);
      } else {
        this.progressRevive(byPlayer);
      }
    }, REVIVE_PROGRESS_INTERVAL_MS);
  }

  private _onTickWithPlayerInput = (payload: EventPayloads[BaseEntityControllerEvent.TICK_WITH_PLAYER_INPUT]) => {
    if (!this.isSpawned || !this.world) {
      return;
    }

    const { input } = payload;

    // Update flashlight to point in camera direction
    if (this._light && this._light.isSpawned) {
      // Calculate a position in front of the player based on camera direction
      const cameraDir = this.player.camera.facingDirection;
      const distance = 10; // Distance in front to point the light
      this._light.setTrackedPosition({
        x: this.position.x + cameraDir.x * distance,
        y: this.position.y + cameraDir.y * distance,
        z: this.position.z + cameraDir.z * distance
      });
    }

    if (!this._gun) {
      return;
    }
    
    try {
      if (input.ml && !this.downed) {
        this._gun.shoot();
      }

      if (input.r && !this.downed) {
        this._gun.reload();
        input.r = false;
      }

      if (input.e) {
        this._interactRaycast();
        input.e = false;
      }
    } catch (error) {
      console.error('Error in _onTickWithPlayerInput:', error);
    }
  }

  private _setDowned(downed: boolean) {
    if (!this.world) {
      return;
    }

    this.downed = downed;

    if (downed) {
      this.health = 0;
      this._updatePlayerUIHealth();
    }

    this.playerController.idleLoopedAnimations = downed ? [ 'sleep' ] : [ 'idle_lower' ];
    this.playerController.walkLoopedAnimations = downed ? [ 'crawling' ] : [ 'walk_lower' ];
    this.playerController.runLoopedAnimations = downed ? [ 'crawling' ] : [ 'run_lower' ];
    this.playerController.runVelocity = downed ? 1 : 8;
    this.playerController.walkVelocity = downed ? 1 : 4;
    this.playerController.jumpVelocity = downed ? 0 : 10;

    if (!downed && this._gun) {
      this._gun.setParentAnimations();
    }

    if (downed) {
      this._downedSceneUI.setState({ progress: 0 })
      this._downedSceneUI.load(this.world);
      this.world.chatManager.sendPlayerMessage(this.player, 'You are downed! A teammate can still revive you!', 'FF0000');

      GameManager.instance.checkEndGame();
    } else {
      this._downedSceneUI.unload();
      this.world.chatManager.sendPlayerMessage(this.player, 'You are back up! Thank your team & fight the horde!', '00FF00');
    }
  }

  private _interactRaycast() {
    if (!this.world) {
      return;
    }

    if (this.downed) {
      return this.world.chatManager.sendPlayerMessage(this.player, 'You are downed! You cannot revive others or make purchases!', 'FF0000');
    }

    // Get raycast direction from player camera
    const origin = {
      x: this.position.x,
      y: this.position.y + this.player.camera.offset.y,
      z: this.position.z,
    };
    const direction = this.player.camera.facingDirection;
    const length = 4;

    const raycastHit = this.world.simulation.raycast(origin, direction, length, {
      filterExcludeRigidBody: this.rawRigidBody, // prevent raycast from hitting the player
    });

    const hitEntity = raycastHit?.hitEntity;

    if (!hitEntity) {
      return;
    }

    if (hitEntity instanceof InteractableEntity) {
      hitEntity.interact(this);
    }

    if (hitEntity instanceof GamePlayerEntity && hitEntity.downed) {
      hitEntity.progressRevive(this);
    }
  }

  private _updatePlayerUIMoney() {
    this.player.ui.sendData({ type: 'money', money: this.money });
  }

  private _updatePlayerUIHealth() {
    this.player.ui.sendData({ type: 'health', health: this.health, maxHealth: this.maxHealth });
  }

  private _autoHealTicker() {
    setTimeout(() => {
      if (!this.isSpawned) {
        return;
      }

      const timeSinceLastDamage = Date.now() - this._lastDamageTime;
      
      if (!this.downed && 
          this.health < this.maxHealth && 
          timeSinceLastDamage >= this.REGEN_DELAY_MS) {
          this.health += 1;
          this._updatePlayerUIHealth();
      }

      this._autoHealTicker();
    }, 1000);
  }

  public addKill(isHeadshot: boolean) {
    this.kills++;
    if (isHeadshot) {
      this.headshots++;
    }
    this.updateScoreboard();
  }

  public addRevive() {
    this.revives++;
    this.updateScoreboard();
  }

  private updateScoreboard() {
    if (!this.world) return;

    // Get all players and their stats
    const players = this.world.entityManager.getAllPlayerEntities().map(entity => {
      const player = entity as GamePlayerEntity;
      return {
        name: player.player.username,
        kills: player.kills,
        headshots: player.headshots,
        money: Math.round(player.money),
        score: Math.round(player.score),
        revives: player.revives,
        downs: player.downs
      };
    });

    // Send scoreboard update to all players
    GameServer.instance.playerManager.getConnectedPlayersByWorld(this.world).forEach((player: Player) => {
      player.ui.sendData({
        type: 'scoreboard',
        players,
        wave: GameManager.instance.waveNumber
      });
    });
  }
}

