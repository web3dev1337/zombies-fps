/**
 * Interface for color information
 */
export interface ColorInfo {
  main: string;
  glow: string;
  intensity: number;
}

/**
 * ColorSystem handles color calculations for damage numbers and UI elements
 */
export class ColorSystem {
  private static readonly COLOR_TIERS = [
    { score: 0, color: '#FFFFFF', glow: '#CCCCCC', intensity: 0.3 },
    { score: 15, color: '#FFFF00', glow: '#CCCC00', intensity: 0.6 },
    { score: 25, color: '#FFA500', glow: '#CC8400', intensity: 0.9 },
    { score: 50, color: '#FF0000', glow: '#CC0000', intensity: 1.2 },
    { score: 150, color: '#FF00FF', glow: '#FFFFFF', intensity: 1.5 }
  ];

  /**
   * Get color information based on score
   */
  public static getScoreColor(score: number): ColorInfo {
    let lower = this.COLOR_TIERS[0];
    let upper = this.COLOR_TIERS[this.COLOR_TIERS.length - 1];
    
    for (let i = 0; i < this.COLOR_TIERS.length - 1; i++) {
      if (score >= this.COLOR_TIERS[i].score && 
          score < this.COLOR_TIERS[i + 1].score) {
        lower = this.COLOR_TIERS[i];
        upper = this.COLOR_TIERS[i + 1];
        break;
      }
    }

    const range = upper.score - lower.score;
    const factor = range <= 0 ? 1 : (score - lower.score) / range;
    
    return {
      main: this.interpolateHex(lower.color, upper.color, factor),
      glow: this.interpolateHex(lower.glow, upper.glow, factor),
      intensity: lower.intensity + (upper.intensity - lower.intensity) * factor
    };
  }

  /**
   * Get color for combo multiplier
   */
  public static getComboColor(combo: number): ColorInfo {
    // Special colors for higher combos
    if (combo >= 10) {
      return { main: '#FF00FF', glow: '#FFFFFF', intensity: 1.8 };
    } else if (combo >= 5) {
      return { main: '#FF0000', glow: '#FFFF00', intensity: 1.5 };
    } else if (combo >= 3) {
      return { main: '#FFA500', glow: '#FFFF00', intensity: 1.2 };
    } else {
      return { main: '#FFFF00', glow: '#FFFFFF', intensity: 0.9 };
    }
  }

  /**
   * Interpolate between two hex colors
   */
  private static interpolateHex(hex1: string, hex2: string, factor: number): string {
    const r1 = parseInt(hex1.slice(1, 3), 16);
    const g1 = parseInt(hex1.slice(3, 5), 16);
    const b1 = parseInt(hex1.slice(5, 7), 16);
    const r2 = parseInt(hex2.slice(1, 3), 16);
    const g2 = parseInt(hex2.slice(3, 5), 16);
    const b2 = parseInt(hex2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);

    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
  }
} 