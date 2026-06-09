# Skill Manager Instructions

You have access to a Skill Library manager which allows you to save, search, and run reusable code snippets ("skills"). This tool helps you automate common tasks or store specific functions.

## Location
The skill manager is located at `skills/manager.js`. It runs using Node.js.

## Available Commands

1. **Save a Skill**
   You can save a new skill or update an existing one.
   ```bash
   node skills/manager.js save <name> "<description>" <language> "<code>"
   ```
   - `<name>`: The unique identifier for the skill (no spaces).
   - `<description>`: A brief description of what the skill does. Enclose in quotes.
   - `<language>`: The programming language of the skill (`javascript`, `python`, or `bash`).
   - `<code>`: The actual code to execute. Enclose in quotes. Be mindful of escaping quotes if necessary.

2. **Search Skills**
   Search for skills by keywords in their name or description.
   ```bash
   node skills/manager.js search "<query>"
   ```

3. **List All Skills**
   View all available skills in the registry.
   ```bash
   node skills/manager.js list
   ```

4. **Run a Skill**
   Execute a saved skill and pass optional arguments to it.
   ```bash
   node skills/manager.js run <name> [arg1] [arg2] ...
   ```
   The manager will automatically use the appropriate interpreter (`node`, `python3`, or `bash`) based on the language.

## Best Practices
- Always check if a skill already exists using `search` or `list` before creating a new one.
- Make descriptions informative so other agents (or yourself in the future) can understand what the skill does.
- Code passed to `save` must be valid for the specified language.
- When saving complex code, double check quote escaping to ensure the code saves properly.
