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
const SLOWEST_SPAWN_INTERVAL_MS = 2600; // 2.6 seconds between zombies (30% slower)
const FASTEST_SPAWN_INTERVAL_MS = 143; // Increased minimum interval by 30%
const GAME_START_COUNTDOWN_S = 25; // 5 seconds delay before game starts
const WAVE_SPAWN_INTERVAL_REDUCTION_MS = 200; // Slower early scaling
const WAVE_DELAY_MS = 10000; // 8s between waves
const BASE_PLAYER_COUNT = 3; // Assuming a default BASE_PLAYER_COUNT
const HEALTH_SCALING_PER_PLAYER = 0.1; // Assuming a default HEALTH_SCALING_PER_PLAYER
const REWARD_SCALING_PER_PLAYER = 1.0; // Assuming a default REWARD_SCALING_PER_PLAYER
const SPAWN_RATE_SCALING_PER_PLAYER = 0.05; // Assuming a default SPAWN_RATE_SCALING_PER_PLAYER

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
        this.world.chatManager.sendBroadcastMessage('Press TAB to view the scoreboard', '00FF00');
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

    // Get current player count for scaling
    const playerCount = this.world.entityManager.getAllPlayerEntities().length;
    const additionalPlayers = Math.max(0, playerCount - BASE_PLAYER_COUNT);
    const healthMultiplier = 1 + (additionalPlayers * HEALTH_SCALING_PER_PLAYER);
    const spawnRateMultiplier = 1 + (additionalPlayers * SPAWN_RATE_SCALING_PER_PLAYER);
    const rewardMultiplier = Math.max(0.5, 1 - (additionalPlayers * (1 - REWARD_SCALING_PER_PLAYER)));

    // Adjust health scaling for different wave ranges
    let healthScaling;
    if (this.waveNumber <= 4) {
        // Early waves: normal scaling
        healthScaling = Math.pow(1.10, this.waveNumber - 1);
    } else if (this.waveNumber <= 15) {
        // Waves 5-15: much reduced scaling
        healthScaling = Math.pow(1.15, 4) + Math.pow(1.15, this.waveNumber - 4);
    } else {
        // Wave 15+: moderate scaling
        healthScaling = Math.pow(1.2, 4) + Math.pow(1.20, 11) + Math.pow(1.08, this.waveNumber - 15);
    }

    const zombie = new ZombieEntity({
        health: Math.floor(10 * healthScaling * healthMultiplier),
        // Reduce speed scaling
        speed: Math.min(7, 3 + Math.min(12, this.waveNumber) * 0.2),
        reward: Math.floor(10 * rewardMultiplier)
    });

    zombie.spawn(this.world, this._getSpawnPoint());

    // Modified spawn interval calculation for more zombies from wave 10+
    let spawnInterval;
    if (this.waveNumber <= 4) {
        // Waves 1-4: Keep the same slower base spawning
        spawnInterval = SLOWEST_SPAWN_INTERVAL_MS - (this.waveNumber * WAVE_SPAWN_INTERVAL_REDUCTION_MS);
    } else if (this.waveNumber <= 9) {
        // Waves 5-9: Slightly faster than before
        const baseInterval = SLOWEST_SPAWN_INTERVAL_MS - (4 * WAVE_SPAWN_INTERVAL_REDUCTION_MS);
        spawnInterval = baseInterval - ((this.waveNumber - 4) * (WAVE_SPAWN_INTERVAL_REDUCTION_MS * 0.5)); // Increased from 0.4 to 0.5
    } else if (this.waveNumber <= 15) {
        // Waves 10-15: Much more aggressive scaling
        const baseInterval = 1200; // Start from a lower base interval at wave 10
        spawnInterval = baseInterval - ((this.waveNumber - 9) * 100); // Reduce by 100ms per wave
    } else {
        // Wave 15+: Very aggressive scaling
        spawnInterval = Math.max(FASTEST_SPAWN_INTERVAL_MS, 600 - ((this.waveNumber - 15) * 75)); // More aggressive reduction
    }
    
    // Apply player count scaling to spawn interval
    spawnInterval = Math.max(FASTEST_SPAWN_INTERVAL_MS, spawnInterval / spawnRateMultiplier);
    
    const nextSpawn = spawnInterval + this.waveDelay;

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
        const playerCount = this.world.entityManager.getAllPlayerEntities().length;
        const additionalPlayers = Math.max(0, playerCount - BASE_PLAYER_COUNT);
        const healthMultiplier = 1 + (additionalPlayers * HEALTH_SCALING_PER_PLAYER);
        const rewardMultiplier = Math.max(0.5, 1 - (additionalPlayers * (1 - REWARD_SCALING_PER_PLAYER)));

        // Calculate which boss this is (1st, 2nd, 3rd, etc.)
        const bossNumber = Math.floor(this.waveNumber / 5);
        
        // Reduced boss health scaling
        const baseHealth = bossNumber === 1 ? 333 : 800; // Reduced from 1000 to 800
        const bossHealthScaling = Math.pow(1.3, bossNumber - 1); // Reduced from 1.5 to 1.3

        // Slower damage scaling
        const damage = 3 + Math.floor((bossNumber - 1) * 1.5); // Reduced from +2 to +1.5 per appearance

        const ripper = new RipperEntity({
            health: Math.floor(baseHealth * bossHealthScaling * healthMultiplier),
            speed: Math.min(6, 2 + this.waveNumber * 0.2), // Reduced speed scaling
            damage: damage,
            reward: Math.floor(100* this.waveNumber * rewardMultiplier),
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
