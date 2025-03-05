import { World, Player, SceneUI } from 'hytopia';
import type { Vector3Like } from 'hytopia';
import { ColorSystem } from './color-system';
import type { ColorInfo } from './color-system';
import { ScoreManager } from './score-manager';
import type { HitInfo } from './score-manager';

export class SceneUIManager {
  private static instance: SceneUIManager;
  private world: World;

  // Animation constants
  private static readonly LOW_DAMAGE_THRESHOLD = 30;
  private static readonly BASE_DURATION = 150;
  private static readonly MAX_DURATION = 150;
  private static readonly LOW_DAMAGE_POWER = 0.8;
  private static readonly HIGH_DAMAGE_POWER = 1.4;
  private static readonly LOW_DAMAGE_MULTIPLIER = 3;
  private static readonly HIGH_DAMAGE_MULTIPLIER = 4;

  // Scale constants
  private static readonly BASE_SCALE = 1;
  private static readonly MAX_SCALE_INCREASE = 0.8;
  private static readonly LOW_DAMAGE_SCALE_DIVISOR = 60;
  private static readonly HIGH_DAMAGE_SCALE_DIVISOR = 70;
  private static readonly LOW_DAMAGE_SCALE_POWER = 1.8;
  private static readonly HIGH_DAMAGE_SCALE_POWER = 2.4;
  private static readonly BASE_FONT_SIZE = 48;

  // Rise height constants
  private static readonly NORMAL_RISE_HEIGHT = 250;
  private static readonly HEADSHOT_RISE_HEIGHT = 300;

  // Glow constants
  private static readonly BASE_GLOW = 5;
  private static readonly GLOW_MULTIPLIER = 15;

  // Hit notification constants
  private static readonly MIN_LIFETIME = 800;
  private static readonly MAX_LIFETIME = 1500;
  private static readonly LIFETIME_LOW_DAMAGE_POWER = 1.2;
  private static readonly LIFETIME_HIGH_DAMAGE_POWER = 1.4;
  private static readonly LIFETIME_LOW_MULTIPLIER = 10;
  private static readonly LIFETIME_HIGH_MULTIPLIER = 12;
  private static readonly BASE_HIT_SCALE = 0.8;
  private static readonly HIT_SCALE_DIVISOR = 50;
  private static readonly HIT_SCALE_MULTIPLIER = 0.4;
  private static readonly MAX_HIT_SCALE = 1.6;

  // Distance calculation constants
  private static readonly DISTANCE_DIVISOR = 30;
  private static readonly DISTANCE_POWER = 1.1;
  private static readonly MAX_DISTANCE_MULTIPLIER = 0.1;

  // Random offset constants
  private static readonly RANDOM_OFFSET_RANGE = 0.8;  // ±0.4 units
  private static readonly VERTICAL_OFFSET = 0.1;

  // Block destruction constants
  private static readonly BLOCK_SCORE_POWER = 1.4;
  private static readonly BLOCK_VERTICAL_BASE = 1.5;
  private static readonly BLOCK_SCORE_DIVISOR = 30;
  private static readonly MAX_BLOCK_VERTICAL = 1.5;

  // Combo thresholds
  private static readonly MIN_COMBO_THRESHOLD = 3;
  private static readonly KILLING_SPREE_THRESHOLD = 5;
  private static readonly RAMPAGE_THRESHOLD = 7;
  private static readonly DOMINATING_THRESHOLD = 10;
  private static readonly UNSTOPPABLE_THRESHOLD = 15;

  // Animation cleanup buffer
  private static readonly CLEANUP_BUFFER = 100;  // ms to wait after animation before cleanup

  private constructor(world: World) {
    this.world = world;
  }

  public static getInstance(world: World): SceneUIManager {
    if (!SceneUIManager.instance) {
      SceneUIManager.instance = new SceneUIManager(world);
    }
    return SceneUIManager.instance;
  }

