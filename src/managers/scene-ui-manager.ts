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
  private static readonly BASE_DURATION = 250;  // Base duration for all animations
  private static readonly MAX_DURATION = 400;   // Maximum duration for any animation
  private static readonly DAMAGE_POWER = 0.8;   // How much damage affects duration
  private static readonly DAMAGE_MULTIPLIER = 2; // Base multiplier for damage->duration conversion

  // Scale constants
  private static readonly BASE_FONT_SIZE = 48;
  private static readonly BASE_SCALE = 0.8;
  private static readonly MAX_SCALE = 1.6;
  private static readonly HEADSHOT_SCALE_MULTIPLIER = 1.5;

  // Rise height constants - adjusted to work with CSS multipliers
  private static readonly BASE_RISE_HEIGHT = 5;        // Base height in pixels
  private static readonly RISE_HEIGHT_MULTIPLIER = 0.5; // Each point of damage adds 0.5px
  private static readonly MAX_RISE_HEIGHT = 10;         // Maximum rise height
  private static readonly HEADSHOT_HEIGHT_BONUS = 10;   // Extra height for headshots

  // Animation stages (as percentages of total duration)
  private static readonly STAGE_APPEAR = 15;     // When number reaches full size
  private static readonly STAGE_PEAK = 30;       // When number reaches highest point
  private static readonly STAGE_HOLD = 60;       // How long to hold at peak
  private static readonly STAGE_FADE_START = 85; // When to start fading out

  // Scale animation values
  private static readonly INITIAL_SCALE = 0.2;   // Starting scale
  private static readonly POP_SCALE = 1.2;       // Maximum scale during pop effect
  private static readonly FINAL_SCALE = 0.8;     // Scale when fading out

  // Opacity stages
  private static readonly INITIAL_OPACITY = 0;
  private static readonly PEAK_OPACITY = 1;
  private static readonly FADE_OPACITY = 0.5;
  private static readonly FINAL_OPACITY = 0;

  // Glow constants
  private static readonly BASE_GLOW = 5;
  private static readonly GLOW_MULTIPLIER = 15;
  private static readonly SECONDARY_GLOW_RATIO = 0.5;  // Secondary glow is 50% of primary

  // Distance calculation constants
  private static readonly DISTANCE_DIVISOR = 30;
  private static readonly DISTANCE_POWER = 1.1;
  private static readonly MAX_DISTANCE_MULTIPLIER = 0.1;

  // Random offset constants
  private static readonly RANDOM_OFFSET_RANGE = 0.8;  // ±0.4 units
  private static readonly VERTICAL_OFFSET = 0.1;

  // Combo thresholds
  private static readonly MIN_COMBO_THRESHOLD = 3;
  private static readonly KILLING_SPREE_THRESHOLD = 5;
  private static readonly RAMPAGE_THRESHOLD = 7;
  private static readonly DOMINATING_THRESHOLD = 10;
  private static readonly UNSTOPPABLE_THRESHOLD = 15;

  // Animation cleanup buffer
  private static readonly CLEANUP_BUFFER = 50;  // ms to wait after animation before cleanup

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
   * Calculate animation duration based on damage
   */
  private calculateAnimationDuration(damage: number, distanceMultiplier: number): number {
    // Faster base duration with a smooth scaling based on damage
    return SceneUIManager.BASE_DURATION + Math.min(
      Math.pow(damage, SceneUIManager.DAMAGE_POWER) * SceneUIManager.DAMAGE_MULTIPLIER * distanceMultiplier,
      SceneUIManager.MAX_DURATION - SceneUIManager.BASE_DURATION
    );
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
    
    const duration = this.calculateAnimationDuration(damage, distanceMultiplier);
    
    // Enhanced scale calculation based on damage
    const baseScale = Math.min(
      SceneUIManager.BASE_SCALE + 
      (damage / SceneUIManager.DISTANCE_DIVISOR) * SceneUIManager.HEADSHOT_SCALE_MULTIPLIER * 
      (isHeadshot ? 1.5 : 1), // Bigger scale for headshots
      SceneUIManager.MAX_SCALE
    );
    
    // Random offset with smoother distribution
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * SceneUIManager.RANDOM_OFFSET_RANGE;
    const randomOffsetX = Math.cos(angle) * radius;
    const randomOffsetZ = Math.sin(angle) * radius;
    
    // Calculate color based on damage with enhanced intensity for headshots
    const colorInfo = ColorSystem.getScoreColor(isHeadshot ? damage * 1.5 : damage);
    
    // Create animation style with enhanced visuals
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
        y: worldPosition.y + SceneUIManager.VERTICAL_OFFSET + (isHeadshot ? 0.2 : 0), // Slightly higher for headshots
        z: worldPosition.z
      },
      state: {
        amount: Math.floor(damage), // Use floor instead of round for consistency
        isCritical: isHeadshot,
        style: dynamicStyle
      }
    });

    damageNotification.load(this.world);

    // Cleanup with buffer
    setTimeout(() => {
      damageNotification.unload();
    }, duration + SceneUIManager.CLEANUP_BUFFER);
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
    
    // Calculate rise height based on damage and headshot status
    const riseHeight = Math.min(
      SceneUIManager.BASE_RISE_HEIGHT + 
      (score * SceneUIManager.RISE_HEIGHT_MULTIPLIER) + 
      (isHeadshot ? SceneUIManager.HEADSHOT_HEIGHT_BONUS : 0),
      SceneUIManager.MAX_RISE_HEIGHT
    );
    
    // Calculate glow intensity
    const glowIntensity = SceneUIManager.BASE_GLOW + colorInfo.intensity * SceneUIManager.GLOW_MULTIPLIER;
    
    // Return enhanced style with all animation parameters as CSS variables
    return `
      font-size: ${scale * SceneUIManager.BASE_FONT_SIZE}px;
      color: ${colorInfo.main};
      text-shadow: 0 0 ${glowIntensity}px ${colorInfo.glow},
                   0 0 ${glowIntensity * SceneUIManager.SECONDARY_GLOW_RATIO}px ${colorInfo.glow};
      --rise-height: ${riseHeight}px;
      --initial-scale: ${SceneUIManager.INITIAL_SCALE};
      --pop-scale: ${SceneUIManager.POP_SCALE};
      --final-scale: ${SceneUIManager.FINAL_SCALE};
      --stage-appear: ${SceneUIManager.STAGE_APPEAR}%;
      --stage-peak: ${SceneUIManager.STAGE_PEAK}%;
      --stage-hold: ${SceneUIManager.STAGE_HOLD}%;
      --stage-fade: ${SceneUIManager.STAGE_FADE_START}%;
      --initial-opacity: ${SceneUIManager.INITIAL_OPACITY};
      --peak-opacity: ${SceneUIManager.PEAK_OPACITY};
      --fade-opacity: ${SceneUIManager.FADE_OPACITY};
      --final-opacity: ${SceneUIManager.FINAL_OPACITY};
      transform: translateZ(0) translate(${offsetX * 50}px, ${offsetZ * 50}px);
      will-change: transform, opacity;
      animation-duration: ${duration}ms;
      animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
      perspective: 1000px;
      backface-visibility: hidden;
      ${isHeadshot ? 'animation-name: criticalPulse;' : ''}
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