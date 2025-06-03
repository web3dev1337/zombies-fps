import { Audio, World } from 'hytopia';

export default class GameAudioManager {
  private static readonly MAX_CONCURRENT_SOUNDS = 32;
  private static _activeSounds = 0;
  private static _soundQueue: Array<{audio: Audio, world: World, force: boolean}> = [];
  private static readonly QUEUE_CHECK_INTERVAL = 100; // ms
  private static _queueTimer: NodeJS.Timeout | null = null;
  private static _isInitialized = false;

  private static _processQueue() {
    // Process queued sounds if we have capacity
    while (this._soundQueue.length > 0 && this._activeSounds < this.MAX_CONCURRENT_SOUNDS) {
      const nextSound = this._soundQueue.shift();
      if (nextSound) {
        this._playSound(nextSound.audio, nextSound.world, nextSound.force);
      }
    }

    // Schedule next queue check only if we have queued sounds
    if (this._soundQueue.length > 0) {
      this._queueTimer = setTimeout(() => this._processQueue(), this.QUEUE_CHECK_INTERVAL);
    } else {
      this._queueTimer = null;
    }
  }

  private static _playSound(audio: Audio, world: World, force: boolean = false) {
    if (!force && this._activeSounds >= this.MAX_CONCURRENT_SOUNDS) {
      // Queue the sound if we're at capacity
      this._soundQueue.push({ audio, world, force });
      
      // Start queue processing if not already running
      if (!this._queueTimer) {
        this._queueTimer = setTimeout(() => this._processQueue(), this.QUEUE_CHECK_INTERVAL);
      }
      return;
    }

    this._activeSounds++;
    audio.play(world, true);

    // Estimate sound duration (or use a default if not available)
    const duration = audio.duration || 1000;
    
    // Decrease count after estimated duration
    setTimeout(() => {
      this._activeSounds = Math.max(0, this._activeSounds - 1);
    }, duration);
  }

  public static playSound(audio: Audio, world: World, force: boolean = false): void {
    this._playSound(audio, world, force);
  }

  public static getActiveSoundCount(): number {
    return this._activeSounds;
  }

  public static init() {
    // Only initialize once
    if (this._isInitialized) {
      return;
    }
    this._isInitialized = true;
  }

  // Priority sound that will always play, even if at capacity
  public static playPrioritySound(audio: Audio, world: World): void {
    this._playSound(audio, world, true);
  }

  // Clear all queued sounds
  public static clearQueue(): void {
    this._soundQueue = [];
    if (this._queueTimer) {
      clearTimeout(this._queueTimer);
      this._queueTimer = null;
    }
  }

  // Reset the manager state
  public static reset(): void {
    this.clearQueue();
    this._activeSounds = 0;
    this._isInitialized = false;
  }
} 