  /**
   * Show hit notification at the hit position
   */
  public showHitNotification(worldPosition: Vector3Like, damage: number, player: Player, isHeadshot: boolean = false, spawnOrigin?: Vector3Like): void {
    // Calculate distance multiplier if spawn origin is available
    let distanceMultiplier = 1;
    if (worldPosition && spawnOrigin) {
      const dx = worldPosition.x - spawnOrigin.x;
      const dy = worldPosition.y - spawnOrigin.y;
      const dz = worldPosition.z - spawnOrigin.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      distanceMultiplier = 1 + Math.min(Math.pow(distance / SceneUIManager.DISTANCE_DIVISOR, SceneUIManager.DISTANCE_POWER), SceneUIManager.MAX_DISTANCE_MULTIPLIER);
    }
    
    // Calculate lifetime based on damage (bigger hits last longer)
    const duration = SceneUIManager.MIN_LIFETIME + Math.min(
      damage <= SceneUIManager.LOW_DAMAGE_THRESHOLD 
        ? Math.pow(damage, SceneUIManager.LIFETIME_LOW_DAMAGE_POWER) * SceneUIManager.LIFETIME_LOW_MULTIPLIER
        : Math.pow(damage, SceneUIManager.LIFETIME_HIGH_DAMAGE_POWER) * SceneUIManager.LIFETIME_HIGH_MULTIPLIER, 
      SceneUIManager.MAX_LIFETIME - SceneUIManager.MIN_LIFETIME
    );
    
    // Calculate scale based on damage (bigger hits = bigger numbers)
    const baseScale = Math.min(SceneUIManager.BASE_HIT_SCALE + (damage / SceneUIManager.HIT_SCALE_DIVISOR) * SceneUIManager.HIT_SCALE_MULTIPLIER, SceneUIManager.MAX_HIT_SCALE);
    
    // Random offset for more natural movement
    const randomOffsetX = (Math.random() - 0.5) * SceneUIManager.RANDOM_OFFSET_RANGE;
    const randomOffsetZ = (Math.random() - 0.5) * SceneUIManager.RANDOM_OFFSET_RANGE;
    
    // Calculate color based on damage
    const colorInfo = ColorSystem.getScoreColor(damage);
    
    // Create animation style with random trajectory and smooth easing
    const dynamicStyle = this.createDynamicStyle(damage, baseScale, duration, colorInfo, {
      offsetX: randomOffsetX,
      offsetZ: randomOffsetZ,
      isHeadshot
    });

    // Create and load the Scene UI for damage notification
    const damageNotification = new SceneUI({
      templateId: 'damage-notification',
      position: {
        x: worldPosition.x,
        y: worldPosition.y + SceneUIManager.VERTICAL_OFFSET,
        z: worldPosition.z
      },
      state: {
        amount: damage,
        isCritical: isHeadshot,
        style: dynamicStyle
      }
    });

    damageNotification.load(this.world);

    // Automatically unload after animation completes
    setTimeout(() => {
      damageNotification.unload();
    }, duration + SceneUIManager.CLEANUP_BUFFER);
  }

  /**
   * Show block destroyed notification with special effects
   */
  public showBlockDestroyedNotification(
    worldPosition: Vector3Like,
    score: number,
    player: Player,
    spawnOrigin?: Vector3Like
  ): void {
    const roundedScore = Math.max(0, Math.round(score));
    const distanceMultiplier = this.calculateDistanceMultiplier(worldPosition, spawnOrigin);
    const duration = this.calculateAnimationDuration(roundedScore, distanceMultiplier);
    const scale = this.calculateScale(roundedScore, distanceMultiplier);
    const colorInfo = ColorSystem.getScoreColor(roundedScore);
    
    // Random offset for block destruction
    const randomOffsetX = (Math.random() - 0.5) * SceneUIManager.RANDOM_OFFSET_RANGE;
    const randomOffsetZ = (Math.random() - 0.5) * SceneUIManager.RANDOM_OFFSET_RANGE;
    
    player.ui.sendData({
      type: 'blockDestroyed',
      data: {
        score: roundedScore,
        position: worldPosition,
        style: this.createDynamicStyle(roundedScore, scale, duration, colorInfo, {
          offsetX: randomOffsetX,
          offsetZ: randomOffsetZ,
          isHeadshot: false
        }),
        verticalOffset: SceneUIManager.BLOCK_VERTICAL_BASE + Math.min(Math.pow(roundedScore / SceneUIManager.BLOCK_SCORE_DIVISOR, SceneUIManager.BLOCK_SCORE_POWER), SceneUIManager.MAX_BLOCK_VERTICAL),
        duration
      }
    });
  }

  /**
   * Show combo notification
   */
  public showComboNotification(player: Player, combo: number): void {
    if (combo < SceneUIManager.MIN_COMBO_THRESHOLD) return;
    
    const colorInfo = ColorSystem.getComboColor(combo);
    const bonusText = this.getComboText(combo);
    
    player.ui.sendData({
      type: 'combo',
      data: {
        combo,
        bonusText,
        color: colorInfo.main,
        glow: colorInfo.glow,
        intensity: colorInfo.intensity
      }
    });
  }

  /**
   * Calculate distance multiplier for effects
   */
  private calculateDistanceMultiplier(position: Vector3Like, origin?: Vector3Like): number {
    if (!origin) return 1;
    
    const dx = position.x - origin.x;
    const dy = position.y - origin.y;
    const dz = position.z - origin.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    return 1 + Math.min(Math.pow(distance / SceneUIManager.DISTANCE_DIVISOR, SceneUIManager.DISTANCE_POWER), SceneUIManager.MAX_DISTANCE_MULTIPLIER);
  }

