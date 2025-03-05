import { World, Player, SceneUI } from 'hytopia';
import type { Vector3Like } from 'hytopia';
import { ColorSystem } from './color-system';
import type { ColorInfo } from './color-system';
import { ScoreManager } from './score-manager';
import type { HitInfo } from './score-manager';

export class SceneUIManager {
  private static instance: SceneUIManager;
  private world: World;

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
      
      distanceMultiplier = 1 + Math.min(Math.pow(distance / 30, 1.1), 0.1);
    }
    
    // Calculate lifetime based on damage (bigger hits last longer)
    const minLifetime = 800;
    const maxLifetime = 1500;
    const duration = minLifetime + Math.min(
      damage <= 30 
        ? Math.pow(damage, 1.2) * 10
        : Math.pow(damage, 1.4) * 12, 
      maxLifetime - minLifetime
    );
    
    // Calculate scale based on damage (bigger hits = bigger numbers)
    const baseScale = Math.min(0.8 + (damage / 50) * 0.4, 1.6);
    
    // Random offset for more natural movement
    const randomOffsetX = (Math.random() - 0.5) * 0.8; // ±0.4 units
    const randomOffsetZ = (Math.random() - 0.5) * 0.8;
    const verticalOffset = 0.1; // Start very close to hit point
    
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
        y: worldPosition.y + verticalOffset,
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
    }, duration + 100);
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
    const randomOffsetX = (Math.random() - 0.5) * 0.8;
    const randomOffsetZ = (Math.random() - 0.5) * 0.8;
    
    player.ui.sendData({
      type: 'blockDestroyed',
      data: {
        score: roundedScore,
        position: worldPosition,
        style: this.createDynamicStyle(roundedScore, scale, duration, colorInfo, {
          offsetX: randomOffsetX,
          offsetZ: randomOffsetZ,
          isHeadshot: false // Block destruction is never a headshot
        }),
        verticalOffset: 1.5 + Math.min(Math.pow(roundedScore / 30, 1.4), 1.5),
        duration
      }
    });
  }

  /**
   * Show combo notification
   */
  public showComboNotification(player: Player, combo: number): void {
    if (combo < 3) return; // Only show for combos of 3 or more
    
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
    
    return 1 + Math.min(Math.pow(distance / 30, 1.1), 0.1);
  }

  /**
   * Calculate animation duration based on score
   */
  private calculateAnimationDuration(score: number, distanceMultiplier: number): number {
    return 300 + Math.min(  // Reduced base duration for faster initial movement
      score <= 30 
        ? Math.pow(score, 0.8) * 3  // Much faster for low damage
        : Math.pow(score, 1.4) * 4  // A bit faster for high damage
      * distanceMultiplier, 1000);  // Reduced max duration
  }

  /**
   * Calculate scale based on score
   */
  private calculateScale(score: number, distanceMultiplier: number): number {
    return 1 + Math.min(
      score <= 30
        ? Math.pow(score / 60, 1.8)  // Less exponential curve for quicker initial scale
        : Math.pow(score / 70, 2.4)  // Keep same scale for high damage
      * distanceMultiplier, 0.8);
  }

  /**
   * Get descriptive text for combo
   */
  private getComboText(combo: number): string {
    if (combo >= 15) return 'UNSTOPPABLE!';
    if (combo >= 10) return 'DOMINATING!';
    if (combo >= 7) return 'RAMPAGE!';
    if (combo >= 5) return 'KILLING SPREE!';
    if (combo >= 3) return 'COMBO!';
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
    const baseRiseHeight = isHeadshot ? 180 : 120;  // Slightly increased rise height
    
    // Return simplified style focused on color and scale, let CSS animation handle movement
    return `
      font-size: ${scale * 48}px;
      color: ${colorInfo.main};
      text-shadow: 0 0 ${5 + colorInfo.intensity * 15}px ${colorInfo.glow};
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