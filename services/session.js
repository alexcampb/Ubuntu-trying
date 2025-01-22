import fetch from 'node-fetch';

/**
 * Handles OpenAI session management
 * 
 * Configuration can be provided via environment variables or constructor:
 * - DEFAULT_LOCATION: Default location for weather (e.g., "San Francisco, CA, USA")
 * - DEFAULT_LANGUAGE: Default language for responses (e.g., "English")
 * - DEFAULT_ROOM: Default room for home control (e.g., "Family Room")
 * 
 * @example
 * const manager = new SessionManager({
 *   defaultLocation: "New York, NY, USA",
 *   defaultLanguage: "Spanish",
 *   defaultRoom: "Living Room"
 * });
 */
export class SessionManager {
  constructor(config = {}) {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('Warning: OPENAI_API_KEY not found in environment variables');
    }
    
    // Default configuration
    this.config = {
      defaultLocation: process.env.DEFAULT_LOCATION || "San Francisco, CA, USA",
      defaultLanguage: process.env.DEFAULT_LANGUAGE || "English",
      defaultRoom: process.env.DEFAULT_ROOM || "Family Room",
      ...config
    };
  }

  async createSession() {
    try {
      const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          temperature: 0.8,
          max_response_output_tokens: 1000,
          modalities: ["audio", "text"],
          voice: "ash",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          turn_detection: {
            type: "server_vad",
            threshold: 0.8,
            silence_duration_ms: 1000,
            prefix_padding_ms: 300,
            create_response: true
          },
          tools: [
            {
              type: "function",
              name: "perform_search",
              description: "Search for real-time information using Perplexity Sonar API. Before calling this function, always inform the user with a message like 'Let me search for that information. This may take a moment...' Use this when you need to find current information or answer questions about recent events.",
              parameters: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "The search query to find information about"
                  },
                  model: {
                    type: "string",
                    enum: ["sonar-pro", "sonar"],
                    description: "The model to use for search. sonar-pro provides more detailed results with multiple searches."
                  }
                },
                required: ["query"]
              }
            },
            {
              type: "function",
              name: "perform_multiple_tasks",
              description: "This tool allows you to check weather information and control home devices. Before calling this function, inform the user with a message like 'I'll check that information for you...' You can combine multiple actions in a single request.",
              parameters: {
                type: "object",
                properties: {
                  weather_requests: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        location: {
                          type: "string",
                          description: "Location to check weather for"
                        },
                        units: {
                          type: "string",
                          enum: ["celsius", "fahrenheit"],
                          description: "Temperature units (defaults to fahrenheit)"
                        }
                      }
                    }
                  },
                  home_requests: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        room: {
                          type: "string",
                          enum: ["Living Room", "Family Room", "Master Bedroom", "Master Bathroom", "Alex"],
                          description: "Room to control. If not specified, defaults to Family Room"
                        },
                        action: {
                          type: "string",
                          enum: [
                            "Lights On",
                            "Lights Off",
                            "Play Music",
                            "Shades Up",
                            "Shades Dn",
                            "Brighten",
                            "Dim",
                            "Chill"
                          ],
                          description: "Action to perform. Note: Shades only available in Alex and Master Bedroom"
                        }
                      },
                      required: ["room", "action"]
                    }
                  }
                }
              }
            },
            {
              type: "function",
              name: "set_continuous_mode",
              description: "Enable or disable continuous conversation mode",
              parameters: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                    description: "Enable or disable continuous mode"
                  }
                },
                required: ["enabled"]
              }
            }
          ],
          instructions: `
Identity: Your name is Jarvis. You are an AI voice realtime voice assistant in my home. You have a warm, friendly voice that makes conversations feel natural and engaging.

Location: We are located in ${this.config.defaultLocation}. The Mic I am speaking to you from is in the ${this.config.defaultRoom} of my house.

Personality: You are not a human but act like one - warm, witty, and helpful. You have deep knowledge across many fields and always strive to provide the most relevant and helpful responses. You're proactive but not pushy, professional when needed, and casual when appropriate.

Language: Your default language is ${this.config.defaultLanguage} but you respond in the language and dialect that you are spoken to in.

Capabilities:
1. Voice Interaction:
   - Wake word: "Hey Jarvis" starts single-request mode
   - Natural back-and-forth in continuous mode
   - You understand context and maintain conversation flow
   - You speak quickly, naturally, and concisely

2. Smart Home Control:
   - Control any room: Living Room, Family Room, Master Bedroom, Master Bathroom, Alex
   - Control lights (on/off, brighten/dim) in any room
   - Control music playback in any room
   - Control shades (only in Alex and Master Bedroom)
   - Set Chill scene in any room
   - If no room is specified, use ${this.config.defaultRoom} as the default

3. Real-time Information:
   - Search for current information using perform_search
   - Get real-time answers about recent events
   - Find up-to-date facts and news
   - Use sonar-pro for detailed research

4. Weather Information:
   - Check weather for any location
   - Get temperature, conditions, humidity, and wind speed
   - Choose between Celsius and Fahrenheit
   - Defaults to Fahrenheit if not specified

5. Continuous Mode:
   - Activated by phrases like:
     * "lets keep talking"
     * "Can we have a conversation"
     * "I don't want to have to keep saying Hey Jarvis"
     * "lets keep our conversation open"
     * "Lets have a chat"
     * "Keep talking with me"

Examples of Natural Interaction:
1. "It's too dark in here"
   → Turn on lights in the current room

2. "What's the weather like in Paris?"
   → Check weather conditions in Paris

3. "Turn on the lights and play music in the living room"
   → Multiple actions in specified room

4. "Open the shades in the master bedroom"
   → Control shades in supported room

Remember to:
- Use ${this.config.defaultRoom} only when no room is specified
- Only control shades in Alex and Master Bedroom
- Maintain natural conversation flow
- Be helpful and friendly
- Confirm actions when appropriate

Limitations:
- You can only perform multiple actions within the "perform_multiple_tasks" tool
- Each tool call can only handle one request per response
- Your knowledge cutoff is October 2023
- Your responses are limited to [tokens]
- You cannot set timers or provide the current time
          `
        })
        
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }
}