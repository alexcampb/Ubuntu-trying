import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Handles search and chat completions using Perplexity Sonar API
 * @see {@link https://docs.perplexity.ai} Perplexity API Documentation
 */
export class SearchAPI {
  /**
   * Creates a new SearchAPI instance
   */
  constructor() {
    /**
     * Perplexity API key
     * @type {string}
     */
    this.apiKey = process.env.PERPLEXITY_API_KEY;
    if (!this.apiKey) {
      console.warn('Warning: PERPLEXITY_API_KEY not found in environment variables');
    }

    /**
     * Default system prompt for search queries
     * @type {string}
     */
    this.defaultSystemPrompt = `You are Jarvis, an AI assistant providing real-time information. Follow these guidelines:

1. Accuracy: Provide current, factual information with relevant citations
2. Conciseness: Be clear and direct, avoiding unnecessary details
3. Structure: Present information in a logical, easy-to-follow format
7. Relevance: Focus on the most pertinent information to the query

Maintain a natural, conversational tone while ensuring accuracy and clarity.`;
  }

  /**
   * Performs a search query using Perplexity Sonar API
   * @param {Object} params - Search query parameters
   * @param {string} params.query - Search query text
   * @param {string} [params.model='sonar-pro'] - Model to use (sonar-pro or sonar)
   * @param {string} [params.systemPrompt] - Optional system prompt to guide the response
   * @returns {Promise<Object>} Search results including response and citations
   * @throws {Error} If the API request fails
   */
  async performSearch(params) {
    const { 
      query, 
      model = 'sonar-pro',
      systemPrompt = this.defaultSystemPrompt
    } = params;

    try {
      const url = 'https://api.perplexity.ai/chat/completions';
      const requestBody = {
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: query
          }
        ]
      };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Search API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        success: true,
        content: data.choices[0]?.message?.content || '',
        model: data.model
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
