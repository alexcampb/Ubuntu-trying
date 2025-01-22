import { SearchAPI } from './functions/search.js';

async function testSearch() {
  const searchAPI = new SearchAPI();
  
  try {
    console.log('Testing Perplexity Sonar search...');
    
    const result = await searchAPI.performSearch({
      query: 'What are the latest developments in quantum computing?',
      model: 'sonar-pro'
    });
    
    console.log('\nSearch Results:');
    console.log('Success:', result.success);
    console.log('\nResponse:', result.response);
    console.log('\nUsage:', result.usage);
    console.log('\nModel:', result.model);
  } catch (error) {
    console.error('Error testing search:', error);
  }
}

testSearch();
