/**
 * Real-time Chat Application with OpenAI Integration
 *
 * This file focuses on chat logic, WebSocket management,
 * handling incoming messages, etc.
 * Audio tasks go to AudioHandler (see audioHandler.js).
 * Function call handling goes to FunctionHandler (see functionHandler.js).
 */

import dotenv from 'dotenv';
import WebSocket from 'ws';
import fetch from 'node-fetch';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { PushoverAPI } from './functions/pushover.js';
import { WeatherAPI } from './functions/weather.js';
import { SessionManager } from './services/session.js';

// Import our AudioHandler
import { AudioHandler } from './services/audioHandler.js';  // Changed to use new modular version
// Import our new FunctionHandler
import { FunctionHandler } from './functionHandler.js';

dotenv.config();

/**
 * Manages the console-based chat interface and handles real-time communication
 * with OpenAI's API. Delegates audio tasks to AudioHandler and
 * function calls to FunctionHandler.
 */
class ConsoleChat {
  constructor() {
    // Weather API and home-control API
    this.weatherAPI = new WeatherAPI();
    this.pushoverAPI = new PushoverAPI();
    this.sessionManager = new SessionManager();

    // Chat-related states
    this.ws = null;
    this.isWaitingForResponse = false;
    this.responseId = null;
    this.currentFunctionArgs = '';
    this.currentConversationId = null;
    this.currentUserTranscript = '';
    this.currentAssistantTranscript = '';

    // Initialize the AudioHandler, passing this instance
    this.audioHandler = new AudioHandler(this);

    // Initialize the FunctionHandler, also passing this instance
    this.functionHandler = new FunctionHandler(this);

    // Create transcripts directory if it doesn't exist
    const transcriptsDir = path.join(process.cwd(), 'transcripts');
    if (!fs.existsSync(transcriptsDir)) {
      fs.mkdirSync(transcriptsDir);
    }

    // Use a single transcript file
    this.transcriptFile = path.join(transcriptsDir, 'conversation_history.txt');

    // Add a session separator when starting a new session
    const sessionStart = `\n${'-'.repeat(50)}\n[${new Date().toISOString()}] New Session Started\n${'-'.repeat(50)}\n`;
    fs.appendFileSync(this.transcriptFile, sessionStart);
  }

