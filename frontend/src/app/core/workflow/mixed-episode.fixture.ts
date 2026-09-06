import {at, chat, detail, span, tool} from './workflow.fixtures';

// copilot-episode-v1. Synthetic reconstruction of the mixed conversation/chat ID
// shape: one trace, nested invoke_agent, parent ID on child chat, child ID on tools.
export function mixedEpisodeFixture() {
  const root = span(1000, {'gen_ai.conversation.id': 'root', 'copilot_chat.chat_session_id': 'root',
    'copilot_chat.user_request': 'Syntetyczne zlecenie rodzica'}, {operationName: 'invoke_agent', startedAt: at(0), endedAt: at(600)});
  const main = Array.from({length: 14}, (_, index) => chat(index + 1, 1000 + index * 50, 800, 50, {},
    {parentSpanId: root.spanId, startedAt: at(index < 10 ? index * 10 + 1 : 400 + index * 10), endedAt: at(index < 10 ? index * 10 + 2 : 401 + index * 10)}));
  const launch = tool(2000, 10, 'Syntetyczny zwrot', {'gen_ai.tool.call.id': 'child', 'copilot_chat.chat_session_id': 'root'},
    {parentSpanId: root.spanId, startedAt: at(95), endedAt: at(290)});
  const mixed = {'gen_ai.conversation.id': 'root', 'copilot_chat.chat_session_id': 'child',
    'copilot_chat.parent_chat_session_id': 'root', 'gen_ai.agent.name': 'Worker', 'gen_ai.request.model': 'worker-model'};
  const childRoot = span(1001, {...mixed, 'copilot_chat.user_request': 'Syntetyczne zlecenie dziecka'},
    {operationName: 'invoke_agent', parentSpanId: launch.spanId, startedAt: at(96), endedAt: at(289)});
  const children = Array.from({length: 16}, (_, index) => chat(100 + index, 2000 + index * 100, 1000, 70, mixed,
    {parentSpanId: childRoot.spanId, startedAt: at(100 + index * 10), endedAt: at(101 + index * 10)}));
  const results = children.slice(0, -1).map((child, index) => tool(300 + index, 1, 'result-' + index,
    {'gen_ai.conversation.id': 'child'}, {parentSpanId: childRoot.spanId, startedAt: at(102 + index * 10), endedAt: at(103 + index * 10),
      ...(index === 4 ? {statusCode: 'STATUS_CODE_ERROR'} : {})}));
  const smallLaunch = tool(2001, 4, 'Mały zwrot', {'gen_ai.tool.call.id': 'small-child'},
    {parentSpanId: root.spanId, startedAt: at(33), endedAt: at(39)});
  const smallRoot = span(1002, {'gen_ai.conversation.id': 'root'},
    {operationName: 'invoke_agent', traceId: 'small-trace', startedAt: at(34), endedAt: at(38)});
  const small = [35, 37].map((second, index) => chat(200 + index, 700, 300, 40,
    {'gen_ai.conversation.id': 'small-child', 'gen_ai.request.model': 'small-model'},
    {traceId: 'small-trace', parentSpanId: smallRoot.spanId, startedAt: at(second), endedAt: at(second + .5)}));
  return [detail([root, ...main, launch, childRoot, children[3], children[15], smallLaunch, smallRoot, ...small]),
    detail([...children.filter((_, index) => index !== 3 && index !== 15), ...results], 2, 'child')];
}
