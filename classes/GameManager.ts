import { Audio, Collider, ColliderShape, CollisionGroup, GameServer } from 'hytopia';
import GamePlayerEntity from './GamePlayerEntity';
import PurchaseBarrierEntity from './PurchaseBarrierEntity';
import { INVISIBLE_WALLS, INVISIBLE_WALL_COLLISION_GROUP, PURCHASE_BARRIERS, ENEMY_SPAWN_POINTS, WEAPON_CRATES, WALL_WEAPONS } from '../gameConfig';
import RipperEntity from './enemies/RipperEntity';
import ZombieEntity from './enemies/ZombieEntity';
import WeaponCrateEntity from './WeaponCrateEntity';
import WallWeaponEntity from './WallWeaponEntity';
import type { World, Vector3Like } from 'hytopia';
import type EnemyEntity from './EnemyEntity';
import type { Player } from 'hytopia';

const GAME_WAVE_INTERVAL_MS = 30 * 1000; // 30 seconds between waves
const SLOWEST_SPAWN_INTERVAL_MS = 2000; // TEMPORARY: Faster initial spawn rate (Original: 4000)
const FASTEST_SPAWN_INTERVAL_MS = 500; // TEMPORARY: Faster minimum spawn rate (Original: 750)
const GAME_START_COUNTDOWN_S = 5; // 5 seconds delay before game starts
const WAVE_SPAWN_INTERVAL_REDUCTION_MS = 400; // TEMPORARY: Faster spawn rate reduction per wave (Original: 300)
const WAVE_DELAY_MS = 10000; // 10s between waves

export default class GameManager {
  public static readonly instance = new GameManager();

  public isStarted = false;
  public unlockedIds: Set<string> = new Set([ 'start' ]);
  public waveNumber = 0;
  public waveDelay = 0;
  public world: World | undefined;

  private _enemySpawnTimeout: any;
  private _endGameTimeout: any;
  private _startCountdown: number = GAME_START_COUNTDOWN_S;
  private _startInterval: any;
  private _waveTimeout: any;
  private _waveStartAudio: Audio;

  public constructor() {
    this._waveStartAudio = new Audio({
      uri: 'audio/sfx/wave-start.mp3',
      loop: false,
      volume: 1,
    });
  }

  public addUnlockedId(id: string) {
    this.unlockedIds.add(id);
  }

  public checkEndGame() {
    if (this._endGameTimeout !== undefined) {
      return;
    }

    this._endGameTimeout = setTimeout(() => {
      if (!this.world) return;

      let allPlayersDowned = true;

      this.world.entityManager.getAllPlayerEntities().forEach(playerEntity => {
        const gamePlayerEntity = playerEntity as GamePlayerEntity;

        if (!gamePlayerEntity.downed) {
          allPlayersDowned = false;
        }
      });

      if (allPlayersDowned) {
        this.endGame();
      }

      this._endGameTimeout = undefined;
    }, 1000);
  }

  public setupGame(world: World) {
    this.world = world;

    // Setup invisible walls that only enemies can pass through
    INVISIBLE_WALLS.forEach(wall => {
      const wallCollider = new Collider({
        shape: ColliderShape.BLOCK,
        halfExtents: wall.halfExtents,
        relativePosition: wall.position,
        collisionGroups: {
          belongsTo: [ INVISIBLE_WALL_COLLISION_GROUP ],
          collidesWith: [ CollisionGroup.PLAYER ],
        },
      });

      wallCollider.addToSimulation(world.simulation);
    });

    // Spawn initial purchase barriers
    this.spawnPurchaseBarriers();

    // Setup weapon crates
    WEAPON_CRATES.forEach(crate => {
      const weaponCrate = new WeaponCrateEntity({
        name: crate.name,
        price: crate.price,
        rollableWeaponIds: crate.rollableWeaponIds,
      });

      weaponCrate.spawn(world, crate.position, crate.rotation);
    });

    // Setup wall weapons
    WALL_WEAPONS.forEach(weapon => {
      const wallWeapon = new WallWeaponEntity({
        name: weapon.name,
        price: weapon.price,
        weaponClass: weapon.weaponClass,
        modelUri: weapon.modelUri,
        displayOffset: weapon.displayOffset,
        displayRotation: weapon.displayRotation,
      });

      wallWeapon.spawn(world, weapon.position, weapon.rotation);
    });

    // Start ambient music
    (new Audio({
      uri: 'audio/music/bg.mp3',
      loop: true,
      volume: 0.4,
    })).play(world);

    this.startCountdown();
  }

