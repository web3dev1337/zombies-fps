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
    
    // Calculate animation duration based on damage
    const duration = 800 + Math.min(
      damage <= 30 
        ? Math.pow(damage, 1.2) * 3 
        : Math.pow(damage, 1.8) * 4
      * distanceMultiplier, 1200);
    
    // Calculate scale based on damage
    const scale = 1 + Math.min(
      damage <= 30
        ? Math.pow(damage / 80, 2.4)
        : Math.pow(damage / 70, 2.4)
      * distanceMultiplier, 0.8);
    
    // Random offset for more natural movement
    const randomOffsetX = (Math.random() - 0.5) * 0.5; // ±0.25 units
    const randomOffsetZ = (Math.random() - 0.5) * 0.5;
    const verticalOffset = 0.2; // Start closer to hit point
    
    // Calculate color based on damage
    const colorInfo = ColorSystem.getScoreColor(damage);
    
    // Create animation style with random trajectory
    const dynamicStyle = this.createDynamicStyle(damage, scale, duration, colorInfo, {
      offsetX: randomOffsetX,
      offsetZ: randomOffsetZ,
      isHeadshot
    });

    // Create and load the Scene UI for damage notification
    const damageNotification = new SceneUI({
      templateId: 'damage-notification',
      position: {
        x: worldPosition.x + randomOffsetX * 0.2, // Small initial offset
        y: worldPosition.y + verticalOffset,
        z: worldPosition.z + randomOffsetZ * 0.2
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
    
    player.ui.sendData({
      type: 'blockDestroyed',
      data: {
        score: roundedScore,
        position: worldPosition,
        style: this.createDynamicStyle(roundedScore, scale, duration, colorInfo),
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
    return 500 + Math.min(
      score <= 30 
        ? Math.pow(score, 1.2) * 3 
        : Math.pow(score, 1.8) * 4
      * distanceMultiplier, 1200);
  }

  /**
   * Calculate scale based on score
   */
  private calculateScale(score: number, distanceMultiplier: number): number {
    return 1 + Math.min(
      score <= 30
        ? Math.pow(score / 80, 2.4)
        : Math.pow(score / 70, 2.4)
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
    
    // Calculate bounce height based on damage and headshot
    const bounceHeight = isHeadshot ? 2 : 1.2;
    const finalHeight = isHeadshot ? 3 : 2;
    
    // Create more dynamic movement with cubic bezier
    const timing = isHeadshot ? 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'cubic-bezier(0.34, 1.56, 0.64, 1)';
    
    return `
      @keyframes scoreAnimation {
        0% {
          opacity: 0;
          transform: translate3d(0, 0, 0) scale(0.2);
        }
        10% {
          opacity: 1;
          transform: translate3d(
            ${offsetX * 0.5}px,
            ${-bounceHeight * scale}px,
            ${offsetZ * 0.5}px
          ) scale(${scale * 1.2});
        }
        30% {
          opacity: 1;
          transform: translate3d(
            ${offsetX}px,
            ${-bounceHeight * 1.5 * scale}px,
            ${offsetZ}px
          ) scale(${scale});
        }
        60% {
          opacity: 1;
          transform: translate3d(
            ${offsetX * 2}px,
            ${-finalHeight * scale}px,
            ${offsetZ * 2}px
          ) scale(${scale * 0.9});
        }
        100% {
          opacity: 0;
          transform: translate3d(
            ${offsetX * 3}px,
            ${-finalHeight * 1.5 * scale}px,
            ${offsetZ * 3}px
          ) scale(${scale * 0.7});
        }
      }
      animation: scoreAnimation ${duration}ms ${timing} forwards;
      will-change: transform, opacity;
      transform: translateZ(0);
      font-size: ${scale * 48}px;
      color: ${colorInfo.main};
      text-shadow: 0 0 ${5 + colorInfo.intensity * 15}px ${colorInfo.glow};
      --score-value: ${score};
      --intensity: ${colorInfo.intensity};
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