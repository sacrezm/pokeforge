import { actionSchema } from './bridge.mjs';
import { engineCall } from './engine.mjs';
import { sprite } from './mod-sprite.mjs';

// One host-mediated argv call. Never accept shell text or write a save here.
try {
  const input = JSON.parse(process.argv[2] ?? '{}');
  if (input.action === 'sprite') {
    console.log(JSON.stringify({ art: await sprite(input.speciesID, input.shiny) }));
    process.exit(0);
  }
  const action = Object.keys(input).length === 1 && input.action === 'snapshot'
    ? input : actionSchema.parse(input);
  const state = await engineCall(action);
  if (state.schemaVersion === 1) {
    state.modArt = await sprite(state.companion.egg ? null : state.companion.speciesID, state.companion.shiny);
  }
  console.log(JSON.stringify(state));
} catch {
  console.log(JSON.stringify({ error: 'invalid_action' }));
  process.exitCode = 1;
}
