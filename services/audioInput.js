import os from 'os';
import { Buffer } from 'buffer';
import recorder from 'node-record-lpcm16';
import { spawn } from 'child_process';

// Platform-specific audio settings
export const audioSettings = {
  sampleRate: 16000,  // OpenAI expects 16kHz
  channels: 1,
  bitDepth: 16,
  device: os.platform() === 'linux' ? 'pulse' : 'default',
  encoding: os.platform() === 'linux' ? 'signed-integer' : undefined,
  format: 'raw',
  agcConfig: {
    enabled: true,
    targetRMS: 0.2,         // Target RMS level (20%)
    noiseFloor: 0.001      // Minimum level to consider as signal
  }
};

/**
 * Handles audio input functionality including recording and wake word detection
 */
export class AudioInput {
  constructor(handler) {
    this.handler = handler;
    
    // Recording states
    this.recording = null;
    this.audioBuffer = Buffer.alloc(0);
    this.speechDetected = false;
    this.pendingStopRecording = false;
    
    // Wake word detection
    this.wakeWordProcess = null;
    this.wakeWordRecorder = null;
    this.isListeningForWakeWord = false;
    this.lastDetectionTime = 0;
    this.detectionCooldown = 2000; // 2 seconds cooldown
    this.isWakeWordReady = false;

    // AGC state
    this.targetLevel = audioSettings.agcConfig.targetRMS;
    this.rmsHistory = new Float32Array(3);  // Short history for faster response
    this.rmsIndex = 0;
    this.peakLevel = 0;
    this.lastLogTime = null; // Added for diagnostic logging
  }

  /**
   * Initialize wake word detection using OpenWakeWord
   */
  async initialize() {
    try {
      console.log('Initializing wake word detection...');

      // Start the Python process
      this.wakeWordProcess = spawn('python3', ['openwakeword_detector.py'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Handle process output
      this.wakeWordProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        
        // Check for wake word detection
        if (output.includes('DETECTED!')) {
          // Extract score from the output
          const scoreMatch = output.match(/Score: (\d+\.\d+)/);
          const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
          
          if (score > 0.5) {  // Threshold for detection
            const now = Date.now();
            // Only trigger if enough time has passed since last detection
            if (now - this.lastDetectionTime > this.detectionCooldown) {
              console.log('\nWake word detected!');
              this.lastDetectionTime = now;
              this.handleWakeWord();
            }
          }
        }
      });

      // Handle errors
      this.wakeWordProcess.stderr.on('data', (data) => {
        const error = data.toString();
        // Only log serious errors, ignore routine messages
        if (!error.includes('Downloading') && !error.includes('Initializing') && !error.includes('Listening')) {
          console.error('Wake word detector error:', error);
        }
      });

      this.wakeWordProcess.on('close', (code) => {
        console.log('Wake word detector process ended with code:', code);
        // Attempt to restart if not intentionally closed
        if (!this.handler.isCleaningUp) {
          setTimeout(() => this.initialize(), 1000);
        }
      });

      // Add error handler
      this.wakeWordProcess.on('error', (err) => {
        console.error('Failed to start wake word detector:', err);
        if (!this.handler.isCleaningUp) {
          setTimeout(() => this.initialize(), 1000);
        }
      });

      this.isWakeWordReady = true;
      console.log('Wake word detection initialized');
    } catch (error) {
      console.error('Error initializing wake word detection:', error);
      // Attempt to restart
      if (!this.handler.isCleaningUp) {
        setTimeout(() => this.initialize(), 1000);
      }
      throw error;
    }
  }

  /**
   * Handle wake word detection
   * @private
   */
  handleWakeWord() {
    console.log(' Detected: "Hey Jarvis"');
    if (!this.recording && !this.handler.isPlaying && !this.handler.chat.isWaitingForResponse) {
      console.log('Action: Starting recording (single request)');
      this.startRecording();
    }
  }