  /**
   * Calculate animation duration based on score
   */
  private calculateAnimationDuration(score: number, distanceMultiplier: number): number {
    return SceneUIManager.BASE_DURATION + Math.min(
      score <= SceneUIManager.LOW_DAMAGE_THRESHOLD
        ? Math.pow(score, SceneUIManager.LOW_DAMAGE_POWER) * SceneUIManager.LOW_DAMAGE_MULTIPLIER
        : Math.pow(score, SceneUIManager.HIGH_DAMAGE_POWER) * SceneUIManager.HIGH_DAMAGE_MULTIPLIER
      * distanceMultiplier, SceneUIManager.MAX_DURATION);
  }

  /**
   * Calculate scale based on score
   */
  private calculateScale(score: number, distanceMultiplier: number): number {
    return SceneUIManager.BASE_SCALE + Math.min(
      score <= SceneUIManager.LOW_DAMAGE_THRESHOLD
        ? Math.pow(score / SceneUIManager.LOW_DAMAGE_SCALE_DIVISOR, SceneUIManager.LOW_DAMAGE_SCALE_POWER)
        : Math.pow(score / SceneUIManager.HIGH_DAMAGE_SCALE_DIVISOR, SceneUIManager.HIGH_DAMAGE_SCALE_POWER)
      * distanceMultiplier, SceneUIManager.MAX_SCALE_INCREASE);
  }

  /**
   * Get descriptive text for combo
   */
  private getComboText(combo: number): string {
    if (combo >= SceneUIManager.UNSTOPPABLE_THRESHOLD) return 'UNSTOPPABLE!';
    if (combo >= SceneUIManager.DOMINATING_THRESHOLD) return 'DOMINATING!';
    if (combo >= SceneUIManager.RAMPAGE_THRESHOLD) return 'RAMPAGE!';
    if (combo >= SceneUIManager.KILLING_SPREE_THRESHOLD) return 'KILLING SPREE!';
    if (combo >= SceneUIManager.MIN_COMBO_THRESHOLD) return 'COMBO!';
    return '';
  }

  /**
   * Create dynamic CSS style for damage numbers
   */
  private createDynamicStyle(
    score: number, 
    scale: number, 
    duration: number, 
    colorInfo: ColorInfo,
    options: { offsetX: number; offsetZ: number; isHeadshot: boolean }
  ): string {
    const { offsetX, offsetZ, isHeadshot } = options;
    
    // Calculate movement parameters - using absolute pixel values for more visibility
    const baseRiseHeight = isHeadshot ? SceneUIManager.HEADSHOT_RISE_HEIGHT : SceneUIManager.NORMAL_RISE_HEIGHT;
    
    // Return simplified style focused on color and scale, let CSS animation handle movement
    return `
      font-size: ${scale * SceneUIManager.BASE_FONT_SIZE}px;
      color: ${colorInfo.main};
      text-shadow: 0 0 ${SceneUIManager.BASE_GLOW + colorInfo.intensity * SceneUIManager.GLOW_MULTIPLIER}px ${colorInfo.glow};
      --score-value: ${score};
      --intensity: ${colorInfo.intensity};
      /* Force hardware acceleration for smoother animations */
      transform: translateZ(0);
      will-change: transform;
    `;
  }

  /**
   * Process hit information and show appropriate notifications
   */
  public processHit(hitInfo: HitInfo): void {
    if (!this.world) return;
    
    // In Hytopia, we need to find the player entity first, then get the player
    let player: Player | undefined;
    
    this.world.entityManager.getAllPlayerEntities().forEach(playerEntity => {
      if (playerEntity.player && playerEntity.player.id === hitInfo.playerId) {
        player = playerEntity.player;
      }
    });
    
    if (!player) return;
    
    // Calculate score using ScoreManager
    const scoreManager = ScoreManager.getInstance();
    const score = scoreManager.calculateScore(hitInfo);
    
    // Show hit notification
    this.showHitNotification(
      hitInfo.hitPosition,
      hitInfo.damage,
      player,
      hitInfo.isHeadshot,
      hitInfo.spawnOrigin
    );
    
    // Show combo notification if applicable
    const combo = scoreManager.getCombo(hitInfo.playerId);
    if (combo >= 3) {
      this.showComboNotification(player, combo);
    }
    
    // If it's a kill, show special effects
    if (hitInfo.isKill) {
      // Reset combo after showing the notification
      scoreManager.resetCombo(hitInfo.playerId);
    }
  }

  public cleanup(): void {
    // No cleanup needed as we're not storing any SceneUI instances
  }
} 