  public startCountdown() {
    clearInterval(this._startInterval);
    this._startCountdown = GAME_START_COUNTDOWN_S;
    this._startInterval = setInterval(() => {
      if (!this.world || !this.world.entityManager.getAllPlayerEntities().length) return;

      this._startCountdown--;

      if (this._startCountdown <= 0) {
        this.startGame();
        this.world.chatManager.sendBroadcastMessage('Game starting!', 'FF0000');
      } else {
        this.world.chatManager.sendBroadcastMessage(`${this._startCountdown} seconds until the game starts...`, 'FF0000');
      }
    }, 1000);
  }

  public startGame() {
    if (!this.world || this.isStarted) return;

    this.isStarted = true;
    clearInterval(this._startInterval);

    GameServer.instance.playerManager.getConnectedPlayersByWorld(this.world).forEach(player => {
      player.ui.sendData({ type: 'start' });
    });

    // Spawn  zombies to test scaled pathfinding
    // this._spawnTestZombiesProgressive(200);

    // Comment out normal spawn loops for testing
    this._spawnLoop();
    this._waveLoop();
  }

  private _spawnTestZombiesProgressive(totalCount: number) {
    if (!this.world) return;

    const BATCH_SIZE = 10;        // Smaller batches for smoother spawning
    const BATCH_INTERVAL_MS = 100; // Faster spawning since we have better pathfinding
    let spawnedCount = 0;

    console.log(`Starting spawn of ${totalCount} zombies...`);
    
    const spawnBatch = () => {
      if (!this.world) return;

      const batchSize = Math.min(BATCH_SIZE, totalCount - spawnedCount);
      
      // Use multiple spawn points per batch
      for (let i = 0; i < batchSize; i++) {
        const spawnPoint = this._getSpawnPoint(); // Get different spawn point for each zombie
        const offsetX = (Math.random() - 0.5) * 4;  // Small spread to prevent clumping
        const offsetZ = (Math.random() - 0.5) * 4;
        
        const zombie = new ZombieEntity({
          health: 7,
          speed: 3 + Math.random() * 2,
        });

        zombie.spawn(this.world, {
          x: spawnPoint.x + offsetX,
          y: spawnPoint.y,
          z: spawnPoint.z + offsetZ
        });
        spawnedCount++;
      }

      // Log progress every 50 zombies
      if (spawnedCount % 50 === 0) {
        console.log(`Spawned ${spawnedCount}/${totalCount} zombies`);
        this.world?.chatManager.sendBroadcastMessage(`${spawnedCount} zombies spawned...`, 'FF0000');
      }

      // Schedule next batch if needed
      if (spawnedCount < totalCount) {
        setTimeout(() => spawnBatch(), BATCH_INTERVAL_MS);
      } else {
        console.log('All zombies spawned!');
        this.world?.chatManager.sendBroadcastMessage('All 200 zombies spawned! Good luck!', 'FF0000');
      }
    };

    // Start spawning
    spawnBatch();
  }

