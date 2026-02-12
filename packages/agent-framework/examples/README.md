# Agent Framework Examples

This directory contains examples demonstrating the @antimatter/agent-framework package.

## Examples

### 1. Simple Example (Mock Provider)

Demonstrates basic functionality without requiring an API key:

```bash
npx tsx examples/simple-example.ts
```

**Features demonstrated:**
- Creating agents with mock provider
- Simple conversations
- Working memory
- Tool execution
- Role-based agents
- Usage statistics

### 2. Claude Example (Real API)

Demonstrates real Claude API integration:

```bash
# Set your API key first
export ANTHROPIC_API_KEY=your-key-here  # Linux/Mac
set ANTHROPIC_API_KEY=your-key-here     # Windows

# Run the example
npx tsx examples/claude-example.ts
```

**Features demonstrated:**
- Real Claude API calls
- Token usage tracking
- Multi-turn conversations
- Role-based prompts
- Configuration options

## Prerequisites

- Node.js 18+
- pnpm (for workspace dependencies)
- Anthropic API key (for claude-example.ts only)

## Getting an API Key

To run the Claude example:

1. Sign up at https://console.anthropic.com/
2. Create an API key
3. Set it as an environment variable

## Running Examples

From the workspace root:

```bash
# Install dependencies
pnpm install

# Run simple example (no API key needed)
cd packages/ai-agent
npx tsx examples/simple-example.ts

# Run Claude example (API key required)
export ANTHROPIC_API_KEY=your-key-here
npx tsx examples/claude-example.ts
```

## Example Output

### Simple Example
```
🤖 Agent Framework Example
==================================================

📝 Example 1: Simple Conversation

User: Hello
Agent: Hi there! I'm your AI assistant...

📊 Conversation has 4 messages
💾 Token count: 0
```

### Claude Example
```
🤖 Claude API Example
==================================================

📝 Example 1: Simple Conversation

User: Hello! Please respond with a short greeting.
Claude: Hello! It's nice to meet you...

📊 Tokens used: 15 in + 12 out
```

## Next Steps

- Check out the [main README](../README.md) for API documentation
- Review the [test files](../src/__tests__/) for more usage patterns
- See [IMPLEMENTATION_SUMMARY.md](../IMPLEMENTATION_SUMMARY.md) for architecture details
