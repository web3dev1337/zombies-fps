import { Player } from 'hytopia';

/**
 * Interface for hit information used in score calculations
 */
export interface HitInfo {
  playerId: string;
  damage: number;
  distance: number;
  targetSpeed: number;
  isHeadshot: boolean;
  isKill: boolean;
  hitPosition: { x: number, y: number, z: number };
  spawnOrigin?: { x: number, y: number, z: number };
}

/**
 * Interface for tracking player statistics
 */
interface PlayerStats {
  combo: number;
  lastHitTime: number;
  multiHitCount: number;
  lastMultiHitTime: number;
}

/**
 * ScoreManager handles all score calculations and combo tracking
 */
export class ScoreManager {
  private static instance: ScoreManager;
  
  private static readonly SCORING_CONFIG = {
    BASE_SCORE: 10,
    DISTANCE_MULTIPLIER: 0.1,
    SPEED_MULTIPLIER: 0.2,
    HEADSHOT_MULTIPLIER: 2.0,
    COMBO_TIMEOUT_MS: 2000,
    MULTI_HIT_TIMEOUT_MS: 500,
    MAX_COMBO_BONUS: 2.0,
    MAX_MULTI_HIT_BONUS: 1.5
  };

  private playerStats: Map<string, PlayerStats> = new Map();

  private constructor() {}

  public static getInstance(): ScoreManager {
    if (!ScoreManager.instance) {
      ScoreManager.instance = new ScoreManager();
    }
    return ScoreManager.instance;
  }

  /**
   * Calculate score based on hit information
   */
  public calculateScore(hit: HitInfo): number {
    const baseScore = ScoreManager.SCORING_CONFIG.BASE_SCORE;
    const distanceBonus = this.calculateDistanceBonus(hit.distance);
    const speedBonus = this.calculateSpeedBonus(hit.targetSpeed);
    const comboBonus = this.calculateComboBonus(hit.playerId);
    const headshotBonus = hit.isHeadshot ? ScoreManager.SCORING_CONFIG.HEADSHOT_MULTIPLIER - 1 : 0;
    
    // Update player combo stats
    this.updateCombo(hit.playerId);
    
    // Calculate final score with all bonuses
    return Math.round(baseScore * (1 + distanceBonus + speedBonus + comboBonus + headshotBonus));
  }

  /**
   * Calculate bonus based on distance
   */
  private calculateDistanceBonus(distance: number): number {
    return Math.min(distance * ScoreManager.SCORING_CONFIG.DISTANCE_MULTIPLIER, 1.0);
  }

  /**
   * Calculate bonus based on target speed
   */
  private calculateSpeedBonus(speed: number): number {
    return Math.min(speed * ScoreManager.SCORING_CONFIG.SPEED_MULTIPLIER, 1.0);
  }

  /**
   * Calculate bonus based on combo
   */
  private calculateComboBonus(playerId: string): number {
    const stats = this.getPlayerStats(playerId);
    const comboFactor = Math.min((stats.combo - 1) * 0.1, ScoreManager.SCORING_CONFIG.MAX_COMBO_BONUS);
    
    // Add multi-hit bonus if applicable
    const multiHitFactor = Math.min((stats.multiHitCount - 1) * 0.2, ScoreManager.SCORING_CONFIG.MAX_MULTI_HIT_BONUS);
    
    return comboFactor + multiHitFactor;
  }

  /**
   * Update player combo stats
   */
  private updateCombo(playerId: string): void {
    const stats = this.getPlayerStats(playerId);
    const currentTime = Date.now();
    
    // Update combo if within timeout window
    if (currentTime - stats.lastHitTime <= ScoreManager.SCORING_CONFIG.COMBO_TIMEOUT_MS) {
      stats.combo++;
    } else {
      stats.combo = 1;
    }
    
    // Update multi-hit if within multi-hit timeout window
    if (currentTime - stats.lastMultiHitTime <= ScoreManager.SCORING_CONFIG.MULTI_HIT_TIMEOUT_MS) {
      stats.multiHitCount++;
    } else {
      stats.multiHitCount = 1;
    }
    
    stats.lastHitTime = currentTime;
    stats.lastMultiHitTime = currentTime;
  }

  /**
   * Get player stats, creating new stats if needed
   */
  private getPlayerStats(playerId: string): PlayerStats {
    if (!this.playerStats.has(playerId)) {
      this.playerStats.set(playerId, {
        combo: 0,
        lastHitTime: 0,
        multiHitCount: 0,
        lastMultiHitTime: 0
      });
    }
    return this.playerStats.get(playerId)!;
  }

  /**
   * Get current combo for a player
   */
  public getCombo(playerId: string): number {
    return this.getPlayerStats(playerId).combo;
  }

  /**
   * Reset combo for a player
   */
  public resetCombo(playerId: string): void {
    const stats = this.getPlayerStats(playerId);
    stats.combo = 0;
    stats.multiHitCount = 0;
  }

  /**
   * Check if combo is active for a player
   */
  public hasActiveCombo(playerId: string): boolean {
    return this.getPlayerStats(playerId).combo > 1;
  }
} 