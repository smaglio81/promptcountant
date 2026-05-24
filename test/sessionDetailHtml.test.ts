import { buildSessionDetailHtml } from '../src/ui/sessionDetailHtml';
import { DbSession, DbTurn } from '../src/types';

function makeSession(over: Partial<DbSession> = {}): DbSession {
  return {
    telemetry_disabled: 0,
    session_id: 'sess-1',
    workspace_hash: 'hash-1',
    display_name: 'My Session',
    created_at: 1700000000000,
    updated_at: 1700000100000,
    total_turns: 2,
    total_cost: 0.1234,
    chat_sessions_path: '/tmp/chatSessions',
    ...over
  };
}

function makeTurn(over: Partial<DbTurn> = {}): DbTurn {
  return { id: 1,
    session_id: 'sess-1',
    request_id: 'req-1',
    timestamp: 1700000001000,
    model_id: 'copilot/gpt-4o',
    completion_tokens: 100,
    estimated_prompt_tokens: 50,
    cache_eligible_tokens: 200,
    elapsed_ms: 2500,
    message_text: 'Hello world',
    estimated_cost: 0.0012,
    is_completed: 1,
    ...over
  };
}

describe('buildSessionDetailHtml', () => {
  const NONCE = 'TESTNONCE';

  it('renders a well-formed HTML document with the title and meta', () => {
    const html = buildSessionDetailHtml({
      session: makeSession({ display_name: 'Greeting test' }),
      turns: [makeTurn()],
      chatSessionsPath: '/tmp/chatSessions',
      workspacePath: 'D:/code/myproj',
      nonce: NONCE
    });

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<title>Greeting test</title>');
    expect(html).toContain('<h1>Greeting test</h1>');
    expect(html).toContain('Estimated total cost: <strong>$0.12</strong>');
    expect(html).toContain('12 AI credits');
    // Open in Explorer button enabled when workspace path is provided
    expect(html).toMatch(/<button id="open-in-explorer"\s+title=/);
    expect(html).not.toMatch(/<button id="open-in-explorer"\s+disabled/);
    // Open in Code button rendered alongside it
    expect(html).toMatch(/<button id="open-in-code"\s+title=/);
    expect(html).not.toMatch(/<button id="open-in-code"\s+disabled/);
  });

  it('keeps the Open in Code button enabled even when no workspace path is known (opens the .jsonl file)', () => {
    const html = buildSessionDetailHtml({
      session: makeSession(),
      turns: [makeTurn()],
      chatSessionsPath: '/tmp/chatSessions',
      workspacePath: null,
      nonce: NONCE
    });
    expect(html).not.toMatch(/<button id="open-in-code"\s+disabled/);
  });

  it('renders the AI credits column with cost/$0.01 rounded', () => {
    const html = buildSessionDetailHtml({
      session: makeSession({ total_cost: 0.0744 }),
      turns: [
        makeTurn({ request_id: 'r-a', estimated_cost: 0.0123 }), // 1 credit
        makeTurn({ request_id: 'r-b', estimated_cost: 0.0567 }), // 6 credits
        makeTurn({ request_id: 'r-c', estimated_cost: 0.004 }) // 0 credits (rounds down)
      ],
      chatSessionsPath: '/tmp',
      workspacePath: null,
      nonce: NONCE
    });
    // Total: 0.0744 / 0.01 = 7.44 → 7
    expect(html).toContain('7 AI credits');
    // Each row's credits cell
    expect(html).toContain('>1</td>');
    expect(html).toContain('>6</td>');
    expect(html).toContain('>0</td>');
  });

  it('disables the Open in Explorer button when no workspace path is known', () => {
    const html = buildSessionDetailHtml({
      session: makeSession(),
      turns: [makeTurn()],
      chatSessionsPath: '/tmp/chatSessions',
      workspacePath: null,
      nonce: NONCE
    });
    // Open in Explorer now targets the .jsonl file, not the workspace, so
    // it stays enabled regardless of whether workspacePath is known.
    expect(html).not.toMatch(/<button id="open-in-explorer"\s+disabled/);
  });

  it('renders all eight column headers in the new two-line layout', () => {
    const html = buildSessionDetailHtml({
      session: makeSession(),
      turns: [makeTurn()],
      chatSessionsPath: '/tmp',
      workspacePath: null,
      nonce: NONCE
    });
    expect(html).toContain('>Time<');
    expect(html).toContain('>Model<');
    expect(html).toContain('>Message preview<');
    expect(html).toContain('>Output<span class="head-sub">tokens</span>');
    expect(html).toContain('>Input<span class="head-sub">tokens</span>');
    expect(html).toContain('>Cache<span class="head-sub">tokens</span>');
    expect(html).toContain('>Duration<');
    expect(html).toContain('>Cost<span class="head-sub">~ USD</span>');
    expect(html).toContain('>AI<span class="head-sub">credits</span>');
  });

  it('renders a row per turn with output, prompt, and cache token cells', () => {
    const html = buildSessionDetailHtml({
      session: makeSession(),
      turns: [
        makeTurn({ request_id: 'r1', completion_tokens: 111, estimated_prompt_tokens: 22, cache_eligible_tokens: 333 }),
        makeTurn({ request_id: 'r2', completion_tokens: 444, estimated_prompt_tokens: 55, cache_eligible_tokens: 0 })
      ],
      chatSessionsPath: '/tmp',
      workspacePath: null,
      nonce: NONCE
    });

    expect(html).toContain('data-request-id="r1"');
    expect(html).toContain('data-request-id="r2"');
    expect(html).toContain('>111<');
    expect(html).toContain('>~22<');
    expect(html).toContain('>~333<');
    expect(html).toContain('>444<');
    expect(html).toContain('>~55<');
    // cache_eligible_tokens === 0 → render em-dash, not "~0"
    expect(html).toContain('>\u2014<'); // em-dash for the second row's cache cell
  });

  it('shows an empty-state message when there are no turns', () => {
    const html = buildSessionDetailHtml({
      session: makeSession({ total_turns: 0, total_cost: null }),
      turns: [],
      chatSessionsPath: '/tmp',
      workspacePath: null,
      nonce: NONCE
    });
    expect(html).toContain('No turns recorded for this session yet.');
    // Table is omitted entirely in the empty state
    expect(html).not.toContain('<tbody');
  });

  it('escapes HTML in session display name, model id, and message text', () => {
    const html = buildSessionDetailHtml({
      session: makeSession({ display_name: '<script>x</script>' }),
      turns: [
        makeTurn({
          model_id: 'evil<>"\'&',
          message_text: '<img src=x onerror=alert(1)>'
        })
      ],
      chatSessionsPath: '/tmp',
      workspacePath: null,
      nonce: NONCE
    });

    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('evil&lt;&gt;&quot;&#039;&amp;');
  });

  it('falls back to "Session Detail" when no session is loaded', () => {
    const html = buildSessionDetailHtml({
      session: null,
      turns: [],
      chatSessionsPath: '/tmp',
      workspacePath: null,
      nonce: NONCE
    });
    expect(html).toContain('<title>Session Detail</title>');
    expect(html).toContain('<h1>Session Detail</h1>');
    expect(html).toContain('No turns recorded');
  });

  it('uses the provided nonce in CSP, <style>, and <script>', () => {
    const html = buildSessionDetailHtml({
      session: makeSession(),
      turns: [makeTurn()],
      chatSessionsPath: '/tmp',
      workspacePath: null,
      nonce: NONCE
    });
    expect(html).toContain(`'nonce-${NONCE}'`);
    expect(html).toContain(`<style nonce="${NONCE}">`);
    expect(html).toContain(`<script nonce="${NONCE}">`);
  });

  it('embeds sessionId, chatSessionsPath, and workspacePath as JSON in the script', () => {
    const html = buildSessionDetailHtml({
      session: makeSession({ session_id: 'abc-123' }),
      turns: [makeTurn()],
      chatSessionsPath: 'C:/path/to/chatSessions',
      workspacePath: 'C:/path/to/workspace',
      nonce: NONCE
    });
    expect(html).toContain('const sessionId = "abc-123"');
    expect(html).toContain('const chatSessionsPath = "C:/path/to/chatSessions"');
    expect(html).toContain('const workspacePath = "C:/path/to/workspace"');
  });

  it('does not produce malformed template interpolation artefacts', () => {
    const html = buildSessionDetailHtml({
      session: makeSession(),
      turns: [makeTurn()],
      chatSessionsPath: '/tmp',
      workspacePath: '/ws',
      nonce: NONCE
    });
    // Any unresolved ${...} would be a bug in the template.
    expect(html).not.toMatch(/\$\{[a-zA-Z_]/);
  });
});
