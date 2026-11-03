import { parseSseChunk } from './sse';

describe('parseSseChunk', () => {
  it('parses complete frames and keeps the remainder', () => {
    const { frames, rest } = parseSseChunk(
      'event: monitoring\nid: 1\ndata: {"a":1}\n\n: ping\n\nevent: monitoring\ndata: {"b"',
    );
    expect(frames).toEqual([{ event: 'monitoring', id: '1', data: '{"a":1}' }]);
    expect(rest).toBe('event: monitoring\ndata: {"b"');
  });
  it('handles CRLF and multi-line data', () => {
    const { frames } = parseSseChunk('data: x\r\ndata: y\r\n\r\n');
    expect(frames).toEqual([{ event: 'message', data: 'x\ny', id: undefined }]);
  });
});
