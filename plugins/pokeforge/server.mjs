import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { bridgeCall, actionSchema } from './bridge.mjs';
import copy from './locales/en.json' with { type: 'json' };
const server = new McpServer({ name: 'pokeforge', version: '2.7.0' });
new OpenAIExtensions(server);
const uri = 'ui://pokeforge/dashboard.html';
const result = async (input, render = false) => {
  const state = await bridgeCall(input);
  return { content: [{ type: 'text', text: state.error ? copy.errors[state.error] || copy.errors.invalid_response : copy.toolResult }], structuredContent: state, isError: render ? false : Boolean(state.error) };
};
registerAppResource(server, 'pokeforge-dashboard', uri, {}, async () => ({
  contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: await readFile(new URL('./index.html', import.meta.url), 'utf8'),
    _meta: { ui: { csp: { resourceDomains: ['https://raw.githubusercontent.com'] } },
      'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } },
  }],
}));
registerAppTool(server, 'open_pokeforge', {
  title: copy.name, description: copy.toolOpen, inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] } },
}, () => result({ action: 'snapshot' }, true));
server.registerTool('get_pokeforge', {
  description: copy.toolRead, inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, () => result({ action: 'snapshot' }));
server.registerTool('update_pokeforge', {
  description: copy.toolUpdate, inputSchema: actionSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, input => result(input));
await server.connect(new StdioServerTransport());
