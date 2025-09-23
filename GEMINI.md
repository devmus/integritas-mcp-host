# Project Overview: integritas-mcp-host

This project is a backend service that acts as a host for a Multi-Chain Platform (MCP). It exposes a chat endpoint that can interact with various Large Language Models (LLMs) to perform actions on the Minima blockchain.

## Key Components

- **`src/server.ts`**: The main entry point of the application. It sets up an Express server, configures CORS, and initializes the MCP client.
- **`src/routes/chat.ts`**: This file contains the core logic for the chat endpoint. It handles incoming chat requests, interacts with the selected LLM provider, and executes tools on the MCP.
- **`src/llm`**: This directory contains the logic for interacting with different LLM providers.
  - **`adapter.ts`**: Defines the interface for LLM adapters.
  - **`providers`**: This directory contains the concrete implementations of the LLM adapters for different providers (e.g., Anthropic, OpenAI, OpenRouter).
  - **`toolUtils.ts`**: Provides utility functions for handling tool-related operations, such as stripping API keys from schemas.
- **`src/mcp/toolMap.ts`**: This file contains logic for mapping tool calls to MCP actions.
- **`src/prompt/composer.ts`**: This file is responsible for composing dynamic system prompts to guide the LLM's behavior.
- **`src/config.ts`**: This file loads and exports the application's configuration from environment variables.

## Architecture

The application uses an adapter pattern to abstract the details of interacting with different LLM providers. The `chatHandler` in `src/routes/chat.ts` is responsible for:

1.  Receiving incoming chat messages.
2.  Retrieving the available tools from the MCP.
3.  Selecting the appropriate LLM adapter based on the configuration.
4.  Composing a system prompt to guide the LLM.
5.  Executing the LLM run with the provided messages, tools, and system prompt.
6.  Executing any tool calls requested by the LLM.
7.  Returning the LLM's final response to the user.

## Getting Started

1.  Install the dependencies: `npm install`
2.  Create a `.env` file based on the `.env.example` file.
3.  Start the server: `npm start`

## Tool Handling

The application retrieves a list of available tools from the MCP. Before sending these tools to the LLM, it performs the following steps:

1.  **Strips API keys**: The `stripApiKeyEverywhere` function in `src/llm/toolUtils.ts` removes any `api_key` properties from the tool schemas. This is a security measure to prevent the LLM from accessing sensitive information.
2.  **Ensures object schema**: The `ensureObjectSchema` function in `src/llm/toolUtils.ts` ensures that the tool's input schema is a valid JSON schema object.

When the LLM requests a tool call, the `callTool` function in `src/routes/chat.ts` is responsible for:

1.  Injecting the API key into the tool arguments if necessary.
2.  Calling the tool on the MCP.
3.  Logging the tool call.
4.  Returning the tool's result to the LLM.
