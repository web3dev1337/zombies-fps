/**
 * Interface for color information
 */
export interface ColorInfo {
  main: string;
  glow: string;
  intensity: number;
  scale?: number;
}

/**
 * ColorSystem handles color calculations for damage numbers and UI elements
 */
export class ColorSystem {
  private static readonly COLOR_TIERS = [
    { score: 0, color: '#FFFFFF', glow: '#CCCCCC', intensity: 0.3, scale: 1.0 },
    { score: 15, color: '#FFFF00', glow: '#FFCC00', intensity: 0.6, scale: 1.1 },
    { score: 25, color: '#FFA500', glow: '#FF8C00', intensity: 0.9, scale: 1.2 },
    { score: 50, color: '#FF0000', glow: '#CC0000', intensity: 1.2, scale: 1.3 },
    { score: 100, color: '#FF00FF', glow: '#CC00CC', intensity: 1.5, scale: 1.4 },
    { score: 150, color: '#00FFFF', glow: '#00CCCC', intensity: 1.8, scale: 1.5 },
    { score: 200, color: '#FFFFFF', glow: '#FFFF00', intensity: 2.0, scale: 1.6 }
  ];

  private static readonly COMBO_TIERS = [
    { combo: 0, color: '#FFFFFF', glow: '#CCCCCC', intensity: 0.3 },
    { combo: 3, color: '#FFFF00', glow: '#FFCC00', intensity: 0.6 },
    { combo: 5, color: '#FFA500', glow: '#FF8C00', intensity: 0.9 },
    { combo: 8, color: '#FF0000', glow: '#CC0000', intensity: 1.2 },
    { combo: 10, color: '#FF00FF', glow: '#CC00CC', intensity: 1.5 },
    { combo: 15, color: '#00FFFF', glow: '#00CCCC', intensity: 1.8 },
    { combo: 20, color: '#FFFFFF', glow: '#FFFF00', intensity: 2.0 }
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
      intensity: this.interpolateValue(lower.intensity, upper.intensity, factor),
      scale: this.interpolateValue(lower.scale || 1.0, upper.scale || 1.0, factor)
    };
  }

  /**
   * Get color for combo multiplier with enhanced visual feedback
   */
  public static getComboColor(combo: number): ColorInfo {
    let lower = this.COMBO_TIERS[0];
    let upper = this.COMBO_TIERS[this.COMBO_TIERS.length - 1];
    
    for (let i = 0; i < this.COMBO_TIERS.length - 1; i++) {
      if (combo >= this.COMBO_TIERS[i].combo && 
          combo < this.COMBO_TIERS[i + 1].combo) {
        lower = this.COMBO_TIERS[i];
        upper = this.COMBO_TIERS[i + 1];
        break;
      }
    }

    const range = upper.combo - lower.combo;
    const factor = range <= 0 ? 1 : (combo - lower.combo) / range;
    
    return {
      main: this.interpolateHex(lower.color, upper.color, factor),
      glow: this.interpolateHex(lower.glow, upper.glow, factor),
      intensity: this.interpolateValue(lower.intensity, upper.intensity, factor)
    };
  }

  /**
   * Interpolate between two hex colors with improved accuracy
   */
  private static interpolateHex(hex1: string, hex2: string, factor: number): string {
    const r1 = parseInt(hex1.slice(1, 3), 16);
    const g1 = parseInt(hex1.slice(3, 5), 16);
    const b1 = parseInt(hex1.slice(5, 7), 16);
    const r2 = parseInt(hex2.slice(1, 3), 16);
    const g2 = parseInt(hex2.slice(3, 5), 16);
    const b2 = parseInt(hex2.slice(5, 7), 16);

    const r = Math.round(this.interpolateValue(r1, r2, factor));
    const g = Math.round(this.interpolateValue(g1, g2, factor));
    const b = Math.round(this.interpolateValue(b1, b2, factor));

    return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, '0')}`;
  }

  /**
   * Interpolate between two numeric values with easing
   */
  private static interpolateValue(start: number, end: number, factor: number): number {
    // Add slight easing for smoother transitions
    const easedFactor = factor < 0.5
      ? 2 * factor * factor
      : 1 - Math.pow(-2 * factor + 2, 2) / 2;
    
    return start + (end - start) * easedFactor;
  }
} 