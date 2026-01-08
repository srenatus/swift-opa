#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Parse CSV content into an array of objects
 * @param {string} csvContent - The CSV content to parse
 * @returns {Array} Array of parsed CSV rows as objects
 */
function parseCSV(csvContent) {
  const lines = csvContent.trim().split('\n');
  
  // Skip the first line (datatype definitions) and use the second line as headers
  const headers = lines[1].split(',');
  const data = [];
  
  // Parse data rows (starting from line 3, index 2)
  for (let i = 2; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    
    data.push(row);
  }
  
  return data;
}

/**
 * Transform CSV data into the target JSON format
 * @param {Array} csvData - Parsed CSV data
 * @returns {Object} Transformed benchmark data
 */
function transformData(csvData) {
  if (csvData.length === 0) {
    throw new Error('No data to process');
  }
  
  // Get common metadata from the first row
  const firstRow = csvData[0];
  const timestamp = new Date(firstRow.time);
  
  // Extract version from environment or use a placeholder
  // In a real GitHub Action, this would come from git rev-parse HEAD
  const version = process.env.GITHUB_SHA || process.env.GIT_COMMIT || 'unknown-commit';
  
  // Extract tags from environment or use default
  const ref = process.env.GITHUB_REF || 'refs/heads/main';
  const tags = [`ref=${ref}`];
  
  // Group data by test name to handle malloc_bytes specially
  const testGroups = {};
  
  csvData.forEach(row => {
    const testName = row.test;
    const metric = row.metric;
    const unit = row.unit;
    const percentile = parseFloat(row.percentile);
    const value = parseFloat(row.value);
    
    if (!testGroups[testName]) {
      testGroups[testName] = {
        mallocBytes: null,
        wallclockEntries: []
      };
    }
    
    if (metric === 'Time(wallclock)' && unit === 'ns') {
      const measure = `wallclock_ns/p${percentile === 0 ? '0' : percentile.toString().replace('.', '_')}`;
      testGroups[testName].wallclockEntries.push({
        Name: testName,
        Measure: measure,
        Value: value
      });
    } else if (metric === 'Malloc(total)' && percentile === 50.0) {
      // Only record malloc_bytes for p50 (median)
      testGroups[testName].mallocBytes = {
        Name: testName,
        Measure: 'malloc_bytes',
        Value: value
      };
    }
  });
  
  // Create benchmarks array
  const benchmarks = [];
  
  Object.keys(testGroups).forEach(testName => {
    const test = testGroups[testName];
    
    // Add malloc_bytes entry if available
    if (test.mallocBytes) {
      benchmarks.push(test.mallocBytes);
    }
    
    // Add all wallclock entries
    benchmarks.push(...test.wallclockEntries);
  });
  
  // Create the final structure without Suites wrapper
  const result = {
    Version: version,
    Date: timestamp.getTime(), // Timestamp in milliseconds
    Tags: tags,
    Benchmarks: benchmarks
  };
  
  return result;
}

/**
 * Read existing benchmarks.json file or create empty array
 * @param {string} filePath - Path to benchmarks.json
 * @returns {Array} Existing benchmark data
 */
function readExistingBenchmarks(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.warn(`Warning: Could not read existing ${filePath}: ${error.message}`);
  }
  
  return [];
}

/**
 * Write benchmarks data to file
 * @param {string} filePath - Path to benchmarks.json
 * @param {Array} data - Benchmark data array
 */
function writeBenchmarks(filePath, data) {
  const dir = path.dirname(filePath);
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(filePath, JSON.stringify(data));
}

/**
 * Main function
 */
function main() {
  const csvFilePath = process.argv[2] || 'Benchmarks/Current_run.influx.csv';
  const jsonFilePath = process.argv[3] || 'benchmarks.json';
  
  console.log(`Processing CSV file: ${csvFilePath}`);
  console.log(`Output JSON file: ${jsonFilePath}`);
  
  try {
    // Read and parse CSV file
    const csvContent = fs.readFileSync(csvFilePath, 'utf8');
    const csvData = parseCSV(csvContent);
    
    console.log(`Parsed ${csvData.length} CSV rows`);
    
    // Transform data
    const newBenchmarkData = transformData(csvData);
    console.log(`Transformed data for ${newBenchmarkData.Benchmarks.length} benchmarks`);
    
    // Read existing benchmarks
    const existingData = readExistingBenchmarks(jsonFilePath);
    console.log(`Found ${existingData.length} existing benchmark entries`);
    
    // Append new data
    existingData.push(newBenchmarkData);
    
    // Write updated data
    writeBenchmarks(jsonFilePath, existingData);
    
    console.log(`Successfully appended benchmark data to ${jsonFilePath}`);
    console.log(`Total entries: ${existingData.length}`);
    
  } catch (error) {
    console.error('Error processing benchmarks:', error.message);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

module.exports = {
  parseCSV,
  transformData,
  readExistingBenchmarks,
  writeBenchmarks
};