  public endGame() {
    if (!this.world) return;

    this.world.chatManager.sendBroadcastMessage(`Game Over! Your team made it to wave ${this.waveNumber}!`, '00FF00');

    clearTimeout(this._enemySpawnTimeout);
    clearTimeout(this._waveTimeout);

    this.isStarted = false;
    this.unlockedIds = new Set([ 'start' ]);
    this.waveNumber = 0;
    this.waveDelay = 0;

    this.world.entityManager.getEntitiesByTag('enemy').forEach(entity => {
      const enemy = entity as EnemyEntity;
      enemy.takeDamage(enemy.health); // triggers any UI updates when killed via takedamage
    });

    this.world.entityManager.getAllPlayerEntities().forEach(playerEntity => {
      const player = playerEntity.player;
      playerEntity.despawn();
    });

    setTimeout(() => { // brief timeout for at least a tick to allow packet resolution.
      GameServer.instance.playerManager.getConnectedPlayers().forEach(player => {
        this.spawnPlayerEntity(player);
      });
    }, 250);

    this.spawnPurchaseBarriers();
    this.startCountdown();
  }

  public spawnPlayerEntity(player: Player) {
    if (!this.world) return;

    const playerEntity = new GamePlayerEntity(player);
    playerEntity.spawn(this.world, { x: 2, y: 10, z: 19 });
    player.camera.setAttachedToEntity(playerEntity);
  }

  public spawnPurchaseBarriers() {
    if (!this.world) return;
   
    this.world.entityManager.getEntitiesByTag('purchase-barrier').forEach(entity => {
      entity.despawn();
    });
    
    PURCHASE_BARRIERS.forEach(barrier => {
      const purchaseBarrier = new PurchaseBarrierEntity({
        name: barrier.name,
        removalPrice: barrier.removalPrice,
        unlockIds: barrier.unlockIds,
        width: barrier.width,
      });

      purchaseBarrier.spawn(this.world!, barrier.position, barrier.rotation);
    });
  }

  private _spawnLoop() {
    if (!this.world) return; // type guard

    clearTimeout(this._enemySpawnTimeout);

    const zombie = new ZombieEntity({
      health: 7 + (this.waveNumber * 0.25),
      speed: Math.min(8, 3 + this.waveNumber * 0.4), // TEMPORARY: Faster speed increase per wave (Original: Math.min(6, 2 + this.waveNumber * 0.25))
    });

    zombie.spawn(this.world, this._getSpawnPoint());

    const nextSpawn = Math.max(FASTEST_SPAWN_INTERVAL_MS, SLOWEST_SPAWN_INTERVAL_MS - (this.waveNumber * WAVE_SPAWN_INTERVAL_REDUCTION_MS)) + this.waveDelay;

    this._enemySpawnTimeout = setTimeout(() => this._spawnLoop(), nextSpawn);
    this.waveDelay = 0;

    // Check end game conditions.
    this.checkEndGame();
  }

  private _waveLoop() {
    if (!this.world) return; // type guard

    clearTimeout(this._waveTimeout);

    this.waveNumber++;
    this.waveDelay = WAVE_DELAY_MS;

    this._waveStartAudio.play(this.world, true);

    GameServer.instance.playerManager.getConnectedPlayersByWorld(this.world).forEach(player => {
      player.ui.sendData({
        type: 'wave',
        wave: this.waveNumber,
      });
    });
    
    if (this.waveNumber % 5 === 0) { // Spawn a ripper every 5 waves
      const ripper = new RipperEntity({
        health: 50 * this.waveNumber,
        speed: 2 + this.waveNumber * 0.25,
        reward: 50 * this.waveNumber,
      });
      ripper.spawn(this.world, this._getSpawnPoint());
    }
    
    this._waveTimeout = setTimeout(() => this._waveLoop(), GAME_WAVE_INTERVAL_MS);
  }

  private _getSpawnPoint(): Vector3Like {
    const spawnPoints: Vector3Like[] = [];

    this.unlockedIds.forEach(id => {
      const spawnPoint = ENEMY_SPAWN_POINTS[id];
      if (spawnPoint) spawnPoints.push(...spawnPoint);
    });

    return spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
  }
}
