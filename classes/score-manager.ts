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
  totalDamage: number;
  highestCombo: number;
}

/**
 * Interface for score calculation result
 */
interface ScoreResult {
  score: number;
  combo: number;
  isComboExtended: boolean;
  comboMultiplier: number;
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
    MAX_MULTI_HIT_BONUS: 1.5,
    COMBO_SCORE_MULTIPLIER: 0.1, // 10% bonus per combo level
    MAX_COMBO_MULTIPLIER: 3.0    // Cap at 3x score
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
  public calculateScore(hit: HitInfo): ScoreResult {
    const baseScore = ScoreManager.SCORING_CONFIG.BASE_SCORE;
    const distanceBonus = this.calculateDistanceBonus(hit.distance);
    const speedBonus = this.calculateSpeedBonus(hit.targetSpeed);
    const { combo, isComboExtended } = this.updateCombo(hit.playerId);
    const comboMultiplier = this.calculateComboMultiplier(combo);
    const headshotBonus = hit.isHeadshot ? ScoreManager.SCORING_CONFIG.HEADSHOT_MULTIPLIER - 1 : 0;
    
    // Calculate base score with bonuses
    const baseScoreWithBonuses = baseScore * (1 + distanceBonus + speedBonus + headshotBonus);
    
    // Apply combo multiplier to final score
    const finalScore = Math.round(baseScoreWithBonuses * comboMultiplier);
    
    // Update player stats
    const stats = this.getPlayerStats(hit.playerId);
    stats.totalDamage += hit.damage;
    if (combo > stats.highestCombo) {
      stats.highestCombo = combo;
    }
    
    return {
      score: finalScore,
      combo,
      isComboExtended,
      comboMultiplier
    };
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
   * Calculate score multiplier based on combo
   */
  private calculateComboMultiplier(combo: number): number {
    const multiplier = 1 + ((combo - 1) * ScoreManager.SCORING_CONFIG.COMBO_SCORE_MULTIPLIER);
    return Math.min(multiplier, ScoreManager.SCORING_CONFIG.MAX_COMBO_MULTIPLIER);
  }

  /**
   * Update player combo stats
   */
  private updateCombo(playerId: string): { combo: number, isComboExtended: boolean } {
    const stats = this.getPlayerStats(playerId);
    const currentTime = Date.now();
    const isComboExtended = currentTime - stats.lastHitTime <= ScoreManager.SCORING_CONFIG.COMBO_TIMEOUT_MS;
    
    if (isComboExtended) {
      stats.combo++;
    } else {
      stats.combo = 1;
    }
    
    // Update multi-hit tracking
    if (currentTime - stats.lastMultiHitTime <= ScoreManager.SCORING_CONFIG.MULTI_HIT_TIMEOUT_MS) {
      stats.multiHitCount++;
    } else {
      stats.multiHitCount = 1;
    }
    
    stats.lastHitTime = currentTime;
    stats.lastMultiHitTime = currentTime;
    
    return { combo: stats.combo, isComboExtended };
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
        lastMultiHitTime: 0,
        totalDamage: 0,
        highestCombo: 0
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
   * Get highest combo achieved by a player
   */
  public getHighestCombo(playerId: string): number {
    return this.getPlayerStats(playerId).highestCombo;
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
    const stats = this.getPlayerStats(playerId);
    return stats.combo > 1 && 
           (Date.now() - stats.lastHitTime) <= ScoreManager.SCORING_CONFIG.COMBO_TIMEOUT_MS;
  }

  /**
   * Get total damage dealt by a player
   */
  public getTotalDamage(playerId: string): number {
    return this.getPlayerStats(playerId).totalDamage;
  }
} 