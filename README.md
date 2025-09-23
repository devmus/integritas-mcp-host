# MCP Host

This is a host for the Minima Coral Protocol (MCP).

## Configuration

The host is configured via environment variables. You can set them in a `.env` file.

### LLM Provider

You can choose which LLM provider to use by setting the `LLM_PROVIDER` environment variable. The following providers are supported:

- `anthropic` (default)
- `openai`
- `openrouter`
- `mock`

#### Anthropic

To use Anthropic, you need to set the `ANTHROPIC_API_KEY` environment variable.

#### OpenAI

To use OpenAI, you need to set the `OPENAI_API_KEY` and `OPENAI_MODEL` environment variables.

#### OpenRouter

To use OpenRouter, you need to set the `OPENROUTER_API_KEY` and `OPENAI_MODEL` environment variables.

## Debugging

For easier debugging, the logging in `src/chat/toolCaller.ts` has been changed from `pino` to `console.log`.