  /**
   * Start recording audio
   */
  startRecording() {
    // Don't start recording if speaker is playing or we're processing a function
    if (this.handler.audioOutput.isPlaying || this.handler.chat.isWaitingForResponse) {
      console.log('\nCannot start recording while speaker is playing or processing a function');
      return;
    }

    if (this.recording) return;
    
    this.isListeningForWakeWord = false;
    this.speechDetected = false;
    this.pendingStopRecording = false;

    try {
      this.recording = recorder.record(audioSettings);
      console.log('Recording started with settings:', audioSettings);

      this.audioBuffer = Buffer.alloc(0);
      this.recording.stream().on('error', (err) => {
        console.error('Recording error:', err.message);
        if (this.recording) {
          this.recording.stop();
          this.recording = null;
        }
        this.audioBuffer = Buffer.alloc(0);
      });

      this.recording.stream().on('data', (chunk) => {
        if (this.handler.chat.ws && this.handler.chat.ws.readyState === 1) {
          // Calculate input level
          const inputRMS = this.calculateRMS(chunk);
          
          // Store original chunk for comparison
          const originalChunk = Buffer.from(chunk);
          
          // Apply automatic gain control
          const normalizedChunk = audioSettings.agcConfig.enabled ? 
            this.applyAGC(chunk) : chunk;
          
          // Verify output level
          const outputRMS = this.calculateRMS(normalizedChunk);
          
          // Verify chunks are different (normalization happened)
          const isDifferent = Buffer.compare(originalChunk, normalizedChunk) !== 0;
          
          // Log levels every second (avoid console spam)
          const now = Date.now();
          if (!this.lastLogTime || now - this.lastLogTime >= 1000) {
            console.log(`
Audio Pipeline Status:
---------------------
Input Level:     ${(inputRMS * 100).toFixed(1)}%
Output Level:    ${(outputRMS * 100).toFixed(1)}%
Target Level:    ${(this.targetLevel * 100).toFixed(1)}%
AGC Enabled:     ${audioSettings.agcConfig.enabled}
Normalized:      ${isDifferent ? 'Yes ' : 'No !'}
Buffer Size:     ${chunk.length} bytes
Sending Status:  ${this.handler.chat.ws.readyState === 1 ? 'Connected ' : 'Not Connected !'}
`);
            this.lastLogTime = now;
          }
            
          // Add normalized audio to buffer
          this.audioBuffer = Buffer.concat([this.audioBuffer, normalizedChunk]);
          
          // When buffer is full, send to server
          if (this.audioBuffer.length >= audioSettings.sampleRate) {
            // Verify final buffer is normalized
            const finalRMS = this.calculateRMS(this.audioBuffer);
            const isNormalized = Math.abs(finalRMS - this.targetLevel) <= 0.01;
            
            if (!isNormalized) {
              console.warn(`Warning: Audio buffer not properly normalized! Level: ${(finalRMS * 100).toFixed(1)}% vs Target: ${(this.targetLevel * 100).toFixed(1)}%`);
            }
            
            // Send to server
            this.handler.chat.ws.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: this.audioBuffer.toString('base64')
            }));
            
            this.audioBuffer = Buffer.alloc(0);
          }
        }
      });

      console.log('Receiving audio data from microphone');
    } catch (err) {
      console.error('Error starting recording:', err.message);
      if (os.platform() === 'linux') {
        console.error('On Linux, make sure you have ALSA and PulseAudio installed:');
        console.error('sudo apt-get install libasound2-dev pulseaudio');
      }
      if (this.recording) {
        this.recording.stop();
        this.recording = null;
      }
      this.audioBuffer = Buffer.alloc(0);
    }
  }

  /**
   * Stop recording audio
   */
  stopRecording() {
    if (!this.recording) return;
    
    this.pendingStopRecording = true;
    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }

    if (!this.handler.continuousMode) {
      this.isListeningForWakeWord = true;
    }
  }

  /**
   * Finalize recording and send the last audio
   */
  finishRecording() {
    if (!this.recording) return;

    console.log('\nStopped recording');

    if (this.handler.chat.ws && this.handler.chat.ws.readyState === 1 && this.audioBuffer.length > 0) {
      try {
        this.handler.chat.ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: this.audioBuffer.toString('base64')
        }));
        this.handler.chat.ws.send(JSON.stringify({
          type: 'input_audio_buffer.commit'
        }));
        console.log('Audio committed to server');
      } catch (err) {
        console.error('Error sending final audio:', err.message);
      }
    }

    this.recording.stop();
    this.recording = null;
    this.audioBuffer = Buffer.alloc(0);
    this.pendingStopRecording = false;
    this.speechDetected = false;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.wakeWordProcess) {
      this.wakeWordProcess.kill();
      this.wakeWordProcess = null;
    }

    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }

    this.isListeningForWakeWord = true;
  }

  /**
   * Calculate RMS (Root Mean Square) value of audio buffer
   * @private
   * @param {Buffer} buffer - Input audio buffer
   * @returns {number} RMS value between 0.0 and 1.0
   */
  calculateRMS(buffer) {
    let sumSquares = 0;
    let peak = 0;
    const samples = buffer.length / 2; // 16-bit samples
    
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i) / 32768.0; // Convert to -1 to 1 range
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    
    this.peakLevel = Math.max(peak, this.peakLevel * 0.95);
    return Math.sqrt(sumSquares / samples);
  }

  /**
   * Normalize audio buffer to exact target level
   * @private
   * @param {Buffer} buffer - Input audio buffer
   * @param {number} inputRMS - Current RMS level
   * @returns {Buffer} Normalized audio buffer
   */
  normalizeBuffer(buffer, inputRMS) {
    // If input is too low, return silence
    if (inputRMS <= audioSettings.agcConfig.noiseFloor) {
      return Buffer.alloc(buffer.length);
    }

    const outputBuffer = Buffer.alloc(buffer.length);
    
    // Calculate exact scaling needed to reach target
    const scaleFactor = this.targetLevel / inputRMS;
    
    // Apply scaling to each sample
    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i) / 32768.0; // Convert to -1 to 1
      const normalized = sample * scaleFactor; // Scale to target
      // Convert back to 16-bit and clamp
      const intSample = Math.max(-32768, Math.min(32767, 
        Math.round(normalized * 32768)));
      outputBuffer.writeInt16LE(intSample, i);
    }
    
    // Verify output RMS and apply correction if needed
    const outputRMS = this.calculateRMS(outputBuffer);
    if (Math.abs(outputRMS - this.targetLevel) > 0.0001) {
      // Apply fine adjustment if needed
      const correction = this.targetLevel / outputRMS;
      for (let i = 0; i < buffer.length; i += 2) {
        const sample = outputBuffer.readInt16LE(i);
        const corrected = Math.max(-32768, Math.min(32767,
          Math.round(sample * correction)));
        outputBuffer.writeInt16LE(corrected, i);
      }
    }
    
    return outputBuffer;
  }

  /**
   * Apply Automatic Gain Control to audio buffer
   * @private
   * @param {Buffer} buffer - Input audio buffer
   * @returns {Buffer} Normalized audio buffer
   */
  applyAGC(buffer) {
    const currentRMS = this.calculateRMS(buffer);
    
    // Update RMS history
    this.rmsHistory[this.rmsIndex] = currentRMS;
    this.rmsIndex = (this.rmsIndex + 1) % this.rmsHistory.length;
    
    // Calculate average RMS
    const avgRMS = this.rmsHistory.reduce((a, b) => a + b) / this.rmsHistory.length;
    
    // Normalize buffer to exact target level
    return this.normalizeBuffer(buffer, avgRMS);
  }
}