  // Add function to log transcripts
  logTranscript(role, text) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${role}: ${text}\n`;
    fs.appendFileSync(this.transcriptFile, entry);
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('\n[WebSocket] Received message type:', message.type);

      switch (message.type) {
        case 'session.created':
          console.log('Session created successfully');
          break;

        case 'session.updated':
          console.log('Session updated successfully');
          break;

        case 'input_audio_buffer.speech_started':
          console.log('\nSpeech detected');
          this.audioHandler.isProcessingAudio = true;
          this.audioHandler.speechDetected = true;
          break;

        case 'input_audio_buffer.speech_stopped':
          console.log('\nSpeech ended');
          if (this.audioHandler.pendingStopRecording) {
            this.audioHandler.finishRecording();
          }
          break;

        case 'conversation.item.created':
          if (message.item?.content?.[0]?.text &&
              !this.currentUserTranscript?.includes(message.item.content[0].text)) {
            this.currentUserTranscript = message.item.content[0].text;
            console.log('\nTranscribed input:', this.currentUserTranscript);
            // Log user input
            this.logTranscript('User', this.currentUserTranscript);
            if (message.conversation_id) {
              this.currentConversationId = message.conversation_id;
            }
          } else if (message.item?.type === 'audio') {
            console.log('\nReceived audio response');
          } else if (message.item?.type === 'function_call_output') {
            console.log('\nFunction call output received, waiting for assistant response...');
            this.isWaitingForResponse = true;
            this.responseId = null;
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          console.log('Input transcription message:', JSON.stringify(message, null, 2));
          if (message.transcript && !this.currentUserTranscript?.includes(message.transcript)) {
            this.currentUserTranscript = message.transcript;
            console.log('\nUser transcript:', this.currentUserTranscript);
            this.logTranscript('User', this.currentUserTranscript);
          }
          break;

        case 'response.created':
          console.log('\nAssistant is responding...');
          this.isWaitingForResponse = true;
          this.responseId = message.response_id;
          break;

        case 'response.text.delta':
          if (message.text) {
            console.log('[Response] Text delta:', message.text);
            process.stdout.write(message.text);
          }
          break;

        case 'response.audio.delta':
          if (message.delta) {
            console.log('[Response] Processing audio chunk');
            try {
              const audioBuffer = Buffer.from(message.delta, 'base64');
              this.audioHandler.audioOutput.audioQueue.push(audioBuffer);
              if (!this.audioHandler.audioOutput.isPlaying) {
                this.audioHandler.audioOutput.processAudioQueue();
              }
            } catch (error) {
              console.error('Error processing audio:', error);
            }
          }
          break;

        case 'response.audio_transcript.delta':
          if (message.delta) {
            this.currentAssistantTranscript = (this.currentAssistantTranscript || '') + message.delta;
          }
          break;

        case 'response.audio_transcript.done':
          if (this.currentAssistantTranscript) {
            console.log('\nAssistant transcript:', this.currentAssistantTranscript);
            this.logTranscript('Assistant', this.currentAssistantTranscript);
            this.currentAssistantTranscript = '';
          }
          break;

        case 'response.done':
          if (this.responseId === message.response_id) {
            console.log('\n--- Response complete ---');
            this.isWaitingForResponse = false;
            this.responseId = null;
            
            // If in continuous mode and speaker is not playing, start recording
            if (this.audioHandler.continuousMode && !this.audioHandler.audioOutput.isPlaying) {
              this.audioHandler.audioInput.startRecording();
            }
          }
          break;

        case 'conversation.done':
          if (this.currentConversationId === message.conversation_id) {
            this.currentConversationId = null;
            this.currentUserTranscript = '';
            this.audioHandler.isProcessingAudio = false;
          }
          break;

        case 'response.content_part.added':
          if (message.content_part?.content?.text) {
            console.log('\nAssistant:', message.content_part.content.text);
            this.logTranscript('Assistant', message.content_part.content.text);
          }
          break;

        case 'response.output_item.added':
          if (message.output_item?.content_part?.content?.text) {
            console.log('\nAssistant:', message.output_item.content_part.content.text);
            this.logTranscript('Assistant', message.output_item.content_part.content.text);
          }
          break;

        case 'response.function_call_arguments.delta':
          this.currentFunctionArgs = (this.currentFunctionArgs || '') + message.delta;
          console.log('[Function Call] Accumulating arguments:', this.currentFunctionArgs);
          break;

        case 'response.function_call_arguments.done':
          console.log('\n[Function Call] Complete. Full arguments:', this.currentFunctionArgs);
          console.log('[Function Call] Full message:', JSON.stringify(message, null, 2));
          try {
            const parsedArgs = JSON.parse(this.currentFunctionArgs);
            console.log('[Function Call] Parsed arguments:', JSON.stringify(parsedArgs, null, 2));
            parsedArgs._call_id = message.call_id;

            // Delegate to FunctionHandler
            this.functionHandler.handleFunctionCall(message.name, parsedArgs);
          } catch (error) {
            console.error('[Function Call] Error parsing arguments:', error.message);
          }
          this.currentFunctionArgs = '';
          break;

        case 'error':
          if (message.error && !message.error.message.includes('buffer too small')) {
            console.error('\nError:', message.error?.message || 'Unknown error');
          }
          break;
      }
    } catch (error) {
      console.error('[Message Handler] Error:', error.message);
    }
  }

  cleanup() {
    // Delegate audio cleanup
    this.audioHandler.cleanup();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async start() {
    try {
      console.log('\n🎤 Initializing voice assistant...');
      console.log('Starting wake word detection system, please wait...');
      
      console.log('\nWhen wake word detection is ready, you can say:');
      console.log('- "Hey Jarvis" to start talking');
      console.log('\nPress Ctrl+C to exit\n');

      // Initialize audio handler first
      await this.audioHandler.initialize();

      // Create single session
      if (!this.ws) {
        console.log('Creating session...');
        const session = await this.sessionManager.createSession();
        console.log('Session created successfully:', JSON.stringify(session, null, 2));

        // Initialize WebSocket with the session
        await this.initializeWebSocket(session);
      }

    } catch (error) {
      console.error('Initialization error:', error);
      process.exit(1);
    }
  }

  async initializeWebSocket(session) {
    if (this.ws) {
      console.log('WebSocket already initialized');
      return;
    }

    try {
      // Connect to WebSocket
      this.ws = new WebSocket('wss://api.openai.com/v1/realtime', {
        headers: {
          'Authorization': `Bearer ${session.client_secret.value}`,
          'openai-beta': 'realtime=v1'
        }
      });

      this.ws.on('open', () => {
        console.log('\nConnected to OpenAI');
        
        // Send input_audio_transcription configuration
        this.ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            input_audio_transcription: {
              model: 'whisper-1'
            }
          }
        }));
        
        console.log('Press R to start/stop recording');
        console.log('Press X to toggle continuous conversation mode');
        console.log('Press I to interrupt playback');
        console.log('Press Q to quit\n');
      });

      this.ws.on('message', (data) => {
        try {
          this.handleMessage(data);
        } catch (err) {
          console.error('Error handling message:', err.message);
        }
      });

      this.ws.on('error', (error) => {
        console.error('\nWebSocket error:', error.message);
      });

      this.ws.on('close', async (code, reason) => {
        const reasonStr = reason ? reason.toString() : '';
        console.log('\nConnection closed:', code, reasonStr);
        
        // Clear existing WebSocket
        this.ws = null;
        
        // Handle session timeout specifically
        if (code === 1001 && reasonStr.includes('maximum duration')) {
          console.log('Session timed out, creating new session...');
          try {
            // Create completely new session
            const newSession = await this.sessionManager.createSession();
            await this.initializeWebSocket(newSession);
          } catch (err) {
            console.error('Failed to create new session:', err);
            process.exit(1);
          }
        } else if (code !== 1000) {  // Handle other non-normal closures
          console.log('Connection lost, attempting to reconnect...');
          try {
            // Reuse existing session for other types of disconnects
            await this.initializeWebSocket(session);
          } catch (err) {
            console.error('Failed to reconnect:', err);
            // Try again in 1 second
            setTimeout(async () => {
              try {
                await this.initializeWebSocket(session);
              } catch (retryErr) {
                console.error('Reconnection retry failed:', retryErr);
                process.exit(1);
              }
            }, 1000);
          }
        }
      });

      // Route keyboard input to the audio handler
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (key) => this.audioHandler.handleKeyPress(key));

    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }
}

// Start the chat application
const chat = new ConsoleChat();
chat.start().catch(console.error);
