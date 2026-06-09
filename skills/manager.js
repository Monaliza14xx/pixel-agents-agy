#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const registryPath = path.join(__dirname, 'registry.json');

// Ensure registry exists
if (!fs.existsSync(registryPath)) {
  fs.writeFileSync(registryPath, '[]', 'utf8');
}

function loadRegistry() {
  try {
    const data = fs.readFileSync(registryPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading registry.json:', err.message);
    return [];
  }
}

function saveRegistry(registry) {
  try {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing registry.json:', err.message);
  }
}

const args = process.argv.slice(2);

if (args.length === 0) {
  console.log(`Usage:
  node manager.js save <name> <description> <language> <code>
  node manager.js search <query>
  node manager.js list
  node manager.js run <name> [args...]`);
  process.exit(1);
}

const command = args[0];

switch (command) {
  case 'save': {
    if (args.length < 5) {
      console.error('Usage: node manager.js save <name> <description> <language> <code>');
      process.exit(1);
    }
    const name = args[1];
    const description = args[2];
    const language = args[3].toLowerCase();
    const code = args[4];

    let ext = '';
    if (['javascript', 'node', 'js'].includes(language)) ext = '.js';
    else if (['python', 'python3', 'py'].includes(language)) ext = '.py';
    else if (['bash', 'sh'].includes(language)) ext = '.sh';
    else {
      console.error('Unsupported language. Use javascript, python, or bash.');
      process.exit(1);
    }

    const filename = `${name}${ext}`;
    const filepath = path.join(__dirname, filename);

    try {
      fs.writeFileSync(filepath, code, 'utf8');
      console.log(`Saved skill code to ${filename}`);
    } catch (err) {
      console.error(`Error saving file ${filename}:`, err.message);
      process.exit(1);
    }

    const registry = loadRegistry();
    const existingIndex = registry.findIndex(s => s.name === name);
    const entry = {
      name,
      description,
      language,
      filepath: filename
    };

    if (existingIndex !== -1) {
      registry[existingIndex] = entry;
      console.log(`Updated existing skill '${name}' in registry.`);
    } else {
      registry.push(entry);
      console.log(`Added new skill '${name}' to registry.`);
    }

    saveRegistry(registry);
    break;
  }
  case 'search': {
    if (args.length < 2) {
      console.error('Usage: node manager.js search <query>');
      process.exit(1);
    }
    const query = args[1].toLowerCase();
    const registry = loadRegistry();
    const matches = registry.filter(s => 
      s.description.toLowerCase().includes(query) || 
      s.name.toLowerCase().includes(query)
    );

    if (matches.length === 0) {
      console.log('No matching skills found.');
    } else {
      console.log('Matching skills:');
      matches.forEach(s => {
        console.log(`- ${s.name} (${s.language}): ${s.description}`);
      });
    }
    break;
  }
  case 'list': {
    const registry = loadRegistry();
    if (registry.length === 0) {
      console.log('No skills in registry.');
    } else {
      console.log('All skills:');
      registry.forEach(s => {
        console.log(`- ${s.name} (${s.language}): ${s.description}`);
      });
    }
    break;
  }
  case 'run': {
    if (args.length < 2) {
      console.error('Usage: node manager.js run <name> [args...]');
      process.exit(1);
    }
    const name = args[1];
    const runArgs = args.slice(2);
    const registry = loadRegistry();
    const skill = registry.find(s => s.name === name);

    if (!skill) {
      console.error(`Skill '${name}' not found in registry.`);
      process.exit(1);
    }

    const filepath = path.join(__dirname, skill.filepath);
    if (!fs.existsSync(filepath)) {
      console.error(`Skill file '${skill.filepath}' not found.`);
      process.exit(1);
    }

    let cmd = '';
    const lang = skill.language.toLowerCase();
    if (['javascript', 'node', 'js'].includes(lang)) cmd = 'node';
    else if (['python', 'python3', 'py'].includes(lang)) cmd = 'python3';
    else if (['bash', 'sh'].includes(lang)) cmd = 'bash';

    if (!cmd) {
      console.error(`Unsupported language '${skill.language}' for execution.`);
      process.exit(1);
    }

    console.log(`Executing ${cmd} ${skill.filepath} ${runArgs.join(' ')}`);
    const result = spawnSync(cmd, [filepath, ...runArgs], { stdio: 'inherit' });
    if (result.error) {
      console.error('Execution error:', result.error.message);
      process.exit(1);
    }
    process.exit(result.status || 0);
    break;
  }
  default: {
    console.error(`Unknown command: ${command}`);
    console.log(`Usage:
  node manager.js save <name> <description> <language> <code>
  node manager.js search <query>
  node manager.js list
  node manager.js run <name> [args...]`);
    process.exit(1);
  }
}
