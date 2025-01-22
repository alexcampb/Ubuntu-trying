import recorder from 'node-record-lpcm16';
import { Buffer } from 'buffer';
import os from 'os';
import fs from 'fs';
import path from 'path';

// WAV file header for 16-bit PCM
function createWavHeader(dataLength) {
  const buffer = Buffer.alloc(44);
  
  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(dataLength + 36, 4);  // File size - 8
  buffer.write('WAVE', 8);
  
  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);  // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);   // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(audioSettings.channels, 22);  // NumChannels
  buffer.writeUInt32LE(audioSettings.sampleRate, 24);  // SampleRate
  buffer.writeUInt32LE(audioSettings.sampleRate * audioSettings.channels * 2, 28);  // ByteRate
  buffer.writeUInt16LE(audioSettings.channels * 2, 32);  // BlockAlign
  buffer.writeUInt16LE(16, 34);  // BitsPerSample
  
  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  
  return buffer;
}

class WavFileWriter {
  constructor(filepath) {
    this.file = fs.createWriteStream(filepath);
    this.bytesWritten = 0;
    // Write placeholder header
    this.file.write(createWavHeader(0));
  }

  write(buffer) {
    this.file.write(buffer);
    this.bytesWritten += buffer.length;
  }

  end() {
    // Seek back to start and write the actual header
    const header = createWavHeader(this.bytesWritten);
    
    // Create a temporary file for the complete WAV
    const tempPath = this.file.path + '.tmp';
    const finalPath = this.file.path;
    
    // Close the current file
    this.file.end();
    
    // Wait for file to close before proceeding
    this.file.on('close', () => {
      // Create new file with correct header
      const writer = fs.createWriteStream(tempPath);
      writer.write(header);
      
      // Append the audio data
      const reader = fs.createReadStream(finalPath, { start: 44 });
      reader.pipe(writer);
      
      writer.on('close', () => {
        // Replace original file with the corrected one
        fs.renameSync(tempPath, finalPath);
      });
    });
  }
}

// Audio settings (copied from audioInput.js)
const audioSettings = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
  device: os.platform() === 'linux' ? 'pulse' : 'default',
  encoding: os.platform() === 'linux' ? 'signed-integer' : undefined,
  format: 'raw',
  agcConfig: {
    enabled: true,
    targetRMS: 0.2,         // 20% target level
    minGain: 1.0,          // Minimum gain
    maxGain: 40.0,         // Much higher maximum gain
    smoothingFactor: 0.7,  // Faster response for testing
    noiseFloor: 0.001,     // Minimum level to consider as signal
    targetMargin: 0.05     // Allow 5% deviation from target
  }
};

class AGCTester {
  constructor() {
    this.currentGain = 1.0;
    this.rmsHistory = new Float32Array(3);  // Shorter history for faster response
    this.rmsIndex = 0;
    this.lastLogTime = 0;
    this.peakLevel = 0.0;
    this.targetLevel = audioSettings.agcConfig.targetRMS;
    
    // Create output directory
    this.outputDir = path.join(process.cwd(), 'agc_test_output');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir);
    }
    
    // Open output files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.rawFile = new WavFileWriter(path.join(this.outputDir, `raw_${timestamp}.wav`));
    this.normalizedFile = new WavFileWriter(path.join(this.outputDir, `normalized_${timestamp}.wav`));
    
    console.log(`Saving audio to: ${this.outputDir}`);
  }

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
    
    // Verify output RMS
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

  applyAGC(buffer) {
    // Save raw audio
    this.rawFile.write(buffer);
    
    const currentRMS = this.calculateRMS(buffer);
    
    // Update RMS history
    this.rmsHistory[this.rmsIndex] = currentRMS;
    this.rmsIndex = (this.rmsIndex + 1) % this.rmsHistory.length;
    
    // Calculate average RMS
    const avgRMS = this.rmsHistory.reduce((a, b) => a + b) / this.rmsHistory.length;
    
    // Normalize buffer to exact target level
    const outputBuffer = this.normalizeBuffer(buffer, avgRMS);
    
    // Save normalized audio
    this.normalizedFile.write(outputBuffer);

    // Calculate actual output level for verification
    const normalizedRMS = this.calculateRMS(outputBuffer);
    
    // Log metrics every 250ms
    const now = Date.now();
    if (!this.lastLogTime || now - this.lastLogTime >= 250) {
      const targetDeviation = Math.abs(normalizedRMS - this.targetLevel);
      
      const width = process.stdout.columns - 40 || 50;
      const scale = width / this.targetLevel;
      
      const inputBar = '█'.repeat(Math.floor(avgRMS * scale));
      const outputBar = '█'.repeat(Math.floor(normalizedRMS * scale));
      const targetBar = '│'.repeat(Math.floor(this.targetLevel * scale));
      
      const micStatus = avgRMS > audioSettings.agcConfig.noiseFloor ? '🎤 Active' : '🎤 No Input';
      const levelStatus = this.peakLevel > 0.1 ? 'Good' : 'Low';
      
      console.clear();
      console.log(`
AGC Test Results:
----------------
Microphone:    ${micStatus} (Peak: ${(this.peakLevel * 100).toFixed(1)}% - ${levelStatus})
Raw Input:     ${inputBar.padEnd(width)} [${(avgRMS * 100).toFixed(1)}%]
Normalized:    ${outputBar.padEnd(width)} [${(normalizedRMS * 100).toFixed(1)}%]
Target Level:  ${targetBar.padEnd(width)} [${(this.targetLevel * 100).toFixed(1)}%]
Scale Factor:  ${(this.targetLevel / avgRMS).toFixed(2)}x

Diagnostics:
-----------
Peak Sample:   ${(this.peakLevel * 100).toFixed(1)}%
Target Error:  ${(targetDeviation * 100).toFixed(6)}%  (should be 0)
Buffer Size:   ${buffer.length} bytes
Input Status:  ${avgRMS < audioSettings.agcConfig.noiseFloor ? 'WARNING: Very low input level' : 
               avgRMS > 0.8 ? 'WARNING: Input too high' : 'OK'}

Saving to:     ${this.outputDir}
               raw_*.wav - Original audio
               normalized_*.wav - Processed audio (fixed at ${(this.targetLevel * 100).toFixed(1)}%)

Controls:
--------
Press Ctrl+C to stop
Speak into your microphone to test AGC
`);
      
      this.lastLogTime = now;
    }
    
    return outputBuffer;
  }

  start() {
    console.log('Starting AGC test...\n');
    console.log('Speak into your microphone at different volumes and distances');
    console.log('Watch the visual indicators to see AGC in action\n');
    console.log(`Saving WAV files to: ${this.outputDir}`);

    const recording = recorder.record(audioSettings);
    
    recording.stream().on('data', (chunk) => {
      this.applyAGC(chunk);
    });

    process.on('SIGINT', () => {
      console.log('\nStopping AGC test...');
      recording.stop();
      this.rawFile.end();
      this.normalizedFile.end();
      console.log('\nWAV files saved. You can play them with:');
      console.log('  - Music app');
      console.log('  - QuickTime Player');
      console.log('  - VLC');
      console.log('  - or any media player that supports WAV files');
      process.exit();
    });
  }
}

// Run the test
const tester = new AGCTester();
tester